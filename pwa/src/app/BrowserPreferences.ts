import { createBrowserStorageKeys } from "./BrowserStorageKeys.js";

export type ScalingPreference = "smooth" | "crisp" | "pixel-perfect";

export const DEFAULT_VOLUME = 0.1;
export const DEFAULT_SCALING_PREFERENCE: ScalingPreference = "crisp";
export const DEFAULT_FULLSCREEN_PREFERENCE = true;

export class BrowserPreferences {
    public volume = this.readVolume();
    public scaling = this.readScaling();
    public fullscreen = this.readFullscreen();

    public setVolume(value: number, persist = true): boolean {
        this.volume = BrowserPreferences.clampVolume(value);
        return !persist || this.write(createBrowserStorageKeys().volume, String(Math.round(this.volume * 100)), "volume");
    }

    public setScaling(value: ScalingPreference): boolean {
        this.scaling = value;
        return this.write(createBrowserStorageKeys().scaling, value, "scaling preference");
    }

    public setFullscreen(value: boolean): boolean {
        this.fullscreen = value;
        return this.write(createBrowserStorageKeys().fullscreen, String(value), "fullscreen preference");
    }

    public clearGameState(): boolean {
        return this.remove(createBrowserStorageKeys().gameState, "saved game");
    }

    public reset(): boolean {
        const keys = createBrowserStorageKeys();
        let success = true;
        for (const [key, label] of [
            [keys.gameState, "saved game"],
            [keys.volume, "volume"],
            [keys.scaling, "scaling preference"],
            [keys.fullscreen, "fullscreen preference"]
        ] as const) {
            success = this.remove(key, label) && success;
        }
        this.volume = DEFAULT_VOLUME;
        this.scaling = DEFAULT_SCALING_PREFERENCE;
        this.fullscreen = DEFAULT_FULLSCREEN_PREFERENCE;
        return success;
    }

    public static isScaling(value: unknown): value is ScalingPreference {
        return value === "smooth" || value === "crisp" || value === "pixel-perfect";
    }

    public static clampVolume(value: number): number {
        return Math.max(0, Math.min(1, value));
    }

    private readVolume(): number {
        try {
            const key = createBrowserStorageKeys().volume;
            const value = Number.parseInt(localStorage.getItem(key) ?? String(Math.round(DEFAULT_VOLUME * 100)), 10);
            return Number.isFinite(value) ? BrowserPreferences.clampVolume(value / 100) : DEFAULT_VOLUME;
        } catch {
            return DEFAULT_VOLUME;
        }
    }

    private readScaling(): ScalingPreference {
        try {
            const value = localStorage.getItem(createBrowserStorageKeys().scaling);
            return BrowserPreferences.isScaling(value) ? value : DEFAULT_SCALING_PREFERENCE;
        } catch {
            return DEFAULT_SCALING_PREFERENCE;
        }
    }

    private readFullscreen(): boolean {
        try {
            const value = localStorage.getItem(createBrowserStorageKeys().fullscreen);
            if (value === "true") {
                return true;
            }
            if (value === "false") {
                return false;
            }
        } catch {
            return DEFAULT_FULLSCREEN_PREFERENCE;
        }
        return DEFAULT_FULLSCREEN_PREFERENCE;
    }

    private write(key: string, value: string, label: string): boolean {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (error) {
            console.warn(`Unable to save Ms. Pac-Man ${label}.`, error);
            return false;
        }
    }

    private remove(key: string, label: string): boolean {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.warn(`Unable to clear Ms. Pac-Man ${label}.`, error);
            return false;
        }
    }
}
