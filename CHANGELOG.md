# Changelog

## Unreleased

- Add editable LEGO 21000 Sears Tower (69 pieces / 17 steps), 21002 Empire State Building (77 / 25), and 21007 Rockefeller Center (240 / 23 main steps), with original printed nameplates and audited official step membership.
- Prepare precise part geometry before opening manuals, loading models, recovering saved assets and updating the canvas status, preventing false collision reports on first use.
- Add LEGO Architecture 21013 Big Ben as an editable 346-piece model with 52 official main steps, four printed clock faces and its original nameplate.
- Support all 24 orthogonal part orientations, preserving roll through rendering, connectors, editing, JSON, LDraw metadata and manuals; recognize the audited central tube and hollow-stud connections used by this model.

- Remove the project manager and AI task panels from the header while retaining workspace autosave and request lifetime protection.

- Add LEGO 30023 Lighthouse as a standard editable model with 25 pieces and nine official instruction steps, using the same model cards, main canvas and building manual as Classic Ghost.
- Add the required LDraw part geometry and gray colors, and preserve official step groups in the existing manual; remove the custom replica viewer.
- Preserve edits made during project activation, deletion, checkpoint restoration and reload; retain late replacement edits as recoverable checkpoints or projects.
- Stop asset autosaves after failed recovery, preserve damaged copies, support retries and merge edits made while loading.
- Commit world-object changes with persisted event consumption and reject stale director-turn finalizers across workspace replacements.
- Bound imported coordinates and LDraw expansion, move LDraw parsing/validation into a cancellable worker, sanitize recovered world events and validate OBJ files before reads.
- Isolate scene shortcuts and focus while dialogs are open; repair copied AI fallback references, generated dialogue display and scenario brick/structure commands.
- Release owned replica resources on cancellation/unmount, allow loading retries and limit crowded speech overlays while prioritizing selected actors and scenario dialogue.
- Update audited dependencies, include dependency auditing in release/CI gates and correct the 1500-block production fixture with validity and obstacle-count assertions.

- Restore all six Minecraft block faces by assigning cached materials as a mesh material array, including instanced blocks and compound shapes.
- Preserve official transparent colors in LEGO palettes, thumbnails, scene materials and LDraw export; migrate legacy 3065 colors in projects, checkpoints and imported files.

- Pause simulation and automatic scenario work until project hydration completes; preserve edits made during restoration in a separate project instead of overwriting the authoritative copy.
- Retain edits made during save-as creation and activation, including changes that arrive during follow-up writes.
- Isolate the local LLM proxy from Vite configuration; handle partial-stream failures and timeouts without rewriting sent headers, and cancel upstream work when clients disconnect.
- Scope structural analysis history and suite results to local project IDs; migrate legacy plan-keyed records to the first opened project and remove scoped results when a project is deleted.
- Update the active-project pointer in the same transaction as project deletion, and keep project-menu refresh from disabling user actions.
- Run the production browser gate with a real WebKit project; reuse voxel texture colors and materials across repeated faces.
- Move LLM connection configuration, verification, cancellation, and feedback into a dedicated hook so project transitions have a single cancellation entry point.
- Preserve unfinished drafts and protect unreadable drafts from replacement autosaves, with recovery downloads and visible save status.
- Restore complete projects on undo/redo, record explicit NPC/scenario edits, and isolate disposable playtest history and persistence.
- Keep cancellation and timeouts active through response-body reads; invalidate stale AI work on workspace changes.
- Tolerate unavailable browser storage and malformed API settings; coordinate local-data deletion with active saves.
- Recover newer IndexedDB drafts even when the localStorage marker is missing or stale.
- Preserve selected disaster settings across model changes and retain voxel interaction state in manual schema 6, while reading earlier schemas.
- Version simulation snapshots and transfer model data to workers only when geometry changes.
- Separate runtime entity operations, save parsing, and built-in scenario migrations; index fence neighbors for large scenes.
- Add production browser smoke tests, large-scene browser performance samples, and regressions for recovery and asynchronous state boundaries.

## 0.4.0 — 2026-08-30

- Added deterministic reinforcement proposals that turn an active hazard result into collision-free support-column options.
- Added before/after hazard simulation for every candidate, ranked by score improvement and failure reduction.
- Added inventory-aware LEGO and Minecraft support generation with full structural validation before recommendation.
- Added translucent in-scene reinforcement previews and one-click application through the normal undo history.
- Added explicit no-improvement handling so valid but ineffective candidates are not recommended.
- Added unit and browser workflow coverage for generation, validation, preview, application, and undo.

## 0.3.0 — 2026-08-30

- Added reproducible structural test suites covering multiple hazard types, intensities, and load directions.
- Added quick, standard, and stress presets with challenge and realistic physics profiles.
- Added background batch execution with per-case progress, aggregate resilience scoring, and automatic weakest-case detection.
- Added one-click weakest-case replay inside Stability Lab.
- Persisted the latest suite result per project and marked it stale after structural edits.
- Added Markdown, JSON, and shareable SVG suite reports.
- Added unit and browser workflow coverage for suite aggregation, persistence, and replay.

## 0.2.0 — 2026-08-30

- Added per-project structural-analysis history with named baselines, metric comparisons, and Markdown/JSON/SVG comparison exports.
- Added stale-analysis detection so model edits clearly request a fresh structural run.
- Added previous/next risk navigation, camera focus, and related-support highlighting in Stability Lab.
- Added light and dark analysis report themes, scene thumbnails, and direct PNG export.
- Added an import compatibility center retaining the latest 10 JSON, LDraw/MPD, and OBJ diagnostics, including unsupported-part counts and OBJ quality metrics.
- Added copyable import reports and prefilled compatibility issues for reproducible bug reports.
- Split configuration and compatibility dialogs into lazy-loaded components and injected the package version at build time.
- Expanded browser workflow coverage for stability-history reporting and LDraw compatibility diagnostics.

## 0.1.0 — 2026-08-28

- Added actionable structural-risk explanations and stability recommendations.
- Added JSON, Markdown, and shareable SVG stability reports.
- Added workspace-wide drag-and-drop import for JSON, LDR, MPD, and OBJ files.
- Added persistent import compatibility summaries.
- Added a prefilled, privacy-conscious feedback workflow and GitHub issue templates.
- Added explicit API-setting and all-local-data removal controls.
- Added an application error recovery boundary.
- Added Playwright coverage for clear-canvas, drag-and-drop import, and feedback diagnostics.
