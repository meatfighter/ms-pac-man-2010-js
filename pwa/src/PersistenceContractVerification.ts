/** Browser-only test helper. The supplied Main and store are the actual shipped
 * classes with real resources; no serializer or validator is replaced. */
export function verifyAuthoritativeSave<T>(key: string, main: T, save: (main: T) => { readonly saved: boolean }): void {
    const storage = localStorage;
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    if (!save(main).saved) throw new Error("Real fixture cannot produce a valid snapshot.");
    const valid = get.call(storage, key);
    if (valid === null) throw new Error("Real save did not use the stable slot.");
    const version = (JSON.parse(valid) as { version: number }).version;
    const values = ["{", "[]", "null", "{}", JSON.stringify({ version: version - 1 }), JSON.stringify({ version: version + 1 }), "x".repeat(2_000_001)];
    try {
        for (const raw of values) {
            set.call(storage, key, raw);
            let reads = 0;
            let writes = 0;
            let removals = 0;
            Storage.prototype.getItem = function (this: Storage, candidate: string): string | null {
                if (this === storage && candidate === key) {
                    reads++;
                    throw new Error("Read forbidden while saving.");
                }
                return get.call(this, candidate);
            };
            Storage.prototype.setItem = function (this: Storage, candidate: string, text: string): void {
                if (this === storage && candidate === key) writes++;
                set.call(this, candidate, text);
            };
            Storage.prototype.removeItem = function (this: Storage, candidate: string): void {
                if (this === storage && candidate === key) removals++;
                remove.call(this, candidate);
            };
            if (!save(main).saved || reads !== 0 || writes !== 1 || removals !== 0)
                throw new Error("Real serializer/store failed the no-read overwrite contract.");
            const current = get.call(storage, key);
            if (current === null || (JSON.parse(current) as { version: number }).version !== version)
                throw new Error("Current payload did not replace old data.");
        }
    } finally {
        Storage.prototype.getItem = get;
        Storage.prototype.setItem = set;
        Storage.prototype.removeItem = remove;
        set.call(storage, key, valid);
    }
}
