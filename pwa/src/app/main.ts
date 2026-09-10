import { releaseGameAudio, unlockGameAudio } from "./AudioUnlock.js";
import "./styles.css";
import { GameSessionOwnership } from "./GameSessionOwnership.js";
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
import { isFutureMsPacManGameStateSnapshot, isValidMsPacManGameStateSnapshot } from "../mspacman/persistence/MsPacManGameStateSerializer";

const app = document.querySelector<HTMLDivElement>("#app");
const GAME_CURSOR_HIDE_DELAY_MS = 3000;
const HIGH_DPI_ENABLED = true;
const MAX_DEVICE_PIXEL_RATIO = 4;
const SCALING_MODE_DEFINITIONS: readonly { value: ScalingPreference; label: string }[] = [
    { value: "smooth", label: "Smooth" },
    { value: "crisp", label: "Crisp" },
    { value: "pixel-perfect", label: "Pixel Perfect" }
];
const PICKER_BREATHING_ROOM_PX = 2;
type ScalingModeDefinition = (typeof SCALING_MODE_DEFINITIONS)[number];
type PwaSessionState = "booting" | "menu" | "starting" | "running" | "stopping";

if (!app) {
    throw new Error("Missing #app root.");
}

let container: AppGameContainer | null = null;
let game: MsPacManMain | null = null;
let activeScalableGame: ScalableGame2 | null = null;
let activeGameHost: HTMLElement | null = null;
let menuOverlay: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeAnimationFrame = 0;
let hamburgerVisibilityAnimationFrame = 0;
let cursorGameHost: HTMLElement | null = null;
let cursorHideTimer = 0;
let pointerOverGameHost = false;
let liveMenuOpen = false;
let gameLaunchInProgress = false;
let pwaSessionState: PwaSessionState = "booting";
const preferences = new BrowserPreferences();
const sessionGeneration = new SessionGeneration();
const runtimeLoader = new RuntimeLoader(refreshVisibleBootProgress);
const screenWakeLock = new ScreenWakeLockManager();
let gameStateStore: MsPacManGameStateStore | null = null;
let volume = preferences.volume;
let scalingPreference: ScalingPreference = preferences.scaling;
let activeSessionGeneration = 0;
const ownership = new GameSessionOwnership(
    app,
    startPwaMenu,
    () => {
        saveCurrentGameState();
        destroyGame();
        pwaSessionState = "menu";
    }
);
window.__msPacManResourcesPrepared = false;
if (!window.__msPacManBootFailed) {
    setupGlobalErrorHandlers();
    setupPageLifecycleHandlers();
    void registerServiceWorker(CACHE_BUST);
    ownership.start();
}

function startPwaMenu(): void {
    pwaSessionState = "booting";
    renderBoot(runtimeLoader.progress);
    void runtimeLoader
        .prepare(runtimeLoader.error !== null)
        .then(() => {
            if (pwaSessionState !== "booting") {
                return;
            }
            window.__msPacManResourcesPrepared = true;
            pwaSessionState = "menu";
            renderMenuUi(app, hasPotentialSavedGameState(), "", false);
            window.__msPacManBooted = true;
        })
        .catch((error) => {
            console.error(error);
            if (pwaSessionState !== "booting") {
                return;
            }
            pwaSessionState = "menu";
            renderBootLoadError(error);
        });
}

function renderMenu(errorText = ""): void {
    destroyGame();
    pwaSessionState = "menu";
    renderMenuUi(app, hasPotentialSavedGameState(), errorText, false);
}

function renderMenuUi(parent: HTMLElement, canContinue: boolean, errorText: string, overlay: boolean): HTMLElement {
    const menuRoot = document.createElement("main");
    menuRoot.className = overlay ? "shell menu-overlay" : "shell";
    if (overlay) {
        menuRoot.dataset.liveMenu = "true";
    }
    menuRoot.innerHTML = `
        <section class="menu" aria-label="Ms. Pac-Man 2010 menu">
            <div class="menu-actions">
                <div class="setting-scaling-row" role="group" aria-label="Scaling">
                    <span>Scaling</span>
                    ${scalingPickerHtml()}
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
    const scalingPicker = menuRoot.querySelector<HTMLElement>("#scaling-picker");
    const scalingButton = menuRoot.querySelector<HTMLButtonElement>("#scaling-button");
    const scalingPopup = menuRoot.querySelector<HTMLElement>("#scaling-popup");
    const scalingList = menuRoot.querySelector<HTMLElement>("#scaling-list");
    const newGameButton = menuRoot.querySelector<HTMLButtonElement>("#newGameButton");
    const continueButton = menuRoot.querySelector<HTMLButtonElement>("#continueButton");
    const resetButton = menuRoot.querySelector<HTMLButtonElement>("#resetButton");

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
        clearStoredGameState();
        void startGame(false);
    });

    continueButton?.addEventListener("click", () => {
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
    if (pwaSessionState !== "menu") {
        return;
    }
    destroyGame();
    pwaSessionState = "starting";
    const audioUnlockPromise = unlockAudio();
    gameLaunchInProgress = true;
    syncScreenWakeLock();
    const generation = sessionGeneration.begin();
    let runtimePrepared = false;
    if (runtimeLoader.prepared === null) {
        renderBoot(runtimeLoader.progress);
    }
    try {
        const runtime = await runtimeLoader.prepare(runtimeLoader.error !== null);
        if (!sessionGeneration.isCurrent(generation) || pwaSessionState !== "starting") {
            return;
        }
        runtimePrepared = true;
        await audioUnlockPromise;
        if (!sessionGeneration.isCurrent(generation) || pwaSessionState !== "starting") {
            return;
        }
        renderGameHost();
        if (!sessionGeneration.isCurrent(generation) || pwaSessionState !== "starting") {
            return;
        }
        await mountGame(runtime, restoreSavedGame, generation);
    } catch (error) {
        if (!sessionGeneration.isCurrent(generation)) {
            return;
        }
        console.error(error);
        destroyGame();
        pwaSessionState = "menu";
        if (restoreSavedGame && runtimePrepared) {
            renderMenuUi(app, hasPotentialSavedGameState(), "", false);
            return;
        }
        renderLoadError(error, restoreSavedGame);
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

function renderLoadError(error: unknown, restoreSavedGame = false): void {
    void error;
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
    document.querySelector<HTMLButtonElement>("#retryButton")?.addEventListener("click", () => {
        void startGame(restoreSavedGame);
    });
}

function renderGameHost(): void {
    app.innerHTML = `
        <div class="game-host" id="gameHost"></div>
        <button class="hamburger" id="menuButton" type="button" aria-label="Return to menu" hidden>
            <span></span>
        </button>
    `;
    document.querySelector<HTMLButtonElement>("#menuButton")?.addEventListener("click", () => {
        returnToMenu();
    });
}

async function mountGame(runtime: PreparedRuntime, restoreSavedGame: boolean, generation: number): Promise<void> {
    if (!sessionGeneration.isCurrent(generation) || pwaSessionState !== "starting") {
        return;
    }
    const host = document.querySelector<HTMLDivElement>("#gameHost");
    if (!host) {
        throw new Error("Missing game host.");
    }

    const mainGame = new runtime.Main();
    const scalableGame = new runtime.ScalableGame2(mainGame, 800, 600, true);
    scalableGame.setScalingPreference(scalingPreference);
    const appContainer = new runtime.slick.AppGameContainer(scalableGame);
    appContainer.setPreserveAudioCacheOnDestroy(true);
    appContainer.setLoopSuspended(true);
    appContainer.setHighDpiEnabled(HIGH_DPI_ENABLED);
    appContainer.setMaxDevicePixelRatio(MAX_DEVICE_PIXEL_RATIO);
    mainGame.appGameContainer = appContainer;
    mainGame.windowedDisplayModeProvider = getResponsiveWindowedDisplayMode;
    mainGame.pauseStateChangeHandler = handleGamePauseStateChanged;
    // Own STARTING resources immediately so blur/hidden/pagehide can destroy them
    // before any asynchronous display/container startup continuation resolves.
    container = appContainer;
    game = mainGame;
    activeScalableGame = scalableGame;
    activeGameHost = host;
    activeSessionGeneration = generation;
    if (restoreSavedGame) {
        mainGame.loadingCompleteHandler = (gc: GameContainer): boolean => {
            if (!getGameStateStore(runtime).restore(mainGame, gc)) {
                throw new Error("Saved game could not be restored.");
            }
            return true;
        };
    }

    try {
        if (!sessionGeneration.isCurrent(generation) || pwaSessionState !== "starting") {
            mainGame.invalidateBrowserLifetime();
            appContainer.destroy();
            return;
        }
        runtime.slick.Display.setParent(host);
        const displayMode = getResponsiveWindowedDisplayMode();
        await appContainer.setDisplayMode(displayMode.width, displayMode.height, false);
        if (!sessionGeneration.isCurrent(generation) || pwaSessionState !== "starting") {
            mainGame.invalidateBrowserLifetime();
            appContainer.destroy();
            return;
        }
        appContainer.setAlwaysRender(true);
        appContainer.setVSync(true);
        appContainer.setSmoothDeltas(false);
        appContainer.setShowFPS(false);
        appContainer.setClearEachFrame(true);
        await appContainer.start();
        if (!sessionGeneration.isCurrent(generation) || pwaSessionState !== "starting") {
            mainGame.invalidateBrowserLifetime();
            appContainer.destroy();
            return;
        }
        await runtime.slick.ResourceLoader.waitForAll();
        if (!sessionGeneration.isCurrent(generation) || pwaSessionState !== "starting") {
            mainGame.invalidateBrowserLifetime();
            appContainer.destroy();
            return;
        }
        container = appContainer;
        game = mainGame;
        activeScalableGame = scalableGame;
        activeGameHost = host;
        activeSessionGeneration = generation;
        appContainer.setErrorHandler((error) => {
            if (!sessionGeneration.isCurrent(generation)) {
                return;
            }
            console.error(error);
            destroyGame();
            renderLoadError(error, restoreSavedGame);
        });
        startResponsiveGameSizing(host);
        startGameCursorAutoHide(host);
        startHamburgerVisibilityMonitor();
        applyVolume();
        focusGameCanvas();
        gameLaunchInProgress = false;
        pwaSessionState = "running";
        mainGame.setBrowserSuspended(false);
        appContainer.setLoopSuspended(false);
        syncScreenWakeLock();
        if (document.visibilityState !== "visible" || !document.hasFocus()) {
            requestPwaMenu("launch-lost-focus");
        }
    } catch (error) {
        mainGame.invalidateBrowserLifetime();
        appContainer.destroy();
        releaseGameAudio();
        if (sessionGeneration.isCurrent(generation)) {
            runtime.slick.Display.setParent(null);
        }
        throw error;
    }
}

async function unlockAudio(): Promise<void> {
    await unlockGameAudio();
}

function applyVolume(): void {
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
    window.__msPacManResourcesPrepared = runtimeLoader.progress >= 1;
    if (app.querySelector("[data-boot-progress='true']") !== null) {
        renderBoot(runtimeLoader.progress);
    }
}

function setScalingPreference(value: ScalingPreference): void {
    scalingPreference = value;
    preferences.setScaling(value);
    activeScalableGame?.setScalingPreference(value);
    scheduleResponsiveGameResize();
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
            <button id="scaling-button" class="theme-picker-button scaling-picker-button" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="scaling-list">
                <span class="theme-picker-label scaling-picker-label">${escapeHtml(selectedDefinition.label)}</span>
                <span class="picker-caret" aria-hidden="true"></span>
            </button>
            <div id="scaling-popup" class="theme-picker-popup scaling-picker-popup" hidden>
                <div id="scaling-list" class="theme-picker-list scaling-picker-list" role="listbox" aria-label="Scaling">
                    ${SCALING_MODE_DEFINITIONS.map((definition) => scalingOptionHtml(definition)).join("")}
                </div>
            </div>
        </div>`;
}

function scalingOptionHtml(definition: ScalingModeDefinition): string {
    return `
        <button class="theme-picker-option scaling-picker-option" type="button" role="option" aria-selected="${definition.value === scalingPreference}" data-scaling-mode="${definition.value}">
            <span>${escapeHtml(definition.label)}</span>
            <span class="picker-caret-placeholder" aria-hidden="true"></span>
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
    screenWakeLock.setDesired(pwaSessionState === "running" || (pwaSessionState === "starting" && !liveMenuOpen && gameLaunchInProgress));
}

function destroyGame(): void {
    sessionGeneration.invalidate();
    activeSessionGeneration = 0;
    gameLaunchInProgress = false;
    game?.invalidateBrowserLifetime();
    releaseGameAudio();
    removeMenuOverlay();
    stopHamburgerVisibilityMonitor();
    stopGameCursorAutoHide();
    stopResponsiveGameSizing();
    game?.stopAllSounds();
    activeScalableGame = null;
    if (container !== null) {
        container.destroy();
        container = null;
    } else {
        SoundStore.get().stopAllPlayback();
    }
    game = null;
    activeGameHost = null;
    runtimeLoader.prepared?.slick.Display.setParent(null);
    syncScreenWakeLock();
}

function saveCurrentGameState(): boolean {
    if (!ownership.owned) return false;
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
    let text: string | null;
    try {
        text = localStorage.getItem(createBrowserStorageKeys().gameState);
    } catch {
        return false;
    }
    if (text === null || text.length > MAX_SNAPSHOT_TEXT_LENGTH) {
        return false;
    }

    let snapshot: unknown;
    try {
        snapshot = JSON.parse(text) as unknown;
    } catch {
        clearStoredGameState();
        return false;
    }

    if (isValidMsPacManGameStateSnapshot(snapshot)) {
        return true;
    }
    if (isFutureMsPacManGameStateSnapshot(snapshot)) {
        return false;
    }
    clearStoredGameState();
    return false;
}

function clearStoredGameState(): void {
    preferences.clearGameState();
    gameStateStore?.clear();
}

function resetPwaState(): void {
    destroyGame();
    pwaSessionState = "menu";
    preferences.reset();
    gameStateStore?.clear();
    volume = DEFAULT_VOLUME;
    scalingPreference = DEFAULT_SCALING_PREFERENCE;
    applyVolumeToRuntime();
    renderMenuUi(app, false, "", false);
}

function hasLiveSuspendedGame(): boolean {
    return (
        pwaSessionState === "menu" &&
        liveMenuOpen &&
        menuOverlay !== null &&
        game !== null &&
        container !== null &&
        activeGameHost !== null &&
        !game.isLoadingScreenActive()
    );
}

function showLiveMenuOverlay(): void {
    if (!game || !container || !activeGameHost || liveMenuOpen || pwaSessionState !== "running") {
        return;
    }

    pwaSessionState = "stopping";
    liveMenuOpen = true;
    syncScreenWakeLock();
    const saved = saveCurrentGameState();
    game.setBrowserSuspended(true);
    container.stopSoundEffects();
    container.setLoopSuspended(true);
    container.getInput().pause();
    game.input.clearKeyPressedRecord();
    stopHamburgerVisibilityMonitor();
    setHamburgerHidden(true);
    stopGameCursorAutoHide();
    releaseGameAudio();
    menuOverlay = renderMenuUi(app, true, saved ? "" : "Unable to save game state.", true);
    pwaSessionState = "menu";
    syncScreenWakeLock();
}

async function resumeLiveGameFromMenu(): Promise<void> {
    const currentGame = game;
    const currentContainer = container;
    const host = activeGameHost;
    const currentOverlay = menuOverlay;
    if (!hasLiveSuspendedGame() || !currentGame || !currentContainer || !host || !currentOverlay) {
        return;
    }

    pwaSessionState = "starting";
    const audioUnlockPromise = unlockAudio();
    await audioUnlockPromise;
    if (
        pwaSessionState !== "starting" ||
        game !== currentGame ||
        container !== currentContainer ||
        activeGameHost !== host ||
        menuOverlay !== currentOverlay ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
    ) {
        releaseGameAudio();
        if (game === currentGame && container === currentContainer && menuOverlay === currentOverlay) {
            pwaSessionState = "menu";
        }
        return;
    }

    removeMenuOverlay();
    currentContainer.getInput().resume();
    currentContainer.getInput().clearKeyPressedRecord();
    currentGame.input.clearKeyPressedRecord();
    startGameCursorAutoHide(host);
    startHamburgerVisibilityMonitor();
    applyVolume();
    scheduleResponsiveGameResize();
    focusGameCanvas();
    currentGame.setBrowserSuspended(false);
    currentContainer.setLoopSuspended(false);
    pwaSessionState = "running";
    syncScreenWakeLock();
}

function removeMenuOverlay(): void {
    menuOverlay?.remove();
    menuOverlay = null;
    liveMenuOpen = false;
}

function focusGameCanvas(): void {
    const canvas = activeGameHost?.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) {
        return;
    }
    canvas.tabIndex = -1;
    canvas.focus({ preventScroll: true });
}

function returnToMenu(): void {
    requestPwaMenu("hamburger");
}

function requestPwaMenu(_reason: string): void {
    if (pwaSessionState === "booting" || pwaSessionState === "menu" || pwaSessionState === "stopping") {
        return;
    }
    if (pwaSessionState === "starting" && liveMenuOpen) {
        releaseGameAudio();
        pwaSessionState = "menu";
        syncScreenWakeLock();
        return;
    }
    if (game && container && activeGameHost && !game.isLoadingScreenActive() && game.isStateSaveReady()) {
        showLiveMenuOverlay();
        return;
    }
    saveCurrentGameState();
    renderMenu();
}

function startGameCursorAutoHide(host: HTMLElement): void {
    stopGameCursorAutoHide();
    cursorGameHost = host;
    pointerOverGameHost = isElementHovered(host);
    host.addEventListener("pointerenter", handleGamePointerEnter);
    host.addEventListener("pointerleave", handleGamePointerLeave);
    host.addEventListener("pointermove", handleGameMouseInput);
    host.addEventListener("pointerdown", handleGameMouseInput);
    host.addEventListener("pointerup", handleGameMouseInput);
    host.addEventListener("wheel", handleGameMouseInput, { passive: true });
    showGameCursor();
    scheduleGameCursorHide();
}

function stopGameCursorAutoHide(): void {
    if (cursorGameHost) {
        cursorGameHost.removeEventListener("pointerenter", handleGamePointerEnter);
        cursorGameHost.removeEventListener("pointerleave", handleGamePointerLeave);
        cursorGameHost.removeEventListener("pointermove", handleGameMouseInput);
        cursorGameHost.removeEventListener("pointerdown", handleGameMouseInput);
        cursorGameHost.removeEventListener("pointerup", handleGameMouseInput);
        cursorGameHost.removeEventListener("wheel", handleGameMouseInput);
        cursorGameHost.classList.remove("cursor-hidden");
    }
    clearGameCursorHideTimer();
    pointerOverGameHost = false;
    cursorGameHost = null;
}

function handleGamePointerEnter(): void {
    pointerOverGameHost = true;
    handleGameMouseInput();
}

function handleGamePointerLeave(): void {
    pointerOverGameHost = false;
    showGameCursor();
    clearGameCursorHideTimer();
}

function handleGameMouseInput(): void {
    showGameCursor();
    scheduleGameCursorHide();
}

function handleGamePauseStateChanged(paused: boolean): void {
    showGameCursor();
    if (paused) {
        clearGameCursorHideTimer();
    } else {
        scheduleGameCursorHide();
    }
}

function scheduleGameCursorHide(): void {
    clearGameCursorHideTimer();
    if (!cursorGameHost || !pointerOverGameHost || game?.paused) {
        return;
    }
    cursorHideTimer = window.setTimeout(() => {
        cursorHideTimer = 0;
        hideGameCursorIfIdle();
    }, GAME_CURSOR_HIDE_DELAY_MS);
}

function hideGameCursorIfIdle(): void {
    if (!cursorGameHost || !pointerOverGameHost || game?.paused) {
        showGameCursor();
        return;
    }
    cursorGameHost.classList.add("cursor-hidden");
}

function showGameCursor(): void {
    cursorGameHost?.classList.remove("cursor-hidden");
}

function clearGameCursorHideTimer(): void {
    if (cursorHideTimer !== 0) {
        clearTimeout(cursorHideTimer);
        cursorHideTimer = 0;
    }
}

function isElementHovered(element: HTMLElement): boolean {
    try {
        return element.matches(":hover");
    } catch {
        return false;
    }
}

function startHamburgerVisibilityMonitor(): void {
    stopHamburgerVisibilityMonitor();
    updateHamburgerVisibility();
}

function stopHamburgerVisibilityMonitor(): void {
    if (hamburgerVisibilityAnimationFrame !== 0) {
        cancelAnimationFrame(hamburgerVisibilityAnimationFrame);
        hamburgerVisibilityAnimationFrame = 0;
    }
}

function updateHamburgerVisibility(): void {
    const hidden = pwaSessionState !== "running" || game === null || game.isLoadingScreenActive();
    setHamburgerHidden(hidden);
    if (hidden && game !== null && game.isLoadingScreenActive()) {
        hamburgerVisibilityAnimationFrame = requestAnimationFrame(() => {
            hamburgerVisibilityAnimationFrame = 0;
            updateHamburgerVisibility();
        });
    }
}

function setHamburgerHidden(hidden: boolean): void {
    const hamburger = document.querySelector<HTMLButtonElement>("#menuButton");
    if (hamburger) {
        hamburger.hidden = hidden;
    }
}

function startResponsiveGameSizing(host: HTMLElement): void {
    stopResponsiveGameSizing();
    activeGameHost = host;
    if ("ResizeObserver" in window) {
        resizeObserver = new ResizeObserver(scheduleResponsiveGameResize);
        resizeObserver.observe(host);
    }
    window.addEventListener("resize", scheduleResponsiveGameResize);
    document.addEventListener("fullscreenchange", scheduleResponsiveGameResize);
    scheduleResponsiveGameResize();
}

function stopResponsiveGameSizing(): void {
    resizeObserver?.disconnect();
    resizeObserver = null;
    activeGameHost = null;
    window.removeEventListener("resize", scheduleResponsiveGameResize);
    document.removeEventListener("fullscreenchange", scheduleResponsiveGameResize);
    if (resizeAnimationFrame !== 0) {
        cancelAnimationFrame(resizeAnimationFrame);
        resizeAnimationFrame = 0;
    }
}

function scheduleResponsiveGameResize(): void {
    if (resizeAnimationFrame !== 0) {
        return;
    }
    const generation = activeSessionGeneration;
    resizeAnimationFrame = requestAnimationFrame(() => {
        resizeAnimationFrame = 0;
        if (generation !== 0 && sessionGeneration.isCurrent(generation)) {
            applyResponsiveWindowedDisplayMode(generation);
        }
    });
}

function applyResponsiveWindowedDisplayMode(generation: number): void {
    if (!sessionGeneration.isCurrent(generation) || !container || !activeGameHost || container.isFullscreen() || document.fullscreenElement !== null) {
        return;
    }

    const displayMode = getResponsiveWindowedDisplayMode();
    try {
        void Promise.resolve(container.setDisplayMode(displayMode.width, displayMode.height, false)).catch((error) =>
            reportResponsiveResizeError(error, generation)
        );
    } catch (error) {
        reportResponsiveResizeError(error, generation);
    }
}

function reportResponsiveResizeError(error: unknown, generation: number): void {
    if (!sessionGeneration.isCurrent(generation)) {
        return;
    }
    console.error(error);
    const restoreSavedGame = saveCurrentGameState();
    destroyGame();
    renderLoadError(error, restoreSavedGame);
}

function getResponsiveWindowedDisplayMode(): { width: number; height: number } {
    const host = activeGameHost ?? document.querySelector<HTMLElement>("#gameHost");
    const fallbackWidth = window.innerWidth || 800;
    const fallbackHeight = window.innerHeight || 600;
    if (!host) {
        return {
            width: Math.max(1, Math.trunc(fallbackWidth)),
            height: Math.max(1, Math.trunc(fallbackHeight))
        };
    }

    const rect = host.getBoundingClientRect();
    const width = host.clientWidth || rect.width || fallbackWidth;
    const height = host.clientHeight || rect.height || fallbackHeight;
    return {
        width: Math.max(1, Math.trunc(width)),
        height: Math.max(1, Math.trunc(height))
    };
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
    if (app.childElementCount === 0) {
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
