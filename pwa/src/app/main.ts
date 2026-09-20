import { SessionCleanup } from "./SessionCleanup.js";
import {
    beginGameAudio,
    commitGameAudio,
    isGameAudioCurrent,
    isGameAudioLatest,
    releaseGameAudio,
    setGameAudioInterruptionHandler,
    type GameAudioAttempt
} from "./PlaybackSession.js";
import "./styles.css";
import { GameSessionOwnership } from "./GameSessionOwnership.js";
import { GameViewportController } from "./GameViewportController.js";
import { MAX_SNAPSHOT_TEXT_LENGTH } from "./SnapshotLimits.js";
import { SoundStore, type AppGameContainer, type GameContainer } from "slick2d-ts";
import { BrowserPreferences, DEFAULT_SCALING_PREFERENCE, DEFAULT_VOLUME, type ScalingPreference } from "./BrowserPreferences";
import { createBrowserStorageKeys } from "./BrowserStorageKeys";
import { RuntimeLoader, type PreparedRuntime } from "./RuntimeLoader";
import { ScreenWakeLockManager } from "./ScreenWakeLockManager.js";
import { registerServiceWorker } from "./ServiceWorkerRegistrar";
import { SessionGeneration } from "./SessionGeneration";
import { APP_VERSION, CACHE_BUST } from "./version";
import type { Main as MsPacManMain } from "../mspacman/Main";
import type { ScalableGame2 } from "../mspacman/ScalableGame2";
import type { MsPacManGameStateStore } from "../mspacman/persistence/MsPacManGameStateStore";
import { isValidMsPacManGameStateSnapshot } from "../mspacman/persistence/MsPacManGameStateSerializer";

const app = document.querySelector<HTMLDivElement>("#app");
const HIGH_DPI_ENABLED = true;
const MAX_DEVICE_PIXEL_RATIO = 4;
const SCALING_MODE_DEFINITIONS: readonly { value: ScalingPreference; label: string }[] = [
    { value: "smooth", label: "Smooth" },
    { value: "crisp", label: "Crisp" },
    { value: "pixel-perfect", label: "Pixel Perfect" }
];
const PICKER_BREATHING_ROOM_PX = 2;
type ScalingModeDefinition = (typeof SCALING_MODE_DEFINITIONS)[number];
type PwaSessionState = "booting" | "menu" | "starting" | "running" | "stopping" | "error";

if (!app) {
    throw new Error("Missing #app root.");
}

let container: AppGameContainer | null = null;
let game: MsPacManMain | null = null;
let activeScalableGame: ScalableGame2 | null = null;
let menuOverlay: HTMLElement | null = null;
let liveMenuOpen = false;
let gameLaunchInProgress = false;
let pwaSessionState: PwaSessionState = "booting";
let gameOwnershipEpoch = -1;
let menuRequestSerial = 0;
const preferences = new BrowserPreferences();
const sessionGeneration = new SessionGeneration();
const runtimeLoader = new RuntimeLoader(refreshVisibleBootProgress);
const screenWakeLock = new ScreenWakeLockManager();
const sessionCleanup = new SessionCleanup();
let gameStateStore: MsPacManGameStateStore | null = null;
let volume = preferences.volume;
let scalingPreference: ScalingPreference = preferences.scaling;
let activeSessionGeneration = 0;
const viewport = new GameViewportController(app, {
    isSessionCurrent: isCurrentGameSession,
    isGameplayActive: () => pwaSessionState === "starting" || pwaSessionState === "running",
    isGameplayRunning: () => pwaSessionState === "running" && game !== null && !game.isLoadingScreenActive(),
    returnToMenu,
    fullscreenExited: () => requestPwaMenu("fullscreen-exit"),
    reportResizeError: (error) => reportResponsiveResizeError(error, activeSessionGeneration)
});
const ownership = new GameSessionOwnership(app, startPwaMenu, () => releaseOwnedSession());
setGameAudioInterruptionHandler(requestPwaMenu);
document.addEventListener("keydown", handleBrowserReservedKey, true);
window.__msPacManResourcesPrepared = false;
if (!window.__msPacManBootFailed) {
    setupGlobalErrorHandlers();
    setupPageLifecycleHandlers();
    void registerServiceWorker(CACHE_BUST);
    ownership.start();
}

function canActivateFromMenu(): boolean {
    return (
        sessionCleanup.safe &&
        pwaSessionState === "menu" &&
        ownership.isCurrent(ownership.epoch) &&
        document.visibilityState === "visible" &&
        document.hasFocus()
    );
}

function isCurrentGameSession(generation: number): boolean {
    return sessionCleanup.safe && sessionGeneration.isCurrent(generation) && ownership.isCurrent(gameOwnershipEpoch);
}

function isStartingGameSession(generation: number, audio: GameAudioAttempt): boolean {
    return (
        isCurrentGameSession(generation) &&
        pwaSessionState === "starting" &&
        isGameAudioCurrent(audio) &&
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        container?.isGraphicsContextLost() !== true
    );
}

function startPwaMenu(): void {
    const epoch = ownership.epoch;
    if (!sessionCleanup.safe || !ownership.isCurrent(epoch)) {
        return;
    }
    const request = ++menuRequestSerial;
    pwaSessionState = "booting";
    renderBoot(runtimeLoader.progress);
    void runtimeLoader
        .prepare(runtimeLoader.error !== null)
        .then(() => {
            if (request !== menuRequestSerial || !ownership.isCurrent(epoch) || pwaSessionState !== "booting") {
                return;
            }
            window.__msPacManResourcesPrepared = true;
            pwaSessionState = "menu";
            renderMenuUi(app, hasPotentialSavedGameState(), "", false);
            window.__msPacManBooted = true;
        })
        .catch((error) => {
            if (request !== menuRequestSerial || !ownership.isCurrent(epoch) || pwaSessionState !== "booting") {
                return;
            }
            console.error(error);
            pwaSessionState = "menu";
            renderBootLoadError(error);
        });
}

function renderMenu(errorText = ""): void {
    if (!ownership.isCurrent(ownership.epoch)) {
        return;
    }
    if (!destroyGame()) {
        return;
    }
    pwaSessionState = "menu";
    renderMenuUi(app, hasPotentialSavedGameState(), errorText, false);
}

function renderMenuUi(parent: HTMLElement, canContinue: boolean, errorText: string, overlay: boolean): HTMLElement {
    const menuRoot = document.createElement("main");
    menuRoot.className = overlay ? "shell menu-screen menu-overlay" : "shell menu-screen";
    if (overlay) {
        menuRoot.dataset.liveMenu = "true";
    }
    const fullscreenUnavailable = viewport.getFullscreenCapability() === "unavailable";
    const fullscreenPresented = !fullscreenUnavailable && preferences.fullscreen;
    menuRoot.innerHTML = `
        <section class="menu" aria-label="Ms. Pac-Man 2010 menu">
            <div class="menu-actions">
                <div class="settings-row settings-fullscreen-scaling-row">
                    <div class="setting-fullscreen-row" role="group" aria-label="Fullscreen">
                        <span>Fullscreen</span>
                        <button id="fullscreen-switch-button" class="menu-switch fullscreen-switch" type="button" aria-label="Toggle fullscreen" aria-pressed="${fullscreenPresented}" data-enabled="${fullscreenPresented}"${fullscreenUnavailable ? ' disabled title="Fullscreen is unavailable in this browser"' : ""}><span></span></button>
                    </div>
                    <div class="setting-scaling-row" role="group" aria-label="Scaling">
                        <span>Scaling</span>
                        ${scalingPickerHtml()}
                    </div>
                </div>
                <div class="volume-control">
                    <span class="volume-icon" id="volumeIcon" aria-hidden="true">${volumeIcon(volume)}</span>
                    <input id="volumeInput" type="range" min="0" max="100" step="1" value="${Math.round(volume * 100)}" aria-label="Volume">
                    <span class="volume-value" id="volumeValue">${Math.round(volume * 100)}</span>
                </div>
                <div class="menu-buttons">
                    <button id="newGameButton" class="start-button" type="button">New Game</button>
                    <button id="continueButton" class="start-button" type="button"${canContinue ? "" : " disabled"}>Continue</button>
                </div>
                <button id="resetButton" class="reset-button" type="button">Reset</button>
                ${errorText ? `<p class="error-text">${escapeHtml(errorText)}</p>` : ""}
            </div>
        </section>
    `;
    if (overlay) {
        parent.appendChild(menuRoot);
    } else {
        parent.replaceChildren(menuRoot);
    }

    const volumeInput = menuRoot.querySelector<HTMLInputElement>("#volumeInput");
    const volumeValue = menuRoot.querySelector<HTMLElement>("#volumeValue");
    const fullscreenSwitch = menuRoot.querySelector<HTMLButtonElement>("#fullscreen-switch-button");
    const scalingPicker = menuRoot.querySelector<HTMLElement>("#scaling-picker");
    const scalingButton = menuRoot.querySelector<HTMLButtonElement>("#scaling-button");
    const scalingPopup = menuRoot.querySelector<HTMLElement>("#scaling-popup");
    const scalingList = menuRoot.querySelector<HTMLElement>("#scaling-list");
    const newGameButton = menuRoot.querySelector<HTMLButtonElement>("#newGameButton");
    const continueButton = menuRoot.querySelector<HTMLButtonElement>("#continueButton");
    const resetButton = menuRoot.querySelector<HTMLButtonElement>("#resetButton");

    fullscreenSwitch?.addEventListener("click", () => {
        if (fullscreenSwitch.disabled) {
            return;
        }
        preferences.setFullscreen(!preferences.fullscreen);
        updateFullscreenUi(fullscreenSwitch);
    });
    if (fullscreenSwitch) {
        updateFullscreenUi(fullscreenSwitch);
    }

    if (scalingPicker && scalingButton && scalingPopup && scalingList) {
        const scalingOptions = Array.from(menuRoot.querySelectorAll<HTMLButtonElement>("[data-scaling-mode]"));
        measureScalingPickerWidth(scalingPicker, scalingButton, scalingPopup, scalingList);
        const handleScalingChange = (value: string) => {
            if (!isScalingPreference(value)) {
                updateScalingUi(scalingPicker);
                return;
            }
            setScalingPreference(value);
            updateScalingUi(scalingPicker);
            setScalingPickerOpen(scalingPicker, scalingButton, scalingPopup, false);
            scalingButton.focus();
        };
        scalingButton.addEventListener("click", () => {
            setScalingPickerOpen(scalingPicker, scalingButton, scalingPopup, !isScalingPickerOpen(scalingPicker), true);
        });
        scalingButton.addEventListener("keydown", (event) => {
            if (event.key === " " || event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setScalingPickerOpen(scalingPicker, scalingButton, scalingPopup, true, true);
            }
        });
        scalingList.addEventListener("keydown", (event) => {
            const currentIndex = Math.max(
                0,
                scalingOptions.findIndex((option) => option === document.activeElement)
            );
            if (event.key === "Escape") {
                event.preventDefault();
                setScalingPickerOpen(scalingPicker, scalingButton, scalingPopup, false);
                scalingButton.focus();
            } else if (event.key === "ArrowDown") {
                event.preventDefault();
                scalingOptions[(currentIndex + 1) % scalingOptions.length]?.focus();
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                scalingOptions[(currentIndex + scalingOptions.length - 1) % scalingOptions.length]?.focus();
            } else if (event.key === "Home") {
                event.preventDefault();
                scalingOptions[0]?.focus();
            } else if (event.key === "End") {
                event.preventDefault();
                scalingOptions[scalingOptions.length - 1]?.focus();
            } else if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                const target = document.activeElement;
                if (target instanceof HTMLElement) {
                    handleScalingChange(target.dataset.scalingMode ?? "");
                }
            }
        });
        for (const option of scalingOptions) {
            option.addEventListener("click", () => handleScalingChange(option.dataset.scalingMode ?? ""));
        }
        menuRoot.addEventListener("click", (event) => {
            if (event.target instanceof Node && !scalingPicker.contains(event.target)) {
                setScalingPickerOpen(scalingPicker, scalingButton, scalingPopup, false);
            }
        });
        scalingPicker.addEventListener("focusout", () => {
            window.setTimeout(() => {
                if (!scalingPicker.contains(document.activeElement)) {
                    setScalingPickerOpen(scalingPicker, scalingButton, scalingPopup, false);
                }
            }, 0);
        });
        updateScalingUi(scalingPicker);
    }

    volumeInput?.addEventListener("input", () => {
        volume = Number(volumeInput.value) / 100;
        preferences.setVolume(volume, false);
        updateVolumeUi(volumeInput, volumeValue);
        applyVolume();
    });
    volumeInput?.addEventListener("change", () => {
        preferences.setVolume(volume, true);
    });
    if (volumeInput) {
        updateVolumeUi(volumeInput, volumeValue);
    }

    newGameButton?.addEventListener("click", () => {
        if (!canActivateFromMenu()) {
            return;
        }
        clearStoredGameState();
        void startGame(false);
    });

    continueButton?.addEventListener("click", () => {
        if (!canActivateFromMenu()) {
            return;
        }
        if (hasLiveSuspendedGame()) {
            void resumeLiveGameFromMenu();
            return;
        }
        void startGame(true);
    });

    resetButton?.addEventListener("click", resetPwaState);
    return menuRoot;
}

async function startGame(restoreSavedGame: boolean): Promise<void> {
    if (!canActivateFromMenu()) {
        return;
    }
    const runtime = runtimeLoader.prepared;
    if (runtime === null) {
        startPwaMenu();
        return;
    }
    if (!destroyGame()) {
        return;
    }
    applyApplicationAudioPreferences();
    gameOwnershipEpoch = ownership.epoch;
    const generation = sessionGeneration.begin();
    activeSessionGeneration = generation;
    pwaSessionState = "starting";
    gameLaunchInProgress = true;
    syncScreenWakeLock();
    if (!isCurrentGameSession(generation) || pwaSessionState !== "starting") {
        return;
    }
    const host = viewport.createShell(generation);
    runtime.slick.Display.setParent(host);
    const audio = beginGameAudio();
    requestPreferredFullscreen();
    try {
        if (!(await audio.ready) || !isStartingGameSession(generation, audio)) {
            return;
        }
        await mountGame(runtime, restoreSavedGame, generation, audio);
    } catch (error) {
        if (!isCurrentGameSession(generation)) {
            return;
        }
        console.error(error);
        if (!destroyGame()) {
            return;
        }
        pwaSessionState = "menu";
        if (restoreSavedGame) {
            renderMenuUi(app, hasPotentialSavedGameState(), "", false);
            return;
        }
        renderLoadError(error);
    } finally {
        if (isGameAudioLatest(audio) && isCurrentGameSession(generation) && pwaSessionState === "starting") {
            requestPwaMenu("start-failed");
        }
    }
}

function renderBoot(progress: number): void {
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    const existingProgress = app.querySelector<HTMLElement>("[data-boot-progress='true']");
    if (existingProgress !== null) {
        existingProgress.setAttribute("aria-valuenow", String(percent));
        existingProgress.querySelector<HTMLElement>(".progress-bar")?.style.setProperty("--progress", `${percent}%`);
        return;
    }

    app.innerHTML = `
        <main class="shell">
            <section class="boot" aria-live="polite">
                <div class="progress-shell" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" data-boot-progress="true">
                    <div class="progress-bar" style="--progress: ${percent}%"></div>
                </div>
            </section>
        </main>
    `;
}

function renderBootLoadError(error: unknown): void {
    void error;
    app.innerHTML = `
        <main class="shell">
            <section class="boot boot-error">
                <div class="failure-icon" aria-hidden="true">&#x1F480;</div>
                <div class="boot-title">Unable to load.</div>
                <p class="error-text">Check your connection and try again.</p>
                <button id="retryButton" class="retry-button" type="button">Retry</button>
            </section>
        </main>
    `;
    document.querySelector<HTMLButtonElement>("#retryButton")?.addEventListener("click", startPwaMenu);
}

function renderLoadError(error: unknown): void {
    void error;
    if (!ownership.owned) {
        return;
    }
    pwaSessionState = "menu";
    app.innerHTML = `
        <main class="shell">
            <section class="boot boot-error">
                <div class="failure-icon" aria-hidden="true">&#x1F480;</div>
                <div class="boot-title">Unable to start.</div>
                <p class="error-text">Check your connection and try again.</p>
                <button id="retryButton" class="retry-button" type="button">Retry</button>
            </section>
        </main>
    `;
    document.querySelector<HTMLButtonElement>("#retryButton")?.addEventListener("click", startPwaMenu);
}

async function mountGame(runtime: PreparedRuntime, restoreSavedGame: boolean, generation: number, audio: GameAudioAttempt): Promise<void> {
    if (!isStartingGameSession(generation, audio)) {
        return;
    }
    const host = viewport.gameHost;
    if (host === null) {
        throw new Error("Missing game host.");
    }

    const mainGame = new runtime.Main();
    const scalableGame = new runtime.ScalableGame2(mainGame, 800, 600, true);
    scalableGame.setScalingPreference(scalingPreference);
    const displayMode = viewport.getResponsiveDisplayMode();
    const appContainer = new runtime.slick.AppGameContainer(scalableGame, displayMode.width, displayMode.height, false);
    appContainer.setPreserveAudioCacheOnDestroy(true);
    appContainer.setLoopSuspended(true);
    appContainer.getInput().pause();
    appContainer.setHighDpiEnabled(HIGH_DPI_ENABLED);
    appContainer.setMaxDevicePixelRatio(MAX_DEVICE_PIXEL_RATIO);
    mainGame.appGameContainer = appContainer;
    mainGame.pauseStateChangeHandler = handleGamePauseStateChanged;
    container = appContainer;
    game = mainGame;
    activeScalableGame = scalableGame;
    activeSessionGeneration = generation;
    viewport.attach(appContainer, generation);
    appContainer.setGraphicsLifecycleHandler((state) => {
        if (state === "lost" && isCurrentGameSession(generation)) {
            requestPwaMenu("graphics-context-lost");
        }
    });
    if (restoreSavedGame) {
        mainGame.loadingCompleteHandler = (gc: GameContainer): boolean => {
            if (!isStartingGameSession(generation, audio)) {
                return false;
            }
            if (!getGameStateStore(runtime).restore(mainGame, gc)) {
                throw new Error("Saved game could not be restored.");
            }
            return true;
        };
    }

    try {
        if (!isStartingGameSession(generation, audio)) {
            disposeStaleLaunch(mainGame, appContainer);
            return;
        }
        await appContainer.setDisplayMode(displayMode.width, displayMode.height, false);
        if (!isStartingGameSession(generation, audio)) {
            disposeStaleLaunch(mainGame, appContainer);
            return;
        }
        appContainer.setAlwaysRender(true);
        appContainer.setVSync(true);
        appContainer.setSmoothDeltas(false);
        appContainer.setShowFPS(false);
        appContainer.setClearEachFrame(true);
        await appContainer.start();
        if (!isStartingGameSession(generation, audio)) {
            disposeStaleLaunch(mainGame, appContainer);
            return;
        }
        await runtime.slick.ResourceLoader.waitForAll();
        if (!isStartingGameSession(generation, audio)) {
            disposeStaleLaunch(mainGame, appContainer);
            return;
        }
        appContainer.setErrorHandler((error) => {
            if (!isCurrentGameSession(generation)) {
                return;
            }
            console.error(error);
            if (!destroyGame()) {
                return;
            }
            renderLoadError(error);
        });
        applyVolume();
        if (!(await commitGameAudio(audio)) || !isStartingGameSession(generation, audio)) {
            return;
        }
        viewport.startResponsiveSizing(host);
        viewport.startCursorAutoHide(host);
        viewport.focusCanvas();
        if (!isStartingGameSession(generation, audio) || game !== mainGame || container !== appContainer) {
            return;
        }
        appContainer.getInput().resume();
        gameLaunchInProgress = false;
        pwaSessionState = "running";
        mainGame.setBrowserSuspended(false);
        if (
            !isCurrentGameSession(generation) ||
            !isGameAudioCurrent(audio) ||
            pwaSessionState !== "running" ||
            game !== mainGame ||
            container !== appContainer
        ) {
            return;
        }
        appContainer.setLoopSuspended(false);
        viewport.startHamburgerVisibilityMonitor();
        syncScreenWakeLock();
    } catch (error) {
        disposeStaleLaunch(mainGame, appContainer);
        if (isCurrentGameSession(generation) && isGameAudioLatest(audio)) {
            releaseGameAudio(audio);
            runtime.slick.Display.setParent(null);
        }
        throw error;
    }
}

function disposeStaleLaunch(mainGame: MsPacManMain, appContainer: AppGameContainer): void {
    sessionCleanup.run(
        () => mainGame.invalidateBrowserLifetime(),
        () => appContainer.destroy()
    );
    if (!sessionCleanup.safe) {
        showCleanupFailure();
    }
}

function applyVolume(): void {
    applyVolumeToRuntime();
}

function applyApplicationAudioPreferences(): void {
    const store = SoundStore.get();
    store.setMusicOn(true);
    store.setSoundsOn(true);
    applyVolumeToRuntime();
}

function applyVolumeToRuntime(): void {
    const musicVolume = volume;
    const soundVolume = Math.sqrt(volume);
    SoundStore.get().setMusicVolume(musicVolume);
    SoundStore.get().setSoundVolume(soundVolume);
    container?.setMusicVolume(musicVolume);
    container?.setSoundVolume(soundVolume);
}

function refreshVisibleBootProgress(): void {
    if (!ownership.owned || pwaSessionState !== "booting") {
        return;
    }
    window.__msPacManResourcesPrepared = runtimeLoader.progress >= 1;
    if (app.querySelector("[data-boot-progress='true']") !== null) {
        renderBoot(runtimeLoader.progress);
    }
}

function setScalingPreference(value: ScalingPreference): void {
    scalingPreference = value;
    preferences.setScaling(value);
    activeScalableGame?.setScalingPreference(value);
    viewport.scheduleResize();
}

function requestPreferredFullscreen(): void {
    if (!preferences.fullscreen || viewport.getFullscreenCapability() === "unavailable") {
        return;
    }
    void viewport.requestFullscreen();
}

function updateFullscreenUi(button: HTMLButtonElement): void {
    const presented = !button.disabled && preferences.fullscreen;
    button.setAttribute("aria-pressed", String(presented));
    button.setAttribute("data-enabled", String(presented));
}

function updateScalingUi(scalingPicker: HTMLElement): void {
    const selectedDefinition = getScalingDefinition(scalingPreference);
    const selectedLabel = scalingPicker.querySelector<HTMLElement>(".scaling-picker-label");
    if (selectedLabel !== null) {
        selectedLabel.textContent = selectedDefinition.label;
    }
    for (const option of scalingPicker.querySelectorAll<HTMLElement>("[data-scaling-mode]")) {
        option.setAttribute("aria-selected", String(option.dataset.scalingMode === scalingPreference));
    }
}

function scalingPickerHtml(): string {
    const selectedDefinition = getScalingDefinition(scalingPreference);
    return `
        <div id="scaling-picker" class="theme-picker scaling-picker" data-open="false">
            <button id="scaling-button" class="theme-picker-button scaling-picker-button" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="scaling-popup">
                <span class="theme-picker-label scaling-picker-label">${escapeHtml(selectedDefinition.label)}</span>
                <span class="picker-caret" aria-hidden="true"></span>
            </button>
            <div id="scaling-popup" class="theme-picker-popup" hidden>
                <div id="scaling-list" class="theme-picker-list" role="listbox" aria-label="Scaling">
                    ${SCALING_MODE_DEFINITIONS.map((definition) => scalingOptionHtml(definition)).join("")}
                </div>
            </div>
        </div>`;
}

function scalingOptionHtml(definition: ScalingModeDefinition): string {
    return `
        <button class="theme-picker-option" type="button" role="option" aria-selected="${definition.value === scalingPreference}" data-scaling-mode="${definition.value}">
            <span>${escapeHtml(definition.label)}</span>
            <span class="picker-caret-placeholder"></span>
        </button>`;
}

function getScalingDefinition(value: ScalingPreference): ScalingModeDefinition {
    return SCALING_MODE_DEFINITIONS.find((definition) => definition.value === value) ?? SCALING_MODE_DEFINITIONS[0];
}

function isScalingPreference(value: unknown): value is ScalingPreference {
    return BrowserPreferences.isScaling(value);
}

function measureScalingPickerWidth(scalingPicker: HTMLElement, scalingButton: HTMLButtonElement, scalingPopup: HTMLElement, scalingList: HTMLElement): void {
    measurePickerWidth(
        scalingPicker,
        scalingButton,
        scalingPopup,
        scalingList,
        SCALING_MODE_DEFINITIONS.map((definition) => definition.label),
        [".picker-caret"],
        [".picker-caret-placeholder"]
    );
}

function measurePickerWidth(
    picker: HTMLElement,
    button: HTMLButtonElement,
    popup: HTMLElement,
    list: HTMLElement,
    labels: readonly string[],
    buttonAccessorySelectors: readonly string[],
    optionAccessorySelectors: readonly string[]
): void {
    const wasPopupHidden = popup.hidden;
    popup.hidden = false;
    const buttonStyle = window.getComputedStyle(button);
    const option = list.querySelector<HTMLElement>(".theme-picker-option");
    const optionStyle = option === null ? null : window.getComputedStyle(option);
    const popupStyle = window.getComputedStyle(popup);
    const listStyle = window.getComputedStyle(list);
    const buttonAccessoryWidth = getElementsOuterWidth(button, buttonAccessorySelectors);
    const optionAccessoryWidth = option === null ? 0 : getElementsOuterWidth(option, optionAccessorySelectors);
    const maxLabelWidth = measureWidestPickerLabel(picker, optionStyle ?? buttonStyle, labels);
    const scrollbarWidth = getElementVerticalScrollbarWidth(list, listStyle);
    const buttonWidth =
        maxLabelWidth +
        parseCssPixels(buttonStyle.columnGap) * buttonAccessorySelectors.length +
        buttonAccessoryWidth +
        horizontalSpacing(buttonStyle, true) +
        4;
    const optionWidth =
        optionStyle === null
            ? 0
            : maxLabelWidth +
              parseCssPixels(optionStyle.columnGap) * optionAccessorySelectors.length +
              optionAccessoryWidth +
              horizontalSpacing(optionStyle, false) +
              horizontalSpacing(popupStyle, true) +
              horizontalSpacing(listStyle, true) +
              scrollbarWidth +
              4;
    picker.style.setProperty("--theme-picker-width", `${Math.ceil(Math.max(buttonWidth, optionWidth) + PICKER_BREATHING_ROOM_PX)}px`);
    popup.hidden = wasPopupHidden;
}

function measureWidestPickerLabel(parent: HTMLElement, style: CSSStyleDeclaration, labels: readonly string[]): number {
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.left = "-10000px";
    probe.style.top = "0";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "nowrap";
    probe.style.fontFamily = style.fontFamily;
    probe.style.fontSize = style.fontSize;
    probe.style.fontWeight = style.fontWeight;
    probe.style.fontStyle = style.fontStyle;
    probe.style.letterSpacing = style.letterSpacing;
    parent.appendChild(probe);
    let maxLabelWidth = 0;
    for (const label of labels) {
        probe.textContent = label;
        maxLabelWidth = Math.max(maxLabelWidth, probe.getBoundingClientRect().width);
    }
    probe.remove();
    return maxLabelWidth;
}

function getElementOuterWidth(element: HTMLElement | null): number {
    return element?.getBoundingClientRect().width ?? 0;
}

function getElementsOuterWidth(parent: HTMLElement, selectors: readonly string[]): number {
    return selectors.reduce((width, selector) => width + getElementOuterWidth(parent.querySelector<HTMLElement>(selector)), 0);
}

function getElementVerticalScrollbarWidth(element: HTMLElement, style: CSSStyleDeclaration): number {
    const borderWidth = parseCssPixels(style.borderLeftWidth) + parseCssPixels(style.borderRightWidth);
    return Math.max(0, element.offsetWidth - element.clientWidth - borderWidth);
}

function horizontalSpacing(style: CSSStyleDeclaration, includeBorder: boolean): number {
    const borderWidth = includeBorder ? parseCssPixels(style.borderLeftWidth) + parseCssPixels(style.borderRightWidth) : 0;
    return parseCssPixels(style.paddingLeft) + parseCssPixels(style.paddingRight) + borderWidth;
}

function parseCssPixels(value: string): number {
    const pixels = Number.parseFloat(value);
    return Number.isFinite(pixels) ? pixels : 0;
}

function isScalingPickerOpen(scalingPicker: HTMLElement): boolean {
    return scalingPicker.dataset.open === "true";
}

function setScalingPickerOpen(
    scalingPicker: HTMLElement,
    scalingButton: HTMLButtonElement,
    scalingPopup: HTMLElement,
    open: boolean,
    focusSelected = false
): void {
    scalingPicker.dataset.open = String(open);
    scalingButton.setAttribute("aria-expanded", String(open));
    scalingPopup.hidden = !open;
    if (!open || !focusSelected) {
        return;
    }

    const scalingList = scalingPopup.querySelector<HTMLElement>("#scaling-list") as HTMLElement;
    const selectedOption =
        Array.from(scalingList.querySelectorAll<HTMLElement>("[data-scaling-mode]")).find((option) => option.dataset.scalingMode === scalingPreference) ??
        scalingList.querySelector<HTMLElement>("[data-scaling-mode]");
    selectedOption?.focus();
}

function updateVolumeUi(volumeInput: HTMLInputElement, volumeValue: HTMLElement | null): void {
    const volumePercent = Math.round(volume * 100);
    const volumeIconElement = document.querySelector<HTMLElement>("#volumeIcon");
    volumeInput.style.setProperty("--thumb-position", `${volumePercent}%`);
    if (volumeValue) {
        volumeValue.textContent = String(volumePercent);
    }
    if (volumeIconElement) {
        volumeIconElement.innerHTML = volumeIcon(volume);
    }
}

function volumeIcon(value: number): string {
    const waves =
        Math.round(value * 100) === 0
            ? `<path d="M18 9l5 5m0-5l-5 5"></path>`
            : value < 0.33
              ? `<path d="M17 10a4 4 0 0 1 0 4"></path>`
              : value < 0.66
                ? `<path d="M17 8a6 6 0 0 1 0 8"></path><path d="M20 6a9 9 0 0 1 0 12"></path>`
                : `<path d="M17 8a6 6 0 0 1 0 8"></path><path d="M20 6a9 9 0 0 1 0 12"></path><path d="M23 4a12 12 0 0 1 0 16"></path>`;

    return `
        <svg viewBox="0 0 26 24" focusable="false" aria-hidden="true">
            <path d="M3 9v6h5l6 5V4L8 9H3z"></path>
            ${waves}
        </svg>
    `;
}

function syncScreenWakeLock(): void {
    screenWakeLock.setDesired(
        ownership.isCurrent(gameOwnershipEpoch) && (pwaSessionState === "running" || (pwaSessionState === "starting" && !liveMenuOpen && gameLaunchInProgress))
    );
}

function destroyGame(): boolean {
    pwaSessionState = "stopping";
    menuRequestSerial++;
    sessionGeneration.invalidate();
    activeSessionGeneration = 0;
    gameLaunchInProgress = false;
    const oldGame = game;
    const oldContainer = container;
    sessionCleanup.run(
        () => syncScreenWakeLock(),
        () => oldContainer?.setLoopSuspended(true),
        () => oldGame?.setBrowserSuspended(true),
        () => oldContainer?.getInput().pause(),
        () => oldGame?.invalidateBrowserLifetime(),
        () => releaseGameAudio(),
        () => removeMenuOverlay(),
        () => viewport.stopHamburgerVisibilityMonitor(),
        () => oldGame?.stopAllSounds(),
        () => viewport.stopCursorAutoHide(),
        () => viewport.stopResponsiveSizing(),
        () => {
            if (oldContainer !== null) {
                oldContainer.destroy();
            } else {
                SoundStore.get().stopAllPlayback();
            }
        },
        () => viewport.clear(),
        () => runtimeLoader.prepared?.slick.Display.setParent(null)
    );
    container = null;
    game = null;
    menuOverlay = null;
    liveMenuOpen = false;
    activeScalableGame = null;
    if (!sessionCleanup.safe) {
        showCleanupFailure();
    }
    return sessionCleanup.safe;
}

function saveCurrentGameState(): boolean {
    if (!ownership.owned) {
        return false;
    }
    if (!game || !game.isStateSaveReady()) {
        return false;
    }
    const store = getLoadedGameStateStore();
    if (store === null) {
        return false;
    }
    return store.save(game);
}

function getGameStateStore(runtime: PreparedRuntime): MsPacManGameStateStore {
    if (gameStateStore === null) {
        gameStateStore = new runtime.MsPacManGameStateStore(APP_VERSION);
    }
    return gameStateStore;
}

function getLoadedGameStateStore(): MsPacManGameStateStore | null {
    if (gameStateStore !== null) {
        return gameStateStore;
    }
    if (runtimeLoader.prepared === null) {
        return null;
    }
    return getGameStateStore(runtimeLoader.prepared);
}

function hasPotentialSavedGameState(): boolean {
    try {
        const text = localStorage.getItem(createBrowserStorageKeys().gameState);
        return text !== null && text.length <= MAX_SNAPSHOT_TEXT_LENGTH && isValidMsPacManGameStateSnapshot(JSON.parse(text) as unknown);
    } catch {
        return false;
    }
}

function clearStoredGameState(): void {
    if (!ownership.owned) {
        return;
    }
    preferences.clearGameState();
    gameStateStore?.clear();
}

function resetPwaState(): void {
    if (!canActivateFromMenu()) {
        return;
    }
    if (!destroyGame()) {
        return;
    }
    pwaSessionState = "menu";
    preferences.reset();
    gameStateStore?.clear();
    volume = DEFAULT_VOLUME;
    scalingPreference = DEFAULT_SCALING_PREFERENCE;
    applyApplicationAudioPreferences();
    renderMenuUi(app, false, "", false);
}

function hasLiveSuspendedGame(): boolean {
    return (
        pwaSessionState === "menu" &&
        liveMenuOpen &&
        menuOverlay !== null &&
        game !== null &&
        container !== null &&
        viewport.gameHost !== null &&
        !game.isLoadingScreenActive()
    );
}

function suspendGameForMenu(): boolean {
    return sessionCleanup.run(
        () => container?.setLoopSuspended(true),
        () => game?.setBrowserSuspended(true),
        () => container?.getInput().pause(),
        () => releaseGameAudio()
    );
}

async function showLiveMenuOverlay(): Promise<void> {
    if (pwaSessionState !== "running" || game === null || container === null || viewport.gameShell === null) {
        return;
    }
    const session = activeSessionGeneration;
    pwaSessionState = "stopping";
    liveMenuOpen = true;
    sessionCleanup.run(() => syncScreenWakeLock());
    suspendGameForMenu();
    const saved = sessionCleanup.trySave(saveCurrentGameState);
    sessionCleanup.run(
        () => viewport.stopHamburgerVisibilityMonitor(),
        () => viewport.hideHamburger(),
        () => viewport.stopCursorAutoHide()
    );
    if (!sessionCleanup.safe) {
        destroyGame();
        return;
    }
    if (!(await viewport.exitFullscreenForMenu())) {
        return;
    }
    if (!isCurrentGameSession(session) || pwaSessionState !== "stopping" || game === null || container === null) {
        return;
    }
    if (
        !sessionCleanup.run(() => {
            menuOverlay = renderMenuUi(app, true, saved ? "" : "Progress could not be saved. Continue still preserves this live game.", true);
        })
    ) {
        destroyGame();
        return;
    }
    pwaSessionState = "menu";
    syncScreenWakeLock();
}

async function resumeLiveGameFromMenu(): Promise<void> {
    if (!canActivateFromMenu() || !hasLiveSuspendedGame() || game === null || container === null || menuOverlay === null || container.isGraphicsContextLost()) {
        return;
    }
    const liveGame = game;
    const liveContainer = container;
    const liveOverlay = menuOverlay;
    const liveHost = viewport.gameHost;
    const session = activeSessionGeneration;
    pwaSessionState = "starting";
    applyApplicationAudioPreferences();
    const audio = beginGameAudio();
    requestPreferredFullscreen();
    try {
        if (!(await audio.ready) || !isStartingGameSession(session, audio) || game !== liveGame || container !== liveContainer || menuOverlay !== liveOverlay) {
            return;
        }
        applyVolume();
        if (
            !(await commitGameAudio(audio)) ||
            !isStartingGameSession(session, audio) ||
            game !== liveGame ||
            container !== liveContainer ||
            menuOverlay !== liveOverlay
        ) {
            return;
        }
        viewport.reconcileDisplayModeNow();
        viewport.scheduleResize();
        viewport.focusCanvas();
        if (!isStartingGameSession(session, audio)) {
            return;
        }
        liveContainer.getInput().resume();
        liveContainer.getInput().clearKeyPressedRecord();
        liveGame.input.clearKeyPressedRecord();
        if (!isStartingGameSession(session, audio)) {
            return;
        }
        pwaSessionState = "running";
        removeMenuOverlay();
        if (!isCurrentGameSession(session) || !isGameAudioCurrent(audio) || pwaSessionState !== "running" || game !== liveGame || container !== liveContainer) {
            return;
        }
        if (liveHost !== null) {
            viewport.startCursorAutoHide(liveHost);
        }
        viewport.startHamburgerVisibilityMonitor();
        liveGame.setBrowserSuspended(false);
        if (!isCurrentGameSession(session) || !isGameAudioCurrent(audio) || pwaSessionState !== "running") {
            return;
        }
        liveContainer.setLoopSuspended(false);
        syncScreenWakeLock();
    } catch (error) {
        if (isGameAudioLatest(audio) && isCurrentGameSession(session)) {
            console.error("Unable to continue the playback session.", error);
            requestPwaMenu("continue-failed");
        }
    } finally {
        if (
            isGameAudioLatest(audio) &&
            isCurrentGameSession(session) &&
            pwaSessionState === "starting" &&
            game === liveGame &&
            container === liveContainer &&
            menuOverlay === liveOverlay
        ) {
            requestPwaMenu("continue-not-accepted");
        }
    }
}

function removeMenuOverlay(): void {
    const overlay = menuOverlay;
    menuOverlay = null;
    liveMenuOpen = false;
    overlay?.remove();
}

function handleGamePauseStateChanged(paused: boolean): void {
    const host = viewport.gameHost;
    if (paused) {
        viewport.stopCursorAutoHide();
    } else if (host !== null && pwaSessionState === "running") {
        viewport.startCursorAutoHide(host);
    }
}

function returnToMenu(): void {
    requestPwaMenu("hamburger");
}

function requestPwaMenu(_reason: string): void {
    if (pwaSessionState === "booting" || pwaSessionState === "menu" || pwaSessionState === "stopping" || pwaSessionState === "error") {
        return;
    }
    if (
        pwaSessionState === "running" &&
        game !== null &&
        container !== null &&
        viewport.gameHost !== null &&
        !game.isLoadingScreenActive() &&
        !container.isDestroyed()
    ) {
        void showLiveMenuOverlay();
        return;
    }
    const retainExistingOverlay = liveMenuOpen && menuOverlay !== null && game !== null && container !== null;
    const session = activeSessionGeneration;
    pwaSessionState = "stopping";
    sessionCleanup.run(() => syncScreenWakeLock());
    suspendGameForMenu();
    sessionCleanup.trySave(saveCurrentGameState);
    if (!sessionCleanup.safe) {
        destroyGame();
        return;
    }
    if (retainExistingOverlay) {
        void restoreExistingLiveMenuAfterInterruptedResume(session);
    } else {
        renderMenu();
    }
}

async function restoreExistingLiveMenuAfterInterruptedResume(session: number): Promise<void> {
    if (!(await viewport.exitFullscreenForMenu())) {
        return;
    }
    if (!isCurrentGameSession(session) || pwaSessionState !== "stopping" || !liveMenuOpen || menuOverlay === null || game === null || container === null) {
        return;
    }
    pwaSessionState = "menu";
    syncScreenWakeLock();
}

function reportResponsiveResizeError(error: unknown, generation: number): void {
    if (generation === 0 || !isCurrentGameSession(generation)) {
        return;
    }
    console.error(error);
    suspendGameForMenu();
    sessionCleanup.trySave(saveCurrentGameState);
    if (!destroyGame()) {
        return;
    }
    renderLoadError(error);
}

function handleBrowserReservedKey(event: KeyboardEvent): void {
    if (pwaSessionState !== "starting" && pwaSessionState !== "running") {
        return;
    }
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestPwaMenu("escape");
    }
}

function setupGlobalErrorHandlers(): void {
    window.addEventListener("error", (event) => {
        showStartupError(event.error ?? event.message);
    });
    window.addEventListener("unhandledrejection", (event) => {
        showStartupError(event.reason);
    });
}

function setupPageLifecycleHandlers(): void {
    window.addEventListener("pagehide", () => requestPwaMenu("pagehide"));
    window.addEventListener("blur", () => requestPwaMenu("blur"));
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            requestPwaMenu("hidden");
        }
    });
}

function showStartupError(error: unknown): void {
    if (ownership.owned && app.childElementCount === 0) {
        renderMenu(formatError(error));
    }
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function releaseOwnedSession(): void {
    pwaSessionState = "stopping";
    sessionGeneration.invalidate();
    menuRequestSerial++;
    sessionCleanup.run(() => syncScreenWakeLock());
    suspendGameForMenu();
    sessionCleanup.trySave(saveCurrentGameState);
    destroyGame();
    if (sessionCleanup.safe) {
        pwaSessionState = "menu";
    }
    sessionCleanup.assertSafe();
}

function showCleanupFailure(): void {
    pwaSessionState = "error";
    try {
        screenWakeLock.setDesired(false);
    } catch (error) {
        console.error("Unable to release screen wake intent.", error);
    }
    console.error("Session cleanup requires a reload.", sessionCleanup.failure);
    try {
        app.innerHTML =
            '<main class="boot-screen" role="alert"><section class="load-error-panel"><p>This session could not be stopped safely. Reload this tab before continuing.</p><button type="button" id="session-reload">Reload</button></section></main>';
        app.querySelector<HTMLButtonElement>("#session-reload")?.addEventListener("click", () => window.location.reload());
    } catch (error) {
        console.error("Unable to display the reload message.", error);
    }
}
