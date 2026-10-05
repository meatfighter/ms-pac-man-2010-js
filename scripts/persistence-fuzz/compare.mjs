/** Only metadata is erased. No gameplay, owner, timer, RNG or order fields. */
export function normalizeSnapshot(snapshot, { nativeAudio = false } = {}) {
    function copy(value, path = []) {
        if (Array.isArray(value)) return value.map((item, i) => copy(item, [...path, i]));
        // JSON stores -0 as 0; compare the declared wire representation.
        if (typeof value === "number" && Object.is(value, -0)) return 0;
        if (value === null || typeof value !== "object") return value;
        const result = {};
        for (const key of Object.keys(value).sort()) {
            if (path.length === 0 && (key === "savedAt" || key === "appVersion")) continue;
            if (path.length === 1 && path[0] === "mainFields" && key === "nextFrameTime") continue;
            // Native cursor timing is not a deterministic oracle in this lane. Transport,
            // owners, voice count/order/rate/gain remain in the strict oracle.
            if (nativeAudio && key === "positionSeconds" && path.includes("playback")) continue;
            result[key] = copy(value[key], [...path, key]);
        }
        return result;
    }
    return copy(snapshot);
}
export function firstDifference(expected, actual, path = "$") {
    if (Object.is(expected, actual)) return null;
    // Equivalent captured native offsets can differ by floating-point association
    // after rebuilding startedAt. Do not use this tolerance for gameplay numbers.
    if (path.endsWith(".positionSeconds") && typeof expected === "number" && typeof actual === "number" && Math.abs(expected - actual) <= 1e-9) return null;
    if (expected === null || actual === null || typeof expected !== "object" || typeof actual !== "object") return { path, expected, actual };
    if (Array.isArray(expected) !== Array.isArray(actual)) return { path, expectedType: typeof expected, actualType: typeof actual };
    const left = Object.keys(expected),
        right = Object.keys(actual);
    if (left.length !== right.length || left.some((key) => !Object.hasOwn(actual, key))) return { path, expectedKeys: left, actualKeys: right };
    for (const key of left) {
        const delta = firstDifference(expected[key], actual[key], `${path}${Array.isArray(expected) ? `[${key}]` : `.${key}`}`);
        if (delta) return delta;
    }
    return null;
}
export function snapshotCoverage(snapshot) {
    const result = new Set();
    const mode = snapshot.kind === "game" ? "game" : (snapshot.modeId ?? snapshot.mode?.id ?? snapshot.mode);
    result.add(`mode:${String(mode)}`);
    for (const entity of snapshot.gameMode?.entities ?? snapshot.things ?? []) {
        const type = entity.type;
        result.add(`present:entity:${type}`);
        // Deliberately bounded discrete categories, not one key per timer/position.
        for (const key of ["state", "type", "spriteIndex", "orientation", "dead"]) {
            const value = entity.fields?.[key];
            if (typeof value === "boolean" || (Number.isInteger(value) && value >= -1 && value <= 32)) result.add(`present:entity:${type}:${key}:${value}`);
        }
    }
    for (const ghost of snapshot.mode?.ghosts ?? []) {
        for (const key of ["blue", "eyeBalls", "inHome", "exitingHome", "enteringHome"])
            result.add(`present:ghost:${ghost.fields.ghostIndex}:${key}:${ghost.fields[key]}`);
    }
    return [...result].sort();
}
export function issueSignature(issue) {
    const path = String(issue.path ?? issue.difference?.path ?? "");
    const entityPath = path.match(/(?:gameMode\.)?(entities|things)\[(\d+)\]/);
    const snapshot = issue.snapshot ?? issue.previousSnapshot;
    const entities = entityPath?.[1] === "things" ? snapshot?.things : snapshot?.gameMode?.entities;
    const entity = entityPath ? entities?.[Number(entityPath[2])] : null;
    const owner = issue.ownerType ?? entity?.type ?? "";
    const mode = snapshot?.mode?.id ?? snapshot?.modeId ?? snapshot?.mainFields?.mode ?? snapshot?.kind ?? "";
    const phase = `${mode}:${entity?.fields?.state ?? entity?.fields?.dead ?? ""}`;
    const cleanPath = path.replace(/\[\d+\]/g, "[*]");
    const generic = !issue.ruleCode && !cleanPath;
    const message = generic
        ? String(issue.error?.message ?? "")
              .replace(/0x[\da-f]+|\b\d+\b/gi, "#")
              .slice(0, 512)
        : "";
    const site = generic
        ? String(issue.error?.stack ?? "")
              .split("\n")
              .slice(1, 3)
              .map((line) =>
                  line
                      .replace(/https?:\/\/[^/]+/g, "<origin>")
                      .replace(/\?[^ )]+/g, "")
                      .trim()
              )
              .join(";")
        : "";
    return [issue.category, issue.ruleCode ?? issue.stage ?? "", owner, cleanPath, phase, issue.phase ?? "", issue.error?.name ?? "", message, site].join("|");
}

/** A transition trigger, not a validity rule. Every value is observed, never repaired. */
export function snapshotTransitionKey(snapshot) {
    const select = (value, keys) => Object.fromEntries(keys.filter((key) => value && Object.hasOwn(value, key)).map((key) => [key, value[key]]));
    const phases = [
        "mode",
        "stage",
        "stageIndex",
        "worldIndex",
        "paused",
        "fading",
        "fadeOut",
        "fadeState",
        "fadeReason",
        "score",
        "lives",
        "extraLives",
        "players",
        "hearts",
        "playing",
        "stageCompletedFlag",
        "bossCameraPan",
        "endingCameraPan",
        "finished",
        "playerKilledFlag",
        "gameOver",
        "showGhostPoints",
        "fruitTargetPresent",
        "redEnergizerPresent",
        "greenEnergizerPresent",
        "floorBreaking",
        "beatStageFlag",
        "creditsPaused",
        "creditsAdvance"
    ];
    const player = snapshot.playerFields ?? snapshot.mode?.mspacman?.fields ?? {};
    const music = snapshot.currentSongState?.activeMusic ?? snapshot.music ?? snapshot.audio?.currentMusic;
    return JSON.stringify({
        main: select(snapshot.mainFields, phases),
        mode: select(snapshot.gameMode?.fields ?? snapshot.mode?.fields, phases),
        player: select(player, ["dead", "pows", "releaseablePows", "speedBoost"]),
        respawning: (player.respawning ?? 0) > 0,
        frozen: (snapshot.mainFields?.timeFrozen ?? 0) > 0,
        entities: (snapshot.gameMode?.entities ?? snapshot.things ?? []).map((entity) => [
            entity.id,
            entity.type,
            select(entity.fields, ["state", "active", "dead", "kill", "layer", "onStairs", "supported"])
        ]),
        audio: {
            song: snapshot.currentSongState?.id ?? snapshot.audio?.currentSong,
            requested: snapshot.requestedSongId ?? snapshot.audio?.requestedSong,
            music: music?.id,
            transport: music?.playback?.transport,
            voices: (snapshot.soundEffects ?? snapshot.audio?.sounds ?? snapshot.audioState?.sounds ?? []).map((sound) => [
                sound.id,
                sound.playback?.activeVoiceIndex,
                sound.playback?.voices?.map((voice) => [voice.looped, voice.playbackRate])
            ])
        }
    });
}
