import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const EXPECTED_ENGINE_SHA = "b82492294a20640fab7e0065e9348253bd56c4a9";
const EXPECTED_ENGINE_URL = `https://codeload.github.com/meatfighter/slick2d-ts/tar.gz/${EXPECTED_ENGINE_SHA}`;
const EXPECTED_ENGINE_VERSION = "1.6.2";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const installedRoot = resolve("node_modules", "slick2d-ts");

test("qualified Slick archive, lock metadata and emitted install all agree", async () => {
    const dependency = packageJson.dependencies?.["slick2d-ts"];
    const rootLockedDependency = packageLock.packages?.[""]?.dependencies?.["slick2d-ts"];
    const locked = packageLock.packages?.["node_modules/slick2d-ts"];

    assert.equal(dependency, EXPECTED_ENGINE_URL);
    assert.equal(rootLockedDependency, EXPECTED_ENGINE_URL);
    assert.ok(locked, "package-lock.json is missing node_modules/slick2d-ts");
    assert.equal(locked.resolved, EXPECTED_ENGINE_URL);
    assert.equal(locked.version, EXPECTED_ENGINE_VERSION);
    assert.match(locked.integrity ?? "", /^sha512-[A-Za-z0-9+/=]+$/, "npm must record a real tarball integrity hash");

    const installedPackagePath = resolve(installedRoot, "package.json");
    assert.equal(existsSync(installedPackagePath), true, "slick2d-ts is not installed");
    const installedPackage = JSON.parse(readFileSync(installedPackagePath, "utf8"));
    assert.equal(installedPackage.version, EXPECTED_ENGINE_VERSION);
    assert.equal(installedPackage.main, "./dist/index.js");
    assert.equal(installedPackage.types, "./dist/index.d.ts");
    assert.ok(installedPackage.exports?.["./slick/*"]);

    for (const path of [
        "dist/index.js",
        "dist/index.d.ts",
        "dist/slick/openal/PlaybackSession.js",
        "dist/slick/openal/PlaybackSession.d.ts",
        "dist/slick/MusicPlaybackState.js",
        "dist/slick/MusicPlaybackState.d.ts",
        "dist/slick/util/BrowserFullscreen.js",
        "dist/slick/util/BrowserFullscreen.d.ts"
    ]) {
        assert.equal(existsSync(resolve(installedRoot, path)), true, `installed Slick package is missing ${path}`);
    }

    for (const path of [
        "dist/slick/openal/AudioContextLifecycle.js",
        "dist/slick/openal/AudioContextLifecycle.d.ts",
        "dist/slick/openal/BrowserAudioLifecycle.js",
        "dist/slick/openal/BrowserAudioLifecycle.d.ts"
    ]) {
        assert.equal(existsSync(resolve(installedRoot, path)), false, `retired Slick lifecycle output survived in ${path}`);
    }

    const rootApi = await import("slick2d-ts");
    const playbackApi = await import("slick2d-ts/slick/openal/PlaybackSession");
    const fullscreenApi = await import("slick2d-ts/slick/util/BrowserFullscreen");
    assert.equal(typeof rootApi.Music, "function");
    assert.equal(typeof rootApi.SoundStore, "function");
    assert.equal(typeof rootApi.SoundStore.get().poll, "undefined", "retired SoundStore.poll API survived in the installed engine");
    assert.equal(typeof playbackApi.PlaybackSession, "function");
    assert.equal(typeof fullscreenApi.getBrowserFullscreenCapability, "function");
    assert.equal(typeof fullscreenApi.getBrowserFullscreenElement, "function");
    assert.equal(typeof fullscreenApi.requestBrowserFullscreen, "function");
    assert.equal(typeof fullscreenApi.exitBrowserFullscreen, "function");
});
