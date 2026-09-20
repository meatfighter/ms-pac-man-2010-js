import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROWS = 31;
const COLUMNS = 28;
const HEADER_BYTES = 8;
const GRID_BYTES = ROWS * COLUMNS;
const root = process.cwd();
const browserSource = readFileSync(join(root, "pwa", "src", "mspacman", "PlayingMode.ts"), "utf8");
const desktopSource = readFileSync(join(root, "desktop", "src", "mspacman", "PlayingMode.java"), "utf8");

let totalBoundaryEntries = 0;
let bottomBoundaryEntries = 0;
const bottomStages = [];

for (let world = 0; world < 4; world++) {
    for (let stage = 0; stage < 8; stage++) {
        const name = `stage_${world}_${stage}.dat`;
        const bytes = readFileSync(join(root, "pwa", "public", "stages", name));
        assert.ok(bytes.length >= HEADER_BYTES + GRID_BYTES * 2, `${name} is too short for tile+region grids`);

        const tileOffset = HEADER_BYTES;
        const regionOffset = HEADER_BYTES + GRID_BYTES;
        let stageBottomEntries = 0;
        for (let row = 0; row < ROWS; row++) {
            for (let column = 0; column < COLUMNS; column++) {
                const index = row * COLUMNS + column;
                const tile = bytes[tileOffset + index];
                const region = bytes[regionOffset + index];
                const boundary = row === 0 || row === ROWS - 1 || column === 0 || column === COLUMNS - 1;
                if (boundary && tile === 47 && region > 0) {
                    totalBoundaryEntries++;
                    if (row === ROWS - 1 && column !== 0 && column !== COLUMNS - 1) {
                        stageBottomEntries++;
                        bottomBoundaryEntries++;
                    }
                }
            }
        }
        if (stageBottomEntries > 0) {
            bottomStages.push({ world, stage, count: stageBottomEntries });
        }
    }
}

assert.ok(totalBoundaryEntries > 0, "shipped stages must provide at least one fruit-entry boundary");
assert.doesNotMatch(browserSource, /i\s*===\s*31/, "browser fruit-entry discovery must not test the unreachable row 31");
assert.doesNotMatch(desktopSource, /i\s*==\s*31/, "desktop fruit-entry discovery must not test the unreachable row 31");
assert.match(browserSource, /i === stage\.tileMap\.length - 1/);
assert.match(browserSource, /entry\[1\] === this\.tileMap\.length - 1/);
assert.match(desktopSource, /i == stage\.tileMap\.length - 1/);
assert.match(desktopSource, /entry\[1\] == tileMap\.length - 1/);

console.log(
    `ok - scanned 32 stage resources: ${totalBoundaryEntries} boundary fruit entries, ${bottomBoundaryEntries} bottom-edge entries` +
        (bottomStages.length === 0 ? "" : ` (${bottomStages.map(({ world, stage, count }) => `${world}/${stage}:${count}`).join(", ")})`)
);
