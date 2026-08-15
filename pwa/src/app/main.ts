import "./styles.css";
import type { GameContainer } from "slick2d-ts";
import { SoundStore } from "slick2d-ts/slick/openal/SoundStore";
import { ResourceLoader } from "slick2d-ts/slick/util/ResourceLoader";
import { RESOURCE_REFS } from "./resourceManifest";
import { APP_VERSION, CACHE_BUST } from "./version";
import type { Main as MsPacManMain } from "../mspacman/Main";
import type { MsPacManGameStateStore } from "../mspacman/persistence/MsPacManGameStateStore";

type SlickRuntime = typeof import("slick2d-ts");
type MainConstructor = typeof import("../mspacman/Main").Main;
type ScalableGame2Constructor = typeof import("../mspacman/ScalableGame2").ScalableGame2;
type MsPacManGameStateStoreConstructor =
    typeof import("../mspacman/persistence/MsPacManGameStateStore").MsPacManGameStateStore;

type PreparedRuntime = {
    slick: SlickRuntime;
    Main: MainConstructor;
    ScalableGame2: ScalableGame2Constructor;
    MsPacManGameStateStore: MsPacManGameStateStoreConstructor;
};

type RuntimeInput = {
    clearKeyPressedRecord(): void;
    pause(): void;
    resume(): void;
};

type RuntimeContainer = {
    destroy(): void;
    getInput(): RuntimeInput;
    isFullscreen(): boolean;
    setAlwaysRender(alwaysRender: boolean): void;
    setClearEachFrame(clearEachFrame: boolean): void;
    setDisplayMode(width: number, height: number, fullscreen: boolean): Promise<void> | void;
    setErrorHandler(errorHandler: (error: unknown) => void): void;
    setHighDpiEnabled(enabled: boolean): void;
    setLoopSuspended(suspended: boolean): void;
    setMaxDevicePixelRatio(maxDevicePixelRatio: number): void;
    setPreserveAudioCacheOnDestroy(preserve: boolean): void;
    setMusicVolume(volume: number): void;
    setShowFPS(showFPS: boolean): void;
    setSmoothDeltas(smoothDeltas: boolean): void;
    setSoundVolume(volume: number): void;
    setVSync(vsync: boolean): void;
    start(): Promise<void>;
    stopSoundEffects(): void;
};

const app = document.querySelector<HTMLDivElement>("#app");
const GAME_CURSOR_HIDE_DELAY_MS = 3000;
const HIGH_DPI_ENABLED = true;
const MAX_DEVICE_PIXEL_RATIO = 2;
const RESOURCE_CACHE_RETRY_COUNT = 3;
const RESOURCE_CACHE_RETRY_DELAY_MS = 300;
const GAME_STATE_STORAGE_KEY = "ms-pac-man-2010.game-state";
const GAME_STATE_VERSION = 1;

if (!app) {
    throw new Error("Missing #app root.");
}

let container: RuntimeContainer | null = null;
let game: MsPacManMain | null = null;
let activeGameHost: HTMLElement | null = null;
let menuOverlay: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeAnimationFrame = 0;
let hamburgerVisibilityAnimationFrame = 0;
let cursorGameHost: HTMLElement | null = null;
let cursorHideTimer = 0;
let pointerOverGameHost = false;
let liveMenuOpen = false;
let suspendedByVisibilityLoss = document.visibilityState !== "visible";
let suspendedByFocusLoss = !document.hasFocus();
let preparedRuntime: PreparedRuntime | null = null;
let preparationPromise: Promise<PreparedRuntime> | null = null;
let preparationError: unknown = null;
let preparationProgress = 0;
let backgroundPreparationScheduled = false;
let gameStateStore: MsPacManGameStateStore | null = null;
let volume = safeReadVolume();

setupGlobalErrorHandlers();
setupPageLifecycleHandlers();
void registerServiceWorker();
renderMenu();

function renderMenu(errorText = ""): void {
    destroyGame();
    renderMenuUi(app, hasPotentialSavedGameState(), errorText, false);
    scheduleBackgroundPreparation();
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
                <div class="volume-control">
                    <span class="volume-icon" id="volumeIcon" aria-hidden="true">${volumeIcon(volume)}</span>
                    <input id="volumeInput" type="range" min="0" max="100" step="1" value="${Math.round(volume * 100)}" aria-label="Volume">
                    <span class="volume-value" id="volumeValue">${Math.round(volume * 100)}</span>
                </div>
                <div class="menu-buttons">
                    <button id="newGameButton" class="start-button" type="button">New Game</button>
                    <button id="continueButton" class="start-button" type="button"${canContinue ? "" : " disabled"}>Continue</button>
                </div>
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
    const newGameButton = menuRoot.querySelector<HTMLButtonElement>("#newGameButton");
    const continueButton = menuRoot.querySelector<HTMLButtonElement>("#continueButton");

    volumeInput?.addEventListener("input", () => {
        volume = Number(volumeInput.value) / 100;
        writeVolume(volume);
        updateVolumeUi(volumeInput, volumeValue);
        applyVolume();
    });
    if (volumeInput) {
        updateVolumeUi(volumeInput, volumeValue);
    }

    newGameButton?.addEventListener("click", () => {
        clearStoredGameState();
        destroyGame();
        void startGame(false);
    });

    continueButton?.addEventListener("click", () => {
        if (hasLiveSuspendedGame()) {
            resumeLiveGameFromMenu();
            return;
        }
        void startGame(true);
    });

    return menuRoot;
}

async function startGame(restoreSavedGame: boolean): Promise<void> {
    const audioUnlockPromise = unlockAudio();
    let runtimePrepared = false;
    destroyGame();
    if (preparedRuntime === null) {
        renderBoot(preparationProgress);
    }
    try {
        const runtime = await ensureRuntimePrepared(preparationError !== null);
        runtimePrepared = true;
        await audioUnlockPromise;
        renderGameHost();
        await mountGame(runtime, restoreSavedGame);
    } catch (error) {
        console.error(error);
        destroyGame();
        if (restoreSavedGame && runtimePrepared) {
            renderMenu("Unable to restore the saved game. Start a new game and try again.");
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

function renderLoadError(error: unknown, restoreSavedGame = false): void {
    void error;
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

async function mountGame(runtime: PreparedRuntime, restoreSavedGame: boolean): Promise<void> {
    const host = document.querySelector<HTMLDivElement>("#gameHost");
    if (!host) {
        throw new Error("Missing game host.");
    }

    const mainGame = new runtime.Main();
    const scalableGame = new runtime.ScalableGame2(mainGame, 800, 600, true);
    const appContainer = new runtime.slick.AppGameContainer(scalableGame);
    appContainer.setPreserveAudioCacheOnDestroy(true);
    appContainer.setLoopSuspended(true);
    appContainer.setHighDpiEnabled(HIGH_DPI_ENABLED);
    appContainer.setMaxDevicePixelRatio(MAX_DEVICE_PIXEL_RATIO);
    mainGame.scalableGame = scalableGame;
    mainGame.appGameContainer = appContainer;
    mainGame.windowedDisplayModeProvider = getResponsiveWindowedDisplayMode;
    mainGame.pauseStateChangeHandler = handleGamePauseStateChanged;
    if (restoreSavedGame) {
        mainGame.loadingCompleteHandler = (gc: GameContainer): boolean => {
            if (!getGameStateStore(runtime).restore(mainGame, gc)) {
                throw new Error("Saved game could not be restored.");
            }
            return true;
        };
    }

    runtime.slick.Display.setParent(host);
    activeGameHost = host;
    const displayMode = getResponsiveWindowedDisplayMode();
    await appContainer.setDisplayMode(displayMode.width, displayMode.height, false);
    appContainer.setAlwaysRender(true);
    appContainer.setVSync(true);
    appContainer.setSmoothDeltas(false);
    appContainer.setShowFPS(false);
    appContainer.setClearEachFrame(true);
    await appContainer.start();
    container = appContainer;
    game = mainGame;
    await ResourceLoader.waitForAll();
    appContainer.setErrorHandler((error) => {
        console.error(error);
        destroyGame();
        renderLoadError(error, restoreSavedGame);
    });
    startResponsiveGameSizing(host);
    startGameCursorAutoHide(host);
    startHamburgerVisibilityMonitor();
    applyVolume();
    focusGameCanvas();
    syncCurrentGameLifecycleState();
}

async function unlockAudio(): Promise<void> {
    await SoundStore.get().unlock();
}

function applyVolume(): void {
    writeVolume(volume);
    const musicVolume = volume;
    const soundVolume = Math.sqrt(volume);
    SoundStore.get().setMusicVolume(musicVolume);
    SoundStore.get().setSoundVolume(soundVolume);
    container?.setMusicVolume(musicVolume);
    container?.setSoundVolume(soundVolume);
}

async function ensureRuntimePrepared(forceRetry = false): Promise<PreparedRuntime> {
    if (preparedRuntime !== null) {
        return preparedRuntime;
    }
    if (preparationPromise !== null) {
        return preparationPromise;
    }
    if (forceRetry) {
        preparationError = null;
        preparationProgress = 0;
        refreshVisibleBootProgress();
    } else if (preparationError !== null) {
        throw preparationError;
    }

    ResourceLoader.clearFailures();
    ResourceLoader.setCacheBust(CACHE_BUST);
    ResourceLoader.setRetryOptions(RESOURCE_CACHE_RETRY_COUNT, RESOURCE_CACHE_RETRY_DELAY_MS);
    preparationPromise = prepareRuntime()
        .then(runtime => {
            preparedRuntime = runtime;
            preparationError = null;
            preparationProgress = 1;
            refreshVisibleBootProgress();
            return runtime;
        })
        .catch(error => {
            preparationError = error;
            throw error;
        })
        .finally(() => {
            preparationPromise = null;
        });
    return preparationPromise;
}

async function prepareRuntime(): Promise<PreparedRuntime> {
    const [
        slick,
        mainModule,
        scalableGameModule,
        gameStateStoreModule
    ] = await Promise.all([
        import("slick2d-ts"),
        import("../mspacman/Main"),
        import("../mspacman/ScalableGame2"),
        import("../mspacman/persistence/MsPacManGameStateStore"),
        preloadPreparedResources(Array.from(new Set(RESOURCE_REFS)))
    ]);

    return {
        slick,
        Main: mainModule.Main,
        ScalableGame2: scalableGameModule.ScalableGame2,
        MsPacManGameStateStore: gameStateStoreModule.MsPacManGameStateStore
    };
}

async function preloadPreparedResources(resourceRefs: readonly string[]): Promise<void> {
    const audioRefs = resourceRefs.filter(isAudioResourceRef);
    const nonAudioRefs = resourceRefs.filter(ref => !isAudioResourceRef(ref));
    const total = audioRefs.length + nonAudioRefs.length;
    let audioLoaded = 0;
    let nonAudioLoaded = 0;
    const updateProgress = () => {
        preparationProgress = total === 0 ? 1 : (audioLoaded + nonAudioLoaded) / total;
        refreshVisibleBootProgress();
    };

    updateProgress();
    await Promise.all([
        ResourceLoader.preloadResources(nonAudioRefs, progress => {
            nonAudioLoaded = progress.loaded;
            updateProgress();
        }),
        SoundStore.get().preloadAudioBuffers(audioRefs, progress => {
            audioLoaded = progress.loaded;
            updateProgress();
        })
    ]);
    preparationProgress = 1;
    refreshVisibleBootProgress();
}

function scheduleBackgroundPreparation(): void {
    if (backgroundPreparationScheduled || preparedRuntime !== null
            || preparationPromise !== null || preparationError !== null) {
        return;
    }
    backgroundPreparationScheduled = true;
    requestAnimationFrame(() => {
        window.setTimeout(() => {
            backgroundPreparationScheduled = false;
            void ensureRuntimePrepared().catch(error => {
                console.warn("MS Pac-Man background preparation failed.", error);
            });
        }, 0);
    });
}

function refreshVisibleBootProgress(): void {
    if (app.querySelector("[data-boot-progress='true']") !== null) {
        renderBoot(preparationProgress);
    }
}

function isAudioResourceRef(ref: string): boolean {
    return ref.toLowerCase().endsWith(".ogg");
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
    const waves = Math.round(value * 100) === 0
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

function destroyGame(): void {
    removeMenuOverlay();
    stopHamburgerVisibilityMonitor();
    stopGameCursorAutoHide();
    stopResponsiveGameSizing();
    game?.stopAllSounds();
    if (container !== null) {
        container.destroy();
        container = null;
    } else {
        SoundStore.get().stopAllPlayback();
    }
    game = null;
    activeGameHost = null;
    preparedRuntime?.slick.Display.setParent(null);
}

function saveCurrentGameState(): boolean {
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
    if (preparedRuntime === null) {
        return null;
    }
    return getGameStateStore(preparedRuntime);
}

function hasPotentialSavedGameState(): boolean {
    try {
        const text = localStorage.getItem(GAME_STATE_STORAGE_KEY);
        if (text === null) {
            return false;
        }
        const snapshot = JSON.parse(text) as { version?: unknown };
        if (snapshot.version !== GAME_STATE_VERSION) {
            clearStoredGameState();
            return false;
        }
        return true;
    } catch {
        clearStoredGameState();
        return false;
    }
}

function clearStoredGameState(): void {
    try {
        localStorage.removeItem(GAME_STATE_STORAGE_KEY);
    } catch {
    }
    gameStateStore?.clear();
}

function hasLiveSuspendedGame(): boolean {
    return liveMenuOpen
        && menuOverlay !== null
        && game !== null
        && container !== null
        && activeGameHost !== null
        && !game.isLoadingScreenActive();
}

function showLiveMenuOverlay(): void {
    if (!game || !container || !activeGameHost || liveMenuOpen) {
        return;
    }

    liveMenuOpen = true;
    game.setBrowserSuspended(true);
    container.stopSoundEffects();
    container.setLoopSuspended(true);
    container.getInput().pause();
    game.input.clearKeyPressedRecord();
    saveCurrentGameState();
    stopHamburgerVisibilityMonitor();
    setHamburgerHidden(true);
    stopGameCursorAutoHide();
    menuOverlay = renderMenuUi(app, true, "", true);
}

function resumeLiveGameFromMenu(): void {
    const currentGame = game;
    const currentContainer = container;
    const host = activeGameHost;
    if (!liveMenuOpen || !menuOverlay || !currentGame || !currentContainer || !host) {
        destroyGame();
        void startGame(true);
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
    syncCurrentGameLifecycleState();
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
    if (game?.isLoadingScreenActive()) {
        return;
    }
    if (game && container && activeGameHost && game.isStateSaveReady()) {
        showLiveMenuOverlay();
        return;
    }
    game?.setBrowserSuspended(true);
    container?.stopSoundEffects();
    saveCurrentGameState();
    renderMenu();
}

function suspendCurrentGame(): void {
    if (!game || game.isLoadingScreenActive()) {
        return;
    }
    game.setBrowserSuspended(true);
    container?.stopSoundEffects();
    container?.setLoopSuspended(true);
    saveCurrentGameState();
}

function resumeCurrentGame(): void {
    syncCurrentGameLifecycleState();
}

function syncCurrentGameLifecycleState(): void {
    if (!game || game.isLoadingScreenActive()) {
        return;
    }
    if (liveMenuOpen || suspendedByVisibilityLoss || suspendedByFocusLoss || document.visibilityState !== "visible" || !document.hasFocus()) {
        suspendCurrentGame();
    } else {
        game.setBrowserSuspended(false);
        container?.setLoopSuspended(false);
    }
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
    const hidden = game === null || game.isLoadingScreenActive();
    setHamburgerHidden(hidden);
    if (!hidden) {
        syncCurrentGameLifecycleState();
    }
    if (hidden && game !== null) {
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
    resizeAnimationFrame = requestAnimationFrame(() => {
        resizeAnimationFrame = 0;
        applyResponsiveWindowedDisplayMode();
    });
}

function applyResponsiveWindowedDisplayMode(): void {
    if (!container || !activeGameHost || container.isFullscreen() || document.fullscreenElement !== null) {
        return;
    }

    const displayMode = getResponsiveWindowedDisplayMode();
    try {
        void Promise.resolve(container.setDisplayMode(displayMode.width, displayMode.height, false))
            .catch(reportResponsiveResizeError);
    } catch (error) {
        reportResponsiveResizeError(error);
    }
}

function reportResponsiveResizeError(error: unknown): void {
    console.error(error);
    renderLoadError(error);
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
    window.addEventListener("pagehide", () => {
        suspendedByVisibilityLoss = true;
        syncCurrentGameLifecycleState();
    });
    window.addEventListener("pageshow", () => {
        suspendedByVisibilityLoss = document.visibilityState !== "visible";
        suspendedByFocusLoss = !document.hasFocus();
        syncCurrentGameLifecycleState();
    });
    window.addEventListener("blur", () => {
        suspendedByFocusLoss = true;
        syncCurrentGameLifecycleState();
    });
    window.addEventListener("focus", () => {
        suspendedByFocusLoss = false;
        resumeCurrentGame();
    });
    document.addEventListener("visibilitychange", () => {
        suspendedByVisibilityLoss = document.visibilityState !== "visible";
        syncCurrentGameLifecycleState();
    });
}

function showStartupError(error: unknown): void {
    if (app.childElementCount === 0) {
        renderMenu(formatError(error));
    }
}

function safeReadVolume(): number {
    try {
        return readVolume();
    } catch {
        return 0.1;
    }
}

function readVolume(): number {
    const value = Number.parseInt(localStorage.getItem("ms-pac-man-volume") ?? "10", 10);
    if (!Number.isFinite(value)) {
        return 0.1;
    }
    return Math.max(0, Math.min(1, value / 100));
}

function writeVolume(value: number): void {
    try {
        localStorage.setItem("ms-pac-man-volume", String(Math.round(value * 100)));
    } catch {
        // Local storage is optional; audio volume still applies in memory.
    }
}

async function registerServiceWorker(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
        return;
    }
    if (import.meta.env.DEV) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
        return;
    }
    try {
        await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js?v=${encodeURIComponent(CACHE_BUST)}`, {
            scope: import.meta.env.BASE_URL
        });
    } catch {
        // The game still runs without PWA registration.
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
