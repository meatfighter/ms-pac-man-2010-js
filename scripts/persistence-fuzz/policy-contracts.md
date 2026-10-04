# Reviewed persistence contracts — ms-pac-man-2010-js

This document accompanies `policy-inventory.json` and the actual validator modules. The inventory is generated from current registries and production declarations; it must not supply synthetic positive fixtures from validator defaults.

## Representation and justified restrictions

| Category                               | Treatment                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary floating state                | Finite numbers; no English-name position/velocity magnitude ceilings                                                                                             |
| Accumulated JS scores/cursors/counters | Nonnegative safe integers where producer semantics require exact integral values; no blanket signed-32-bit ceiling                                               |
| Explicit entity state/sprite/type IDs  | Owner-qualified reviewed finite sets, not reflection over similarly named constants                                                                              |
| Java scalar integer fields             | Declared-type classification; no `Timer`/`Delay` suffix guesses                                                                                                  |
| Resources/indexes                      | Actual loaded stages, maze matrices, frames, text cursor and resource arrays remain authoritative                                                                |
| Entity roots and references            | Known types, exact required fields, resolvable references, ordering and required ownership retained                                                              |
| Audio                                  | Engine playback snapshot contracts and its genuine 62-SFX-slot capacity retained; no extra 24-hour cursor ceiling                                                |
| Phase/authority constraints            | Known pause/fade/death/listener, region/door, stopwatch/shield and presentation contracts retained unless a demonstrated contradiction requires a precise change |
| Capacity                               | JSON depth/container/string/byte and entity budgets are explicit defensive capacity policies, not claims about historical game reachability                      |
| Settings/requests                      | Stable game slot and separate preference/network authorities remain separate                                                                                     |

Fresh outgoing saves use the same general validator and full loaded-resource preflight used by same-build restoration. Read inspection without loaded resources remains a nonmutating eligibility hint; actual restore performs resource preflight. The write does not inspect the previous canonical record and never repairs old/incompatible input.

## Concrete repairs and controls

- Jackal: GrayBoat/GreenBoat sprite IDs 0/1; no lexical enum inference; disabled completed Konami cursor 10 accepted; large supported counters; dormant non-stage-six conveyor fields no longer forced to zero.
- Pac: an exhausted RobotInput cursor remains exactly represented past recording length; safe-integer local score with independent unchanged network-cutoff contract; remove conflicting blanket 100000 rule.
- Stickvania: remove STATE/TYPE reflection and timer-name guesses; generated declared Java integer inventory; remove generic coordinate/velocity/collision-offset ceilings; preserve MAP=100 and current countdown/stopwatch/door/region policies.
- All: nonfinite values, malformed graph/shape, out-of-range resource IDs, incompatible schema and unauthorized writes remain failures. Debug retention runs only on outgoing validation failure.

`validator-repairs.test.mjs` uses real producer classes and actual serializers/stores with deliberately controlled resource/audio dependencies where the stripped archive lacks assets. These tests are **not** natural browser playthrough evidence. The browser adapter and complete qualification must supply that additional evidence.

## Audit boundaries

The new manifest indexes every ordinary registered saved field and special snapshot shape. Its producer references primarily index `this.field` accesses and initializers; it is not a whole-program alias analysis. Explicit enum tables were reviewed against the producer declarations/consumers; timing, presentation and graph policies remain separate and visible. Do not label the entire state space proven merely because inventory counts match.

Remaining container/text budgets protect parsing and resource allocation. They have not been proven unreachable for every possible indefinite play session; the fuzzer logs any eligible producer rejection or capacity failure for further analysis. Do not weaken a real resource bound to conceal an incoherent seed. Do not reject a coherent seed just because a human could not reach that piece of valid terrain.

The boat zero-distance aiming suggestion is explicitly excluded: the user's real maps keep boats in water inaccessible to the jeep. No aiming, collision, stage-map, rendering cadence or other gameplay arithmetic has been modified to accommodate fuzzing.
