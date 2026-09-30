/** World progress excludes metadata and independently sampled native audio clocks. */
export function departureWorld(snapshot) {
    return JSON.stringify(snapshot, (key, value) =>
        /^(savedAt|appVersion|buildStamp|nextFrameTime|audio|audioState|currentSongState|requestedSongId|music|soundEffects)$/.test(key) ? undefined : value
    );
}
