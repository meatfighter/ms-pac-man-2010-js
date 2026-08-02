import "./styles.css";
import { AppGameContainer, Display, ResourceLoader, SoundStore } from "slick2d-ts";
import { Main } from "../mspacman/Main";
import { ScalableGame2 } from "../mspacman/ScalableGame2";
import { RESOURCE_REFS } from "./resourceManifest";
import { APP_VERSION, CACHE_BUST } from "./version";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
    throw new Error("Missing #app root.");
}

let container: AppGameContainer | null = null;
let game: Main | null = null;
let volume = readVolume();

ResourceLoader.setCacheBust(CACHE_BUST);
ResourceLoader.setRetryOptions(3, 300);

void registerServiceWorker();
renderMenu();

function renderMenu(errorText = ""): void {
    destroyGame();
    app.innerHTML = `
        <main class="shell">
            <section class="menu" aria-label="MS PAC-MAN 2010 menu">
                <h1 class="title">MS PAC-MAN<br>2010</h1>
                <p class="subtitle">Desktop browser PWA port</p>
                <div class="menu-actions">
                    <label class="volume-control">
                        <span>Volume <strong id="volumeValue">${Math.round(volume * 100)}%</strong></span>
                        <input id="volumeInput" type="range" min="0" max="100" step="1" value="${Math.round(volume * 100)}">
                    </label>
                    <button id="startButton" class="start-button" type="button">Start</button>
                    ${errorText ? `<p class="error-text">${escapeHtml(errorText)}</p>` : ""}
                </div>
            </section>
        </main>
    `;

    const volumeInput = document.querySelector<HTMLInputElement>("#volumeInput");
    const volumeValue = document.querySelector<HTMLElement>("#volumeValue");
    const startButton = document.querySelector<HTMLButtonElement>("#startButton");

    volumeInput?.addEventListener("input", () => {
        volume = Number(volumeInput.value) / 100;
        writeVolume(volume);
        if (volumeValue) {
            volumeValue.textContent = `${Math.round(volume * 100)}%`;
        }
        applyVolume();
    });

    startButton?.addEventListener("click", () => {
        void startGame();
    });
}

async function startGame(): Promise<void> {
    try {
        await unlockAudio();
        renderBoot("Loading", 0);
        await preloadResources((loaded, total, ref) => {
            renderBoot(`Loading ${ref}`, loaded / total);
        });
        renderGameHost();
        await mountGame();
    } catch (error) {
        renderLoadError(error);
    }
}

function renderBoot(label: string, progress: number): void {
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    app.innerHTML = `
        <main class="shell">
            <section class="boot" aria-live="polite">
                <div class="boot-title"><span class="dots">${escapeHtml(label)}</span></div>
                <div class="progress-shell" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
                    <div class="progress-bar" style="--progress: ${percent}%"></div>
                </div>
            </section>
        </main>
    `;
}

function renderLoadError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    app.innerHTML = `
        <main class="shell">
            <section class="boot">
                <div class="boot-title">Loading failed</div>
                <p class="error-text">${escapeHtml(message)}</p>
                <button id="retryButton" class="retry-button" type="button">Retry</button>
            </section>
        </main>
    `;
    document.querySelector<HTMLButtonElement>("#retryButton")?.addEventListener("click", () => {
        void startGame();
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
        renderMenu();
    });
}

async function mountGame(): Promise<void> {
    const host = document.querySelector<HTMLDivElement>("#gameHost");
    if (!host) {
        throw new Error("Missing game host.");
    }

    game = new Main();
    const scalableGame = new ScalableGame2(game, 800, 600, true);
    container = new AppGameContainer(scalableGame);
    game.scalableGame = scalableGame;
    game.appGameContainer = container;

    Display.setParent(host);
    container.setErrorHandler((error) => {
        renderLoadError(error);
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
    const context = SoundStore.get().getAudioContext();
    if (context && context.state !== "running") {
        await context.resume();
    }
}

function applyVolume(): void {
    writeVolume(volume);
    SoundStore.get().setMusicVolume(volume);
    SoundStore.get().setSoundVolume(volume);
    container?.setMusicVolume(volume);
    container?.setSoundVolume(volume);
}

function destroyGame(): void {
    game?.stopAllSounds();
    container?.destroy();
    container = null;
    game = null;
    Display.setParent(null);
}

function readVolume(): number {
    const value = Number.parseInt(localStorage.getItem("ms-pac-man-volume") ?? "80", 10);
    if (!Number.isFinite(value)) {
        return 0.8;
    }
    return Math.max(0, Math.min(1, value / 100));
}

function writeVolume(value: number): void {
    localStorage.setItem("ms-pac-man-volume", String(Math.round(value * 100)));
}

async function registerServiceWorker(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
        return;
    }
    try {
        await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}`);
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
