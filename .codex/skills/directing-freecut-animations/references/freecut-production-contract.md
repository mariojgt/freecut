# FreeCut production contract

Use this reference only after the current director proposal is explicitly approved.

## 1. Preflight

1. Confirm the connected MCP surface exposes project, block, edit, scene-check, motion-sampling, contact-sheet, and render tools. If the names are namespaced by `vespera` or `freecut`, use the exposed names rather than inventing aliases.
2. Call the capability tool and follow its current operation schemas. Treat this reference as workflow guidance, not a replacement for the live schema.
3. List registered blocks, gestures, poses, and palettes. Do not guess ids.
4. Read the target project and retain its revision for every persistent mutation.
5. Inspect media when narration, music, or sound already exists.

For a new project, use these ordinary starting sizes unless the user requested another resolution:

| Ratio  | Width | Height |
| ------ | ----: | -----: |
| `16:9` |  1920 |   1080 |
| `9:16` |  1080 |   1920 |
| `1:1`  |  1080 |   1080 |

Preserve an existing project's frame rate unless the approved plan changes it.

## 2. Style mapping

Use one of the native monochrome systems:

| Approved theme | Block palette    | Project background | Structural line |
| -------------- | ---------------- | ------------------ | --------------- |
| Light          | `stickman-light` | `#ffffff`          | near-black      |
| Dark           | `stickman-dark`  | `#000000`          | near-white      |

Keep only `primary`, `secondary`, and `accent` saturated. Assign one meaning to each role for the whole animation—for example danger, discovery, and payoff—and do not swap those meanings between scenes.

The built-in actor is `character-stick-figure`. Its reviewed vocabulary includes:

- ambient/locomotion: `stick-idle`, `stick-walk`;
- one-shots: `stick-wave`, `stick-jump`, `stick-celebrate`;
- poses: `stick-stand`, `stick-point-forward`, `stick-point-up`, `stick-explain`, `stick-think`, `stick-celebrate`, `stick-crouch`.

Use the block catalog as the authority. When the approved subject needs another rig, prefer an existing block. Define an original project block only when the catalog genuinely lacks the subject; keep the geometry editable and validate it before use.

## 3. Convert each scene into operations

Give every actor instance an explicit, stable `idPrefix`, such as `scene-01-guide`. Later pose, gesture, slot, direction, camera, and QA calls must target that prefix rather than an inferred random id.

Build each approximately ten-second scene as three spans:

- opening span: establish the inherited pose, moving object, shape, or camera direction;
- development span: transform the visual metaphor or reveal the mechanism;
- handoff span: deliver the payoff and leave a concrete state the next scene can inherit.

Use the live capability schema to compose operations from these primitives:

- `addBlock` for reviewed actors, environments, and props;
- `applyPose` for readable acting silhouettes and pose sequences;
- `applyGesture` for authored character actions;
- `directAction` for entrances, exits, reveals, travel, emphasis, and shake;
- `setCamera` for pushes, pulls, pans, rises, and settles with depth-aware motion;
- `attachToSlot` when a prop belongs in a hand or a UI element belongs in a container;
- `addText` only for approved post-production overlays;
- `addTransition` only when the scene boundary contains compatible timeline clips; otherwise use a foreground wipe, matched movement, or shape handoff.

Prefer intent-driven operations. Add raw keyframes only when no registered pose, gesture, action, or camera recipe can express the approved beat.

## 4. Cue to narration

When word timings exist, put `setNarration` in the same edit batch as every cue-based operation; narration state is call-scoped. Target beats with `fromCue`, `untilCue`, or pose `atCue` fields from the live schema.

When no timed narration exists:

1. keep the approved sentence boundaries aligned with scene boundaries;
2. use conservative approximate seconds for the proof scene;
3. re-cue the full animation after narration is recorded or generated in FreeCut;
4. do not claim word-accurate synchronization.

Keep music below narration. Tie sound effects to visible contacts, wipes, jumps, object travel, transformations, and reveals rather than adding continuous noise.

## 5. Continuity and composition

Restate every approved handoff while authoring operations. The next scene must visibly inherit at least one of:

- actor pose or travel direction;
- object position or silhouette;
- camera direction or framing scale;
- frame-filling wipe element;
- accent-colour role;
- shape that can match-cut or morph.

Do not use a generic dissolve to hide a missing continuity idea.

Respect aspect-specific staging:

- `16:9`: distribute actors and props laterally; use clean negative space and horizontal travel.
- `9:16`: separate foreground, actor, and background in depth; use vertical reveals and keep critical action away from interface edges.
- `1:1`: centre the core metaphor; use compact arcs and short camera travel.

## 6. Transaction controls

1. Assemble the complete approved operation batch.
2. Call the edit tool with `persist=false` and the current expected revision.
3. Inspect every operation result. Repair schema errors, missing ids, skipped rig parts, overlap, or invalid timing before persistence.
4. Submit the same reviewed batch with `persist=true` and the same revision only if the project has not changed.
5. Read the project again after persistence and use its new revision for repairs.

If a revision conflict occurs, stop. Re-read the project, reconcile the proposal with current state, and dry-run again. Do not solve a conflict by setting `force=true` blindly.

For a long animation, dry-run and verify one scene first. Expand scene by scene when the contact sheet and motion sample confirm the style; this limits large batches of unusable path layers.

## 7. Perceptual QA loop

After each persisted proof scene, and again after the complete animation:

1. Run the semantic scene checker at representative beat and boundary frames.
2. Run motion sampling for every actor or object expected to move.
3. Generate a contact sheet covering scene openings, beat changes, and endings.
4. Use a single-frame grab only to inspect a specific pose or visual fault.
5. Repair named faults, re-read the revision, dry-run the repair, persist it, and repeat all affected checks.

Reject the scene when any of these remain:

- an empty or near-empty planned beat;
- actor or important prop outside frame;
- unsafe or clipped overlay text;
- opacity that makes intended content effectively invisible;
- keyframed content that does not actually move;
- repeated frames where the plan requires a new beat;
- unreadable silhouette or broken actor hierarchy;
- continuity mismatch at a scene boundary.

Render last. A successful render does not replace the scene, motion, and contact-sheet checks.

## 8. Completion record

Report:

- project id and final revision;
- scene duration and ratio;
- blocks, palettes, gestures, and poses used;
- scene-check and motion-sampling outcomes;
- contact-sheet coverage;
- final render path or export result;
- any approved element not implemented and why.
