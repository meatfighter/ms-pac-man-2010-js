// Test-only transition projection. Audio positions and ordinary countdowns are deliberately absent.
const select = (value, keys) => Object.fromEntries(keys.filter((key) => value && Object.hasOwn(value, key)).map((key) => [key, value[key]]));
const music = (value) => (value ? [value.id, value.playback?.transport] : null);
const sounds = (values) =>
    (values ?? []).map((sound) => [sound.id, sound.playback?.activeVoiceIndex, sound.playback?.voices?.map((voice) => [voice.looped, voice.playbackRate])]);
export function captureContext(s) {
    return { stage: s.mainFields.stageIndex, world: s.mainFields.worldIndex, hard: false, mode: s.mode.id };
}
export function transitionProjection(s) {
    const playing = s.mode.id === "playing" ? s.mode : null;
    return {
        context: captureContext(s),
        main: select(s.mainFields, ["paused", "score", "lives", "demoMode"]),
        mode: select(s.mode.fields, [
            "state",
            "nextState",
            "fadeState",
            "finished",
            "playerKilledFlag",
            "showGhostPoints",
            "fruitTargetPresent",
            "redEnergizerPresent",
            "greenEnergizerPresent"
        ]),
        player: select(playing?.mspacman.fields, ["speedBoost"]),
        eatenGhost: playing?.eatenGhostIndex,
        inputRobot: playing?.inputRobotIndex,
        ghosts: playing?.ghosts.map((g) => select(g.fields, ["blue", "eyeBalls", "inHome", "exitingHome"])),
        music: music(s.music),
        sounds: sounds(s.soundEffects)
    };
}
