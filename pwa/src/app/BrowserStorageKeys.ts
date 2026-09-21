const STORAGE_PREFIX = "ms-pac-man-2010";
const DEFAULT_LOCATION_HREF = "https://localhost/";

export interface BrowserStorageKeys {
    readonly deploymentId: string;
    readonly gameState: string;
    readonly scaling: string;
    readonly fullscreen: string;
    readonly volume: string;
}

export function createBrowserStorageKeys(locationHref = getCurrentLocationHref()): BrowserStorageKeys {
    const deploymentId = createDeploymentStorageId(locationHref);
    return {
        deploymentId,
        gameState: createStorageKey(deploymentId, "game-state-v9"),
        scaling: createStorageKey(deploymentId, "scaling"),
        fullscreen: createStorageKey(deploymentId, "fullscreen"),
        volume: createStorageKey(deploymentId, "volume")
    };
}

export function createDeploymentStorageId(locationHref = getCurrentLocationHref()): string {
    return encodeURIComponent(new URL(".", locationHref).pathname);
}

function createStorageKey(deploymentId: string, slot: string): string {
    return `${STORAGE_PREFIX}:${deploymentId}:${slot}`;
}

function getCurrentLocationHref(): string {
    return typeof location === "undefined" ? DEFAULT_LOCATION_HREF : location.href;
}
