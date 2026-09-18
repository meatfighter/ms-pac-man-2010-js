import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pwaRoot = resolve(rootDir, "pwa");
const APP_VERSION = "audio-persistence-test";
const EMPTY_SOUND = { voices: [], activeVoiceIndex: null };

const server = await createServer({
    root: pwaRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
});

try {
    const { registeredSounds } = await server.ssrLoadModule("/src/mspacman/AudioRegistry.ts");
    const { Main } = await server.ssrLoadModule("/src/mspacman/Main.ts");
    const { MsPacManGameStateSerializer, isValidMsPacManGameStateSnapshot } = await server.ssrLoadModule(
        "/src/mspacman/persistence/MsPacManGameStateSerializer.ts"
    );

    await runTest("audio registry contains 30 stable unique Sound ids", () => {
        const main = createAudioMain();
        const entries = registeredSounds(main);
        assert.equal(entries.length, 30);
        assert.equal(new Set(entries.map((entry) => entry.id)).size, 30);
        assert.equal(new Set(entries.map((entry) => entry.sound)).size, 30);
        assert.equal(
            entries.some((entry) => entry.id === "blueGhosts"),
            true
        );
        assert.equal(
            entries.some((entry) => entry.id === "speaking:1:9"),
            true
        );
    });

    await runTest("audio registry rejects partial initialization and duplicate Sound aliases", () => {
        const partial = createAudioMain();
        partial.diedSound = undefined;
        assert.throws(() => registeredSounds(partial), /partially initialized/);

        const duplicate = createAudioMain();
        duplicate.diedSound = duplicate.clappingSound;
        assert.throws(() => registeredSounds(duplicate), /more than one stable id/);

        assert.deepEqual(registeredSounds({}), []);
    });

    await runTest("Music capture discovers the active registered transport instead of trusting currentMusic", () => {
        const serializer = new MsPacManGameStateSerializer();
        const main = createAudioMain();
        main.currentMusic = main.stageMusic[0];
        main.actMusic[1].state = playback("playing", false, 17.25, 0.8);

        const captured = serializer.captureMusic(main);

        assert.equal(captured.id, "act:1");
        assert.equal(captured.playback.positionSeconds, 17.25);
        assert.equal(captured.playback.volume, 0.8);

        main.trainingMusic.state = playback("playing", true, 3, 1);
        assert.throws(() => serializer.captureMusic(main), /Multiple registered Music transports are active/);
    });

    await runTest("Sound capture is sparse but preserves every voice and active index", () => {
        const serializer = new MsPacManGameStateSerializer();
        const main = createAudioMain();
        main.blueGhostsSound.state = soundPlayback([voice(1.25, 1, false)], 0);
        main.atePellotSound.state = soundPlayback([voice(0.02, 0.5, false), voice(0.01, 0.25, false)], null);
        main.speaking[1][7].state = soundPlayback([voice(0.75, 1, false)], 0);

        const captured = serializer.captureSoundEffects(main);

        assert.deepEqual(
            captured.map((entry) => entry.id),
            ["atePellot", "blueGhosts", "speaking:1:7"]
        );
        assert.equal(captured[0].playback.voices.length, 2);
        assert.equal(captured[0].playback.activeVoiceIndex, null);
        assert.equal(captured[1].playback.voices[0].positionSeconds, 1.25);
        assert.equal(captured[2].playback.voices[0].positionSeconds, 0.75);
    });

    await runTest("Sound restore clears every unlisted registered Sound after restoring captured voices", () => {
        const serializer = new MsPacManGameStateSerializer();
        const main = createAudioMain();
        main.clappingSound.state = soundPlayback([voice(4, 1, false)], 0);
        main.diedSound.state = soundPlayback([voice(2, 1, false)], 0);
        const blue = soundPlayback([voice(1.5, 0.5, false)], 0);

        serializer.restoreSoundEffects(main, [{ id: "blueGhosts", playback: blue }]);

        for (const { id, sound } of registeredSounds(main)) {
            assert.equal(sound.restoreCalls.length, 1, `${id} was not explicitly restored`);
            assert.deepEqual(sound.state, id === "blueGhosts" ? blue : EMPTY_SOUND, id);
        }
    });

    await runTest("v7 validator enforces sparse Sound ids, shape, uniqueness, total voice capacity, and audio-policy ownership", () => {
        const serializer = new MsPacManGameStateSerializer();
        const main = createSerializableMain();
        main.blueGhostsSound.state = soundPlayback([voice(1.5, 1, false)], 0);
        const snapshot = serializer.createSnapshot(main, APP_VERSION);

        assert.equal(snapshot.version, 7);
        assert.equal(snapshot.soundEffects.length, 1);
        assert.equal("audioSettings" in snapshot, false);
        assert.equal(isValidMsPacManGameStateSnapshot(snapshot), true);

        const obsoleteAudioPolicy = clone(snapshot);
        obsoleteAudioPolicy.audioSettings = { musicOn: false, soundOn: true };
        assert.equal(isValidMsPacManGameStateSnapshot(obsoleteAudioPolicy), false);

        const stoppedMusic = clone(snapshot);
        stoppedMusic.music = {
            id: "stage:0",
            playback: playback("stopped", true, 0, 1)
        };
        assert.equal(isValidMsPacManGameStateSnapshot(stoppedMusic), false);

        const duplicate = clone(snapshot);
        duplicate.soundEffects.push(clone(duplicate.soundEffects[0]));
        assert.equal(isValidMsPacManGameStateSnapshot(duplicate), false);

        const unknown = clone(snapshot);
        unknown.soundEffects[0].id = "unknown";
        assert.equal(isValidMsPacManGameStateSnapshot(unknown), false);

        const emptySparseEntry = clone(snapshot);
        emptySparseEntry.soundEffects[0].playback = clone(EMPTY_SOUND);
        assert.equal(isValidMsPacManGameStateSnapshot(emptySparseEntry), false);

        const tooManyVoices = clone(snapshot);
        tooManyVoices.soundEffects[0].playback.voices = Array.from({ length: 63 }, () => voice(0.1, 1, false));
        tooManyVoices.soundEffects[0].playback.activeVoiceIndex = 62;
        assert.equal(isValidMsPacManGameStateSnapshot(tooManyVoices), false);

        const malformed = clone(snapshot);
        malformed.soundEffects[0].playback.voices[0].gain = -1;
        assert.equal(isValidMsPacManGameStateSnapshot(malformed), false);

        const oldVersion = clone(snapshot);
        oldVersion.version = 6;
        assert.equal(isValidMsPacManGameStateSnapshot(oldVersion), false);
    });

    await runTest("gameplay Pause owns logical Music transport without changing application audio policy", () => {
        let pauseCalls = 0;
        let resumeCalls = 0;
        let stoppedEffects = 0;
        const pauseTransitions = [];
        const main = Object.create(Main.prototype);
        Object.assign(main, {
            browserSuspended: false,
            fadeMusicFlag: false,
            paused: false,
            mode: Main.playingMode,
            nextFrameTime: Number.MAX_SAFE_INTEGER,
            input: {
                isPausePressed: () => true,
                isGameplayStartPressed: () => false
            },
            currentMusic: {
                pause() {
                    pauseCalls++;
                },
                resume() {
                    resumeCalls++;
                }
            },
            pauseStateChangeHandler: (paused) => pauseTransitions.push(paused),
            stopAllSoundEffects() {
                stoppedEffects++;
            }
        });
        const gc = {
            setMusicOn() {
                throw new Error("gameplay Pause must not mutate global Music policy");
            },
            setSoundOn() {
                throw new Error("gameplay Pause must not mutate global Sound policy");
            }
        };

        Main.prototype.update.call(main, gc, 16);

        assert.equal(main.paused, true);
        assert.equal(pauseCalls, 1);
        assert.equal(resumeCalls, 0);
        assert.equal(stoppedEffects, 1);
        assert.deepEqual(pauseTransitions, [true]);

        Main.prototype.update.call(main, gc, 16);

        assert.equal(main.paused, false);
        assert.equal(pauseCalls, 1);
        assert.equal(resumeCalls, 1);
        assert.equal(stoppedEffects, 1);
        assert.deepEqual(pauseTransitions, [true, false]);
    });

    await runTest("only the PWA shell may mutate global Music/Sound enable policy", () => {
        const calls = collectAudioPolicySetterCalls(resolve(rootDir, "pwa", "src"));
        assert.deepEqual(calls, [
            "pwa/src/app/main.ts:setMusicOn",
            "pwa/src/app/main.ts:setSoundsOn"
        ]);
    });

    await runTest("PWA shell establishes application audio policy before activation and on Reset", () => {
        const source = readFileSync(resolve(rootDir, "pwa/src/app/main.ts"), "utf8");
        const start = functionSource(source, "async function startGame", "function renderBoot");
        assert.ok(start.indexOf("applyApplicationAudioPreferences()") < start.indexOf("beginGameAudio()"));

        const resume = functionSource(source, "async function resumeLiveGameFromMenu", "function removeMenuOverlay");
        assert.ok(resume.indexOf("applyApplicationAudioPreferences()") < resume.indexOf("beginGameAudio()"));

        const reset = functionSource(source, "function resetPwaState", "function hasLiveSuspendedGame");
        assert.match(reset, /applyApplicationAudioPreferences\(\)/);

        const helper = functionSource(source, "function applyApplicationAudioPreferences", "function applyVolumeToRuntime");
        assert.match(helper, /setMusicOn\(true\)/);
        assert.match(helper, /setSoundsOn\(true\)/);
        assert.match(helper, /applyVolumeToRuntime\(\)/);
    });

    await runTest("cutscene music sources use Main ownership wrappers", () => {
        const checks = [
            ["pwa/src/mspacman/IntroMode.ts", /\.introMusic\.play\s*\(/, /\.playMusic\(this\.main\.introMusic\)/],
            ["pwa/src/mspacman/Act1Mode.ts", /\.actMusic\[0\]\.play\s*\(/, /\.playMusic\(this\.main\.actMusic\[0\]\)/],
            ["pwa/src/mspacman/Act2Mode.ts", /\.actMusic\[1\]\.play\s*\(/, /\.playMusic\(this\.main\.actMusic\[1\]\)/],
            ["pwa/src/mspacman/Act3Mode.ts", /\.actMusic\[2\]\.play\s*\(/, /\.playMusic\(this\.main\.actMusic\[2\]\)/],
            ["pwa/src/mspacman/Act6Mode.ts", /\.actMusic\[0\]\.play\s*\(/, /\.playMusic\(this\.main\.actMusic\[0\]\)/]
        ];
        for (const [relativePath, forbidden, required] of checks) {
            const source = readFileSync(resolve(rootDir, relativePath), "utf8");
            assert.doesNotMatch(source, forbidden, relativePath);
            assert.match(source, required, relativePath);
        }
    });
} finally {
    await server.close();
}

function collectAudioPolicySetterCalls(directory, relative = "") {
    const calls = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            calls.push(...collectAudioPolicySetterCalls(path, childRelative));
            continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".ts")) {
            continue;
        }
        const source = readFileSync(path, "utf8");
        for (const method of ["setMusicOn", "setSoundsOn", "setSoundOn"]) {
            const matches = source.match(new RegExp(`\\.${method}\\s*\\(`, "g")) ?? [];
            for (let i = 0; i < matches.length; i++) {
                calls.push(`pwa/src/${childRelative}:${method}`);
            }
        }
    }
    return calls.sort();
}

function functionSource(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `Unable to isolate ${startMarker}.`);
    return source.slice(start, end);
}

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}

function createAudioMain() {
    const main = {
        currentMusic: null,
        actMusic: [createMusic(), createMusic(), createMusic()],
        stageMusic: [createMusic(), createMusic(), createMusic(), createMusic()],
        trainingMusic: createMusic(),
        introMusic: createMusic(),
        levelSelectMusic: createMusic(),
        highScoreMusic: createMusic(),
        gameOverMusic: createMusic(),
        atePellotSound: createSound(),
        ateEnergizerSound: createSound(),
        ateGhostSound: createSound(),
        ateFruitSound: createSound(),
        fruitAppearedSound: createSound(),
        blueGhostsSound: createSound(),
        clappingSound: createSound(),
        extraLifeSound: createSound(),
        diedSound: createSound(),
        pressedEnterSound: createSound(),
        speaking: Array.from({ length: 2 }, () => Array.from({ length: 10 }, () => createSound()))
    };
    return main;
}

function createSerializableMain() {
    const main = createAudioMain();
    Object.assign(main, {
        worldIndex: 0,
        stageIndex: 0,
        score: 0,
        lives: 5,
        paused: false,
        musicVolume: 1,
        musicVolumeFadeStep: 1 / 91,
        fadeMusicFlag: false,
        uploadComplete: true,
        demoIndex: 0,
        demoMode: false,
        mode: createAttractMode(),
        random: { getState: () => ({ seed0: 1, seed1: 2, seed2: 3 }) },
        robotInputs: [0, 1, 2, 3].map((index) => ({ getState: () => ({ index }) })),
        submittedScore: null,
        isStateSaveReady: () => true,
        getCurrentModeIdForState: () => "attract"
    });
    return main;
}

function createAttractMode() {
    return {
        dotsOffset: 0,
        redOffset: 0,
        fadeIndex: 0,
        fadeState: 0,
        state: 0,
        titleZ: 0,
        titleY: 0,
        titleVy: 0,
        y2010: 0,
        barsY: 0,
        pressEnterDelay: 0,
        pressEnterVisible: false,
        ghostSpriteIndex: 0,
        ghostSpriteIndexIncrementor: 0,
        ghostsVisible: 0,
        ghostX: 0,
        enterPressed: false,
        ticks: 0,
        countDown: 0
    };
}

function createMusic() {
    return {
        state: playback("stopped", false, 0, 1),
        capturePlaybackState() {
            return clone(this.state);
        },
        restorePlaybackState(state) {
            this.state = clone(state);
        }
    };
}

function createSound() {
    return {
        state: clone(EMPTY_SOUND),
        restoreCalls: [],
        capturePlaybackState() {
            return clone(this.state);
        },
        restorePlaybackState(state) {
            const copy = clone(state);
            this.restoreCalls.push(copy);
            this.state = copy;
        }
    };
}

function playback(transport, looped, positionSeconds, volume) {
    return {
        transport,
        looped,
        playbackRate: 1,
        positionSeconds,
        volume,
        fade: null
    };
}

function soundPlayback(voices, activeVoiceIndex) {
    return { voices: clone(voices), activeVoiceIndex };
}

function voice(positionSeconds, gain, looped) {
    return {
        looped,
        playbackRate: 1,
        positionSeconds,
        gain,
        spatialPosition: null
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
