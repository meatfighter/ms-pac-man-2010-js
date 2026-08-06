import "./styles.css";
import type { GameContainer } from "slick2d-ts";
import { RESOURCE_REFS } from "./resourceManifest";
import { APP_VERSION, CACHE_BUST } from "./version";
import type { Main as MsPacManMain } from "../mspacman/Main";
import { MsPacManGameStateStore } from "../mspacman/persistence/MsPacManGameStateStore";

type SlickRuntime = typeof import("slick2d-ts");

type RuntimeContainer = {
    destroy(): void;
    setAlwaysRender(alwaysRender: boolean): void;
    setClearEachFrame(clearEachFrame: boolean): void;
    setDisplayMode(width: number, height: number, fullscreen: boolean): Promise<void> | void;
    setErrorHandler(errorHandler: (error: unknown) => void): void;
    setMusicVolume(volume: number): void;
    setShowFPS(showFPS: boolean): void;
    setSmoothDeltas(smoothDeltas: boolean): void;
    setSoundVolume(volume: number): void;
    setVSync(vsync: boolean): void;
    start(): Promise<void>;
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
    throw new Error("Missing #app root.");
}

let slickRuntime: SlickRuntime | null = null;
let container: RuntimeContainer | null = null;
let game: MsPacManMain | null = null;
let volume = safeReadVolume();
const gameStateStore = new MsPacManGameStateStore(APP_VERSION);

setupGlobalErrorHandlers();
setupPageLifecycleHandlers();
void registerServiceWorker();
renderMenu();

function renderMenu(errorText = ""): void {
    destroyGame();
    const canContinue = gameStateStore.hasValidSave();
    app.innerHTML = `
        <main class="shell">
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
        </main>
    `;

    const volumeInput = document.querySelector<HTMLInputElement>("#volumeInput");
    const volumeValue = document.querySelector<HTMLElement>("#volumeValue");
    const newGameButton = document.querySelector<HTMLButtonElement>("#newGameButton");
    const continueButton = document.querySelector<HTMLButtonElement>("#continueButton");

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
        gameStateStore.clear();
        void startGame(false);
    });

    continueButton?.addEventListener("click", () => {
        void startGame(true);
    });
}

async function startGame(restoreSavedGame: boolean): Promise<void> {
    try {
        await configureSlickRuntime();
        await unlockAudio();
        renderBoot(0);
        await preloadResources((loaded, total, ref) => {
            renderBoot(loaded / total);
        });
        renderGameHost();
        await mountGame(restoreSavedGame);
    } catch (error) {
        console.error(error);
        renderLoadError(error, restoreSavedGame);
    }
}

function renderBoot(progress: number): void {
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    app.innerHTML = `
        <main class="shell">
            <section class="boot" aria-live="polite">
                <div class="progress-shell" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
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
                <div class="failure-icon" aria-hidden="true">💀</div>
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
        <button class="hamburger" id="menuButton" type="button" aria-label="Return to menu" title="Return to menu">
            <span></span>
        </button>
    `;
    document.querySelector<HTMLButtonElement>("#menuButton")?.addEventListener("click", () => {
        saveCurrentGameState();
        renderMenu();
    });
}

async function mountGame(restoreSavedGame: boolean): Promise<void> {
    const host = document.querySelector<HTMLDivElement>("#gameHost");
    if (!host) {
        throw new Error("Missing game host.");
    }

    const [{ AppGameContainer, Display }, { Main }, { ScalableGame2 }] = await Promise.all([
        getSlickRuntime(),
        import("../mspacman/Main"),
        import("../mspacman/ScalableGame2")
    ]);

    const mainGame = new Main();
    const scalableGame = new ScalableGame2(mainGame, 800, 600, true);
    const appContainer = new AppGameContainer(scalableGame);
    container = appContainer;
    mainGame.scalableGame = scalableGame;
    mainGame.appGameContainer = appContainer;
    game = mainGame;
    if (restoreSavedGame) {
        mainGame.loadingCompleteHandler = (gc: GameContainer): boolean => {
            if (!gameStateStore.restore(mainGame, gc)) {
                throw new Error("Saved game could not be restored.");
            }
            return true;
        };
    }

    Display.setParent(host);
    container.setErrorHandler((error) => {
        renderLoadError(error, restoreSavedGame);
    });
    await container.setDisplayMode(800, 600, false);
    container.setAlwaysRender(true);
    container.setVSync(true);
    container.setSmoothDeltas(false);
    container.setShowFPS(false);
    container.setClearEachFrame(true);
    await container.start();
    applyVolume();
}

async function preloadResources(onProgress: (loaded: number, total: number, ref: string) => void): Promise<void> {
    const { ResourceLoader } = await getSlickRuntime();
    ResourceLoader.clearCache();
    ResourceLoader.setCacheBust(CACHE_BUST);
    ResourceLoader.setRetryOptions(3, 300);
    for (let i = 0; i < RESOURCE_REFS.length; i++) {
        const ref = RESOURCE_REFS[i];
        await ResourceLoader.loadResource(ref);
        onProgress(i + 1, RESOURCE_REFS.length, ref);
    }
}

async function unlockAudio(): Promise<void> {
    const { SoundStore } = await getSlickRuntime();
    const context = SoundStore.get().getAudioContext();
    if (context && context.state !== "running") {
        await context.resume();
    }
}

function applyVolume(): void {
    writeVolume(volume);
    const musicVolume = volume;
    const soundVolume = Math.sqrt(volume);
    if (slickRuntime) {
        slickRuntime.SoundStore.get().setMusicVolume(musicVolume);
        slickRuntime.SoundStore.get().setSoundVolume(soundVolume);
    }
    container?.setMusicVolume(musicVolume);
    container?.setSoundVolume(soundVolume);
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
    game?.stopAllSounds();
    container?.destroy();
    container = null;
    game = null;
    slickRuntime?.Display.setParent(null);
}

function saveCurrentGameState(): boolean {
    if (!game || !game.isStateSaveReady()) {
        return false;
    }
    return gameStateStore.save(game);
}

function suspendCurrentGame(): void {
    saveCurrentGameState();
    game?.setBrowserSuspended(true);
}

function resumeCurrentGame(): void {
    if (document.visibilityState === "visible" && document.hasFocus()) {
        game?.setBrowserSuspended(false);
    }
}

async function configureSlickRuntime(): Promise<void> {
    const { ResourceLoader } = await getSlickRuntime();
    ResourceLoader.setCacheBust(CACHE_BUST);
    ResourceLoader.setRetryOptions(3, 300);
}

async function getSlickRuntime(): Promise<SlickRuntime> {
    if (!slickRuntime) {
        slickRuntime = await import("slick2d-ts");
    }
    return slickRuntime;
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
        suspendCurrentGame();
    });
    window.addEventListener("blur", () => {
        suspendCurrentGame();
    });
    window.addEventListener("focus", () => {
        resumeCurrentGame();
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            resumeCurrentGame();
        } else {
            suspendCurrentGame();
        }
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
