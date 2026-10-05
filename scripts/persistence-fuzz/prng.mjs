/** Test randomness is deliberately separate from each game's JavaRandom. */
export const GENERATOR_VERSION = 3;
export function seed32(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) throw new RangeError("Seed must be a uint32 (decimal or 0x hexadecimal).");
    return number >>> 0;
}
export function mix(seed, stream) {
    let x = (seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return (x ^ (x >>> 15)) >>> 0;
}
export function random(seed) {
    let state = seed32(seed);
    return {
        next() {
            state = (state + 0x6d2b79f5) >>> 0;
            let x = Math.imul(state ^ (state >>> 15), state | 1);
            x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        },
        int(maximum) {
            if (!Number.isSafeInteger(maximum) || maximum < 1) throw new RangeError("Positive integer sample size required.");
            return Math.floor(this.next() * maximum);
        }
    };
}
export function framesFor(inputSeed, scheduleSeed, count, game) {
    const input = random(inputSeed),
        timing = random(scheduleSeed);
    const result = [];
    // Neutral, sustained movement, diagonals, opposing directions and action chords.
    const movement = [0, 1, 2, 4, 8, 5, 9, 6, 10, 3, 12, 15];
    let mask = 0,
        remaining = 0;
    for (let i = 0; i < count; i++) {
        if (remaining-- <= 0) {
            mask = movement[input.int(movement.length)];
            if (game !== "ms-pac-man-2010-js") {
                if (input.next() < 0.55) mask |= 16;
                if (input.next() < 0.25) mask |= 32;
            }
            // Both P and NES Start/Enter can toggle Pause. Explicit paired fixtures own them.
            remaining = 1 + input.int(64);
        }
        const deltaMs = [5, 10, 10, 11, 16, 20, 30][timing.int(7)];
        const renderCount = [0, 1, 1, 1, 2][timing.int(5)];
        result.push({ mask, deltaMs, renderCount });
    }
    return result;
}
