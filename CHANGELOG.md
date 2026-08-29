# Changelog

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
