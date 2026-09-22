import { runSettledBatch } from "slick2d-ts/slick/util/BatchLoader";
import { prepareWithDeadline, ReloadRequiredError, settleRequired } from "./PreparationDeadline.js";
import * as SlickRuntimeModule from "slick2d-ts";
import { RESOURCE_REFS } from "./resourceManifest.js";
import { getResourceVersion } from "./ResourceVersions.js";
import { waitForServiceWorkerStartupGrace } from "./ServiceWorkerRegistrar.js";

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
const { ResourceLoader, SoundStore } = SlickRuntimeModule;

export class RuntimeLoader {
    public prepared: PreparedRuntime | null = null;
    public error: unknown = null;
    public progress = 0;
    private pending: Promise<PreparedRuntime> | null = null;
    private controller: AbortController | null = null;
    private reloadFailure: ReloadRequiredError | null = null;
    public constructor(private readonly progressChanged: () => void) {}
    public abort(): void {
        this.controller?.abort(new DOMException("Preparation cancelled", "AbortError"));
    }

    public async prepare(forceRetry = false): Promise<PreparedRuntime> {
        if (this.reloadFailure !== null) throw this.reloadFailure;
        if (this.prepared !== null) return this.prepared;
        const prior = this.pending;
        if (prior !== null) {
            const alreadyCancelled = this.controller?.signal.aborted === true;
            if (!forceRetry && !alreadyCancelled) return prior;
            this.controller?.abort(new DOMException("Preparation superseded", "AbortError"));
            await prior.catch(() => undefined);
            return this.prepare(this.pending === null);
        }
        if (!forceRetry && this.error !== null) throw this.error;
        const controller = new AbortController();
        this.controller = controller;
        this.error = null;
        const work = prepareWithDeadline(controller, async () => {
            await waitForServiceWorkerStartupGrace();
            controller.signal.throwIfAborted();
            ResourceLoader.clearFailures();
            ResourceLoader.setCacheBust(null);
            ResourceLoader.setCacheVersionResolver(getResourceVersion);
            ResourceLoader.setRetryOptions(RESOURCE_CACHE_RETRY_COUNT, RESOURCE_CACHE_RETRY_DELAY_MS);
            this.setProgress(0, controller.signal);
            const [mainModule, scalableModule, storeModule] = await settleRequired(
                [import("../mspacman/Main.js"), import("../mspacman/ScalableGame2.js"), import("../mspacman/persistence/MsPacManGameStateStore.js")],
                controller
            );
            controller.signal.throwIfAborted();
            await this.preloadResources(RESOURCE_REFS, controller);
            controller.signal.throwIfAborted();
            return {
                slick: SlickRuntimeModule,
                Main: mainModule.Main,
                ScalableGame2: scalableModule.ScalableGame2,
                MsPacManGameStateStore: storeModule.MsPacManGameStateStore
            };
        });
        const pending = work
            .then((runtime) => {
                controller.signal.throwIfAborted();
                if (this.controller !== controller) throw new DOMException("Preparation superseded", "AbortError");
                this.prepared = runtime;
                Reflect.set(window, "__gameResourcesPrepared", true);
                this.setProgress(1, controller.signal);
                return runtime;
            })
            .catch((error: unknown) => {
                if (error instanceof ReloadRequiredError) this.reloadFailure = error;
                if (this.controller === controller) this.error = error;
                throw error;
            })
            .finally(() => {
                if (this.pending === pending) this.pending = null;
                if (this.controller === controller) this.controller = null;
            });
        this.pending = pending;
        return pending;
    }

    private async preloadResources(refs: readonly string[], controller: AbortController): Promise<void> {
        const signal = controller.signal;
        const unique = Array.from(new Set(refs));
        const audio = unique.filter((ref) => ref.toLowerCase().endsWith(".ogg"));
        const resources = unique.filter((ref) => !ref.toLowerCase().endsWith(".ogg"));
        let loaded = 0;
        let failed = false;
        let firstFailure: unknown;
        const runRequired = async (ref: string): Promise<void> => {
            signal.throwIfAborted();
            try {
                if (ref.toLowerCase().endsWith(".ogg")) await SoundStore.get().preloadAudioBuffer(ref, { signal });
                else await ResourceLoader.loadResource(ref, { signal });
                this.setProgress(++loaded / unique.length, signal);
            } catch (error) {
                if (!failed) {
                    failed = true;
                    firstFailure = error;
                    controller.abort(error);
                }
                throw error;
            }
        };
        await Promise.all([
            runSettledBatch(resources, RESOURCE_PRELOAD_CONCURRENCY, runRequired),
            runSettledBatch(audio, AUDIO_PRELOAD_CONCURRENCY, runRequired)
        ]);
        if (failed) throw firstFailure;
        signal.throwIfAborted();
    }

    private setProgress(value: number, signal: AbortSignal): void {
        if (signal.aborted || this.controller?.signal !== signal) return;
        this.progress = value;
        this.progressChanged();
    }
}
