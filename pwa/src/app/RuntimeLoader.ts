import { ResourceLoader, SoundStore } from "slick2d-ts";
import { RESOURCE_REFS } from "./resourceManifest.js";
import { getResourceVersion } from "./ResourceVersions.js";
import { waitForServiceWorkerReadiness } from "./ServiceWorkerRegistrar.js";

export type SlickRuntime = typeof import("slick2d-ts");
export type MainConstructor = typeof import("../mspacman/Main.js").Main;
export type ScalableGame2Constructor = typeof import("../mspacman/ScalableGame2.js").ScalableGame2;
export type MsPacManGameStateStoreConstructor = typeof import("../mspacman/persistence/MsPacManGameStateStore.js").MsPacManGameStateStore;

export type PreparedRuntime = Readonly<{
    slick: SlickRuntime;
    Main: MainConstructor;
    ScalableGame2: ScalableGame2Constructor;
    MsPacManGameStateStore: MsPacManGameStateStoreConstructor;
}>;

const RESOURCE_CACHE_RETRY_COUNT = 3;
const RESOURCE_CACHE_RETRY_DELAY_MS = 300;
const RESOURCE_PRELOAD_CONCURRENCY = 6;
const AUDIO_PRELOAD_CONCURRENCY = 4;

export class RuntimeLoader {
    public prepared: PreparedRuntime | null = null;
    public error: unknown = null;
    public progress = 0;

    private preparationPromise: Promise<PreparedRuntime> | null = null;
    private abortController: AbortController | null = null;
    private backgroundScheduled = false;

    public constructor(private readonly progressChanged: () => void) {}

    public async prepare(forceRetry = false): Promise<PreparedRuntime> {
        if (this.prepared !== null) {
            return this.prepared;
        }
        if (forceRetry && this.preparationPromise !== null) {
            this.abortController?.abort(new Error("Ms. Pac-Man runtime preparation superseded by retry."));
            try {
                await this.preparationPromise;
            } catch {
                // The replacement preparation below owns the user-visible result.
            }
        }
        if (this.preparationPromise !== null) {
            return this.preparationPromise;
        }
        if (forceRetry) {
            this.error = null;
            this.progress = 0;
            this.progressChanged();
        } else if (this.error !== null) {
            throw this.error;
        }

        // On a first visit, let the bounded service-worker install settle before
        // runtime preload starts fetching the same release resources itself.
        await waitForServiceWorkerReadiness();
        if (this.prepared !== null) {
            return this.prepared;
        }
        if (this.preparationPromise !== null) {
            return this.preparationPromise;
        }

        this.abortController?.abort();
        const abortController = new AbortController();
        this.abortController = abortController;
        ResourceLoader.clearFailures();
        ResourceLoader.setCacheBust(null);
        ResourceLoader.setCacheVersionResolver(getResourceVersion);
        ResourceLoader.setRetryOptions(RESOURCE_CACHE_RETRY_COUNT, RESOURCE_CACHE_RETRY_DELAY_MS);
        this.preparationPromise = this.prepareRuntime(abortController)
            .then((runtime) => {
                this.prepared = runtime;
                Reflect.set(window, "__gameResourcesPrepared", true);
                this.error = null;
                this.progress = 1;
                this.progressChanged();
                return runtime;
            })
            .catch((error) => {
                this.error = error;
                throw error;
            })
            .finally(() => {
                this.preparationPromise = null;
                if (this.abortController === abortController) {
                    this.abortController = null;
                }
            });
        return this.preparationPromise;
    }

    public scheduleBackgroundPreparation(): void {
        if (this.backgroundScheduled || this.prepared !== null || this.preparationPromise !== null || this.error !== null) {
            return;
        }
        this.backgroundScheduled = true;
        requestAnimationFrame(() => {
            window.setTimeout(() => {
                this.backgroundScheduled = false;
                void this.prepare().catch((error) => {
                    console.warn("Ms. Pac-Man background preparation failed.", error);
                });
            }, 0);
        });
    }

    public abort(): void {
        this.abortController?.abort();
    }

    private async prepareRuntime(controller: AbortController): Promise<PreparedRuntime> {
        const signal = controller.signal;
        const preloadPromise = this.preloadPreparedResources(Array.from(new Set(RESOURCE_REFS)), signal);
        const operations = [
            import("slick2d-ts"),
            import("../mspacman/Main.js"),
            import("../mspacman/ScalableGame2.js"),
            import("../mspacman/persistence/MsPacManGameStateStore.js"),
            preloadPromise
        ] as const;
        const guarded = operations.map((operation) =>
            operation.catch((error: unknown) => {
                controller.abort(error);
                throw error;
            })
        );
        const results = await Promise.allSettled(guarded);
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        const [slick, mainModule, scalableGameModule, gameStateStoreModule] = await Promise.all(operations);

        return {
            slick,
            Main: mainModule.Main,
            ScalableGame2: scalableGameModule.ScalableGame2,
            MsPacManGameStateStore: gameStateStoreModule.MsPacManGameStateStore
        };
    }

    private async preloadPreparedResources(resourceRefs: readonly string[], signal: AbortSignal): Promise<void> {
        const audioRefs = resourceRefs.filter(isAudioResourceRef);
        const nonAudioRefs = resourceRefs.filter((ref) => !isAudioResourceRef(ref));
        const total = audioRefs.length + nonAudioRefs.length;
        let audioLoaded = 0;
        let nonAudioLoaded = 0;
        const updateProgress = () => {
            this.progress = total === 0 ? 1 : (audioLoaded + nonAudioLoaded) / total;
            this.progressChanged();
        };

        updateProgress();
        const results = await Promise.allSettled([
            ResourceLoader.preloadResources(nonAudioRefs, {
                concurrency: RESOURCE_PRELOAD_CONCURRENCY,
                signal,
                onProgress: (progress) => {
                    nonAudioLoaded = progress.loaded;
                    updateProgress();
                }
            }),
            SoundStore.get().preloadAudioBuffers(audioRefs, {
                concurrency: AUDIO_PRELOAD_CONCURRENCY,
                signal,
                onProgress: (progress) => {
                    audioLoaded = progress.loaded;
                    updateProgress();
                }
            })
        ]);
        const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failure !== undefined) {
            throw failure.reason;
        }
        if (signal.aborted) {
            throw signal.reason ?? new Error("Ms. Pac-Man runtime preparation was aborted.");
        }
        this.progress = 1;
        this.progressChanged();
    }
}

function isAudioResourceRef(ref: string): boolean {
    return ref.toLowerCase().endsWith(".ogg");
}
