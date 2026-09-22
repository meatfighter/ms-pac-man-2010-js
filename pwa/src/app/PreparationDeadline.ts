import { SoundStore } from "slick2d-ts/slick/openal/SoundStore";

export class ReloadRequiredError extends Error {
    public constructor(cause: unknown) {
        super("Preparation could not be stopped. Reload this tab before continuing.", { cause });
        this.name = "ReloadRequiredError";
    }
}

export function observeUntilAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (operation: () => void): void => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", abort);
            operation();
        };
        const abort = (): void => finish(() => reject(signal.reason));
        void pending.then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error))
        );
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
    });
}

/** Observes real work separately from the bounded UI wait. Never permits overlapping retries. */
export async function prepareWithDeadline<T>(controller: AbortController, operation: () => Promise<T>): Promise<T> {
    const timer = setTimeout(() => controller.abort(new Error("Resource preparation timed out.")), 120000);
    const pending = Promise.resolve().then(operation);
    try {
        return await observeUntilAbort(pending, controller.signal);
    } catch (error) {
        controller.abort(error);
        const settlement = new AbortController();
        const settlementTimer = setTimeout(() => settlement.abort(new ReloadRequiredError(error)), 5000);
        try {
            await observeUntilAbort(
                Promise.allSettled([pending]).then(() => SoundStore.waitForNativeAudioDecodes()),
                settlement.signal
            );
        } finally {
            clearTimeout(settlementTimer);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

/** A timed-out initializer may still hold native resources; recovery requires a new page. */
export async function initializeWithDeadline<T>(operation: Promise<T>, cleanup: { run(...steps: Array<() => void>): boolean }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        const failure = new ReloadRequiredError(new Error("Initialization timed out."));
        cleanup.run(() => {
            throw failure;
        });
        controller.abort(failure);
    }, 120000);
    try {
        return await observeUntilAbort(operation, controller.signal);
    } finally {
        clearTimeout(timer);
    }
}

/** Keep every started import observed until actual settlement, even after a sibling fails. */
export async function settleRequired<const T extends readonly unknown[]>(
    operations: { [K in keyof T]: Promise<T[K]> },
    controller: AbortController
): Promise<T> {
    const guarded = operations.map((operation) =>
        operation.catch((error: unknown) => {
            controller.abort(error);
            throw error;
        })
    );
    await Promise.allSettled(guarded);
    controller.signal.throwIfAborted();
    return Promise.all(operations);
}
