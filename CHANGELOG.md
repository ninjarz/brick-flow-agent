# Changelog

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
