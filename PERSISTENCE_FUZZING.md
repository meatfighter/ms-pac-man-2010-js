# Persistence validation and fuzzing

## Status and prerequisites

These commands are test-only. They require a **complete checkout**, its real PWA images/audio/maps, Node **24 or later**, the installed locked dependencies, and installed Playwright browser binaries. The stripped source delivery omits binary resources and is not independently browser-runnable. Apply its changes to the complete checkout rather than deleting your existing assets.

The command does not install dependencies, build/stamp/clean release output, deploy, call GitHub Actions, or alter repository files. Evidence must be outside **every** game/engine checkout, including their `dist` directories. Vite's disposable dev compilation is used, not the release artifact. The source, installed engine bytes and retained `dist` are inventoried before/after a campaign.

## Commands

Run from this repository's root after normal dependency installation:

```powershell
npm run test:persistence-fuzz
npm run verify:persistence-fuzz
npm run verify:persistence-fuzz:browsers
npm run fuzz:persistence:soak -- --hours=10 --seed=0x20261004 --artifacts=C:\js-projects\qualification-evidence\ms-pac-man-2010-js-night-01
```

Use a **new** evidence directory for every command. For many fixed trials instead of a duration:

```powershell
npm run fuzz:persistence:soak -- --trials=10000 --seed=12345 --artifacts=C:\js-projects\qualification-evidence\ms-pac-man-2010-js-trials-01
```

Replay the exact failure recipe:

```powershell
npm run fuzz:persistence:replay -- --replay=C:\path\to\issues\ISSUE_ID\repro.json
```

After making a repair, use the explicit `--allow-source-drift` replay option. It records the new source identity; a clean replay is evidence about that case, not qualification of the changed build. Generator/profile/recipe mismatches are not silently migrated. Replaying `pending-trial.json` from an interrupted run is also supported when it contains a running reproduction.

Bounded minimization is optional and runs only when requested:

```powershell
npm run fuzz:persistence:replay -- --replay=C:\path\to\repro.json --shrink --max-shrink-attempts=32
```

This first reproduces the target signature, then reduces input blocks while keeping the spatial recipe intact. The original remains untouched. Interrupted progress, the reduced recipe and the attempt count are saved separately. Automatic shrinking does not delay ordinary overnight discovery.

`node scripts/run-persistence-fuzz.mjs --help` describes budgets, browser selection, timeout, audio mode and callback counts. `--ticks` means **outer update callbacks**, not an invented count of fixed simulation ticks. The actual game handles its own fixed-step loop.

## Profiles and outcomes

Qualification uses the fixed seed `0x20261004`, one stratified sweep, 240 outer callbacks per trial and 24 continuation callbacks. Browser qualification uses 120 callbacks and a real document-reload check for every trial. Soak defaults to eight hours; its initial sweep is stratified, followed by sampling biased toward less-observed strata, with alternating spatial/natural lanes. These are initial explicit work budgets, not benchmarked wall-time promises.

Both profiles collect failures, retain evidence, retire damaged/stuck trials, and continue. Finding one defect does not stop the campaign. A repeated systemic infrastructure failure, evidence-budget exhaustion, or user interruption ends the run as **incomplete**, not passing. A hard per-trial child-process watchdog terminates only owned workers/browser descendants. First Ctrl+C requests orderly termination and preserves the pending reproduction; killing the outer process forcibly may leave the last pending trial as the recovery record.

Exit codes:

| Code | Meaning                                                                           |
| ---- | --------------------------------------------------------------------------------- |
| 0    | Complete, no findings, required strata and nonzero capture/write/restore coverage |
| 1    | Findings recorded; release gate fails after collecting the campaign               |
| 2    | Infrastructure failure, missing coverage, integrity change or incomplete evidence |
| 130  | User interruption; not qualification                                              |

A successful local replay does not require sampling every level. A qualification run does. The surrounding npm chain can stop after a failed fuzz campaign; unexecuted later gates are not passes.

## What the adapter exercises

All 32 world/stage mazes. Spatial trials use aligned non-wall cells with an adjacent passable direction. Ghost positions, pellet counts and maze data are initialized by the real game.

The adapters initialize real runtime classes and resources, feed normal DOM keyboard events through production input, run production container/Main updates and render schedules, capture actual serializers, and invoke the production frozen-save/store path. Placement is never accepted or rejected by asking the snapshot validator whether it likes the seed.

Capture/validation is frequent. New observed entity/mode coverage, actual phase/owner/life/score transitions and periodic intervals trigger full authorized saves. The original live runtime supplies the uninterrupted continuation. Fresh documents reset static caches before restoring saved bytes and comparing immediate durable state plus continuation. Sampled observer-control trials run the same continuation without repeated snapshots to detect observational side effects.

The real `pagehide` tier uses the fixture's production frozen-save/store path and receipt, followed by a new document. **It is not a substitute for the full production shell's existing `verify:departure-save` suite**; that suite remains mandatory. Service workers are blocked in fuzz contexts, so service-worker behavior is covered by existing production/offline qualification, not this fixture.

## Deterministic and native audio

The default controlled lane substitutes only browser output nodes and their clock, while retaining production logical audio objects and real OfflineAudioContext decoding. It does not test native device output. An optional `--audio=native` lane is observational: native playback cursor positions are excluded from its strict oracle; transport, ownership and voice membership are still compared. Native timing failures need environment-aware triage. Existing native-audio qualification remains required.

Only wire metadata (`savedAt`, `appVersion`, reconstructed `nextFrameTime`) and JSON's representation of negative zero are normalized. Controlled audio offsets have a narrowly bounded floating-point tolerance. Gameplay counters, state, IDs, ordering, owners and RNG are not broadly ignored.

## Evidence and replay

`campaign.json` records source/engine identities and configuration. `events.jsonl` is flushed during the run. `summary.json` and `pending-trial.json` are replaced atomically; a crash can be diagnosed from the last recorded trial. First occurrences retain `issue.json`, `repro.json`, and compressed current/previous snapshots. Duplicate signatures increment counters rather than creating unlimited dumps. The default evidence ceiling is 128 MiB and 256 distinct signatures. Exhaustion is explicit failure, not silent data loss.

There is no automatic GitHub issue creation and no production leaderboard traffic. Each trial uses an isolated browser context and loopback origin; outbound and API writes are denied. Game-over/ending submission attempts cannot reach the production server.

The implementation currently biases by observed **stratum** coverage. It does not yet implement a disk-backed queue of interesting saved states for branching, or claim exhaustive actor/phase coverage. Detailed observed modes/entities/states are reported so gaps can be addressed deliberately. Known boundary regressions are separate mandatory producer tests rather than hoping random input discovers a cheat code or a terminal demo cursor.

## Qualification and release exclusion

`qualify` includes the short campaign and producer regressions. `qualify:browsers` includes the smaller reload-oriented profile. Neither invokes the overnight profile. Complete source changes and formatting first, commit the intended clean source, then run both gates. Preserve the final qualified `dist`; the standalone fuzz commands must not rebuild it.

A build-only Vite guard rejects fuzz module/string markers in emitted output. The fixture plugin itself is imported only by the test worker, not the normal dev/release configuration. A negative-control test injects a marker and verifies rejection. Full release/archive exclusion must still pass on complete resources.

## Policy inventory

```powershell
npm run generate:persistence-policy-inventory
npm run check:persistence-policy-inventory
```

The committed inventory enumerates saved owner fields, explicit descriptors, declarations, direct producer/consumer references and special encoded shapes. New registry fields change the inventory and fail its check. It is a navigation/coverage tool, **not a proof of all reachable states**: dynamic aliases, resource topology and cross-field rules require source review and real producer trajectories. See `scripts/persistence-fuzz/policy-contracts.md`.

## Rejected production saves

The production diagnostic slot is updated only for an authorized captured outgoing snapshot that a validator rejects or whose validation throws. It is not a trace of normal saves and is not written on load, not-ready, capture, encoding, size, permission or storage failures. It is bounded, best-effort and never replaces the canonical save. A later successful save does not erase forensic evidence.

The soak retains at most 32 accepted, novel checkpoints within an 8 MiB corpus.
Only trials with successful writes, cold restoration and matching continuation
can contribute. Later trials branch from that corpus in fresh documents with new
input/schedule streams. Each reproduction embeds its selected checkpoint and
parent identity; the resolved plan is recorded before execution. Rejected trials
never become branch roots. The corpus is bounded exploration, not exhaustive
actor or phase coverage.

Qualification also runs `npm run verify:persistence-fuzz:controls`: independent
real-resource browser mutations must expose rejected valid snapshots, suppressed
canonical writes, restored-score drift and missing coverage. Infrastructure
failures cannot count as mutation kills. Campaign summaries include observed
progress, actual browser version, save timing and maximum captured text size.
Timing uses the browser monotonic clock independently of controlled game clocks.
