/* global window */
// __PERSISTENCE_FUZZ_ONLY__: deterministic native-output substitute. Decoding
// still uses the browser's real OfflineAudioContext and the real game resources.
// This file is injected by the test coordinator, never imported by a game.
(() => {
    const Offline = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
    const contexts = new Set();
    let timeMs = 1_000_000;
    const param = (value = 1) => ({
        value,
        setValueAtTime(value) {
            this.value = value;
        },
        linearRampToValueAtTime(value) {
            this.value = value;
        },
        cancelScheduledValues() {}
    });
    class Node {
        connect(target) {
            return target;
        }
        disconnect() {}
    }
    class Source extends Node {
        constructor(context) {
            super();
            this.context = context;
            this.buffer = null;
            this.loop = false;
            this.playbackRate = param();
            this.onended = null;
            this.active = false;
        }

        start(when = 0, offset = 0) {
            if (!this.buffer) throw new Error("Controlled source has no decoded AudioBuffer.");
            this.ends =
                this.context.currentTime + Math.max(0, when - this.context.currentTime) + Math.max(0, this.buffer.duration - offset) / this.playbackRate.value;
            this.active = true;
            this.context.sources.add(this);
        }

        stop() {
            this.active = false;
            this.context.sources.delete(this);
        }
        poll() {
            if (this.active && !this.loop && this.context.currentTime >= this.ends) {
                this.stop();
                this.onended?.();
            }
        }
    }
    class Context {
        constructor() {
            this.origin = timeMs;
            this.state = "suspended";
            this.destination = new Node();
            this.sampleRate = 44100;
            this.sources = new Set();
            this.listeners = new Set();
            contexts.add(this);
        }

        get currentTime() {
            return (timeMs - this.origin) / 1000;
        }
        createGain() {
            return Object.assign(new Node(), { gain: param() });
        }
        createBufferSource() {
            return new Source(this);
        }
        createPanner() {
            return Object.assign(new Node(), { positionX: param(0), positionY: param(0), positionZ: param(0), setPosition() {} });
        }
        resume() {
            this.state = "running";
            return Promise.resolve();
        }
        suspend() {
            this.state = "suspended";
            return Promise.resolve();
        }
        close() {
            this.state = "closed";
            this.sources.clear();
            contexts.delete(this);
            return Promise.resolve();
        }
        addEventListener(_name, fn) {
            this.listeners.add(fn);
        }
        removeEventListener(_name, fn) {
            this.listeners.delete(fn);
        }
        decodeAudioData(bytes, success, failure) {
            if (!Offline) return Promise.reject(new Error("Browser audio decoding is unavailable."));
            return new Offline(2, 1, 44100).decodeAudioData(bytes).then(
                (value) => {
                    success?.(value);
                    return value;
                },
                (error) => {
                    failure?.(error);
                    throw error;
                }
            );
        }
    }
    window.AudioContext = Context;
    window.webkitAudioContext = Context;
    window.__persistenceFuzzAudio = {
        advance(deltaMs) {
            timeMs += deltaMs;
            for (const context of contexts) if (context.state === "running") for (const source of [...context.sources]) source.poll();
        },
        now() {
            return timeMs;
        }
    };
})();
