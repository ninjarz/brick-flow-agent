# brick-flow-agent

> A browser-based workspace for brick-like construction systems, powered by part packs, LDraw geometry, structural voxels, and optional LLM generation

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-r168-000?logo=three.js)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=fff)](https://vite.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)

English README | [中文文档](docs/README_zh.md)

brick-flow-agent, also named 积流工坊 in Chinese, turns prompts, imported plans, and hand-edited layouts into an interactive 3D building workspace. The goal is to bring different brick-like systems into one editor: LEGO-compatible LDraw parts today, Minecraft-style voxel blocks next, and more part packs later

The app uses React + Three.js for the editor, LDraw data for part rendering, and connector plus structural voxel rules for collision, support, and validation. It also includes a local asset library, voxel debugging, build-manual preview, and Markdown/HTML/JSON export

## ✨ Highlights

- Prompt- and reference-image-to-build generation through multimodal OpenAI-compatible LLM endpoints
- Structural validation, local repair, and an optional single LLM feedback retry for invalid generations
- Static-hosting friendly browser-direct LLM requests, with an optional local proxy for CORS-restricted APIs
- Part-pack switching, currently with a LEGO-compatible LDraw pack and an original Minecraft-style voxel pack
- LDraw-derived visual and structural data for part rendering, collision, and support checks
- Brick-level editing: add, select, move, rotate, recolor, duplicate, delete, import, and export
- Connector validation for studs, tubes, bars, pins, axles, and bidirectional block faces
- Four scene modes: bordered, borderless, structure X-ray, and structural voxels
- Static stability analysis with per-brick risk colors, support hull, center of mass, tipping margin, and connection redundancy
- A bridge-game-style disaster lab with deterministic wind, heavy-rain, and earthquake simulations, failure propagation, playback, and scoring
- Editable per-part inventory limits shared by manual editing and LLM generation
- Built-in asset library with IndexedDB-backed persistence for large user models
- Browser-side OBJ/MTL import with multi-material color mapping, size, brick-budget, edge-style, silhouette, and quality previews
- JSON and LDraw/MPD import plus lossless LDraw export for application round trips
- Build Manual 2.0 with delta-only storage, installation arrows, exploded view, guided camera angles, timeline playback, and Markdown/HTML/JSON export
- Adaptive rendering for large scenes and lazy loading for 3D/OBJ-heavy modules
- Bilingual UI with browser-language defaults and manual language selection

<p align="center">
  <img src="preview/classic-ghost-demo.png" alt="Classic ghost demo preview" width="420">
  <img src="preview/build-manual.png" alt="Build manual preview" width="420">
</p>

## 🧱 Part Packs

- **LEGO-compatible pack:** the main pack today. It uses bundled LDraw data where possible for visuals and structure, with regression checks for official colors, connector positions, collision, support, and default assets
- **Minecraft pack:** an original voxel-first pack with 48 terrain, stone, wood, ore, building, and functional blocks. It includes face textures, opaque/cutout/translucent/emissive layers, slabs, stairs, fences, plants, and face-to-face connectivity. It does not bundle or import Minecraft game assets

### Minecraft-style workflow

- Search the catalog with either localized names or aliases; the selected pack, category, and query persist locally
- Stairs orient from the placement view, slabs distinguish upper and lower halves, and fences connect only toward eligible neighbors
- Plants require a supporting voxel block; removing that support marks the plant as structurally invalid
- The asset library includes five original incremental presets: **Valley Waystation**, **Ore Cutaway**, **Forest Camp**, **Seaside Lighthouse**, and **Village Square**. Loading one preserves the current world and places the preset in nearby free space
- Repeated cube and slab materials are instanced in stable `16 x 16` spatial chunks. Unchanged chunks reuse their instance groups and each chunk participates in frustum culling

## 🚀 Quick Start

```bash
npm install
npm run dev
```

Open the Vite URL printed in the terminal, usually:

```text
http://127.0.0.1:5173/
```

## 🛠️ Build

```bash
npm run build
npm run preview
```

The app can run as a static frontend when LLM requests use browser-direct mode and the configured endpoint allows CORS

## 🧪 Development Scripts

```bash
npm run dev                  # start Vite
npm run build                # type-check and build
npm run lint                 # run ESLint
npm test                     # run focused Vitest regressions
npm run validate:builds      # validate default assets and regression cases
npm run audit:obj-connectivity # require every generated OBJ asset to stay connected
npm run profile:performance  # profile performance-sensitive routines
npm run verify:release       # run the complete release gate
npm run generate:obj         # rebuild OBJ-derived default assets
```

### OBJ to brick assets

The OBJ generator reads `.ignored/objs/stanford-bunny.obj` and `.ignored/objs/armadillo.obj`, then writes `src/data/generatedObjAssets.ts`. Source meshes stay outside Git because of their size and licensing provenance.

```bash
npm run generate:obj
node scripts/generate-obj-assets.mjs --dry-run
node scripts/generate-obj-assets.mjs --dry-run --source=stanford-bunny --profile=m
```

The pipeline uses four-sample solid voxelization, removes isolated mesh noise, adds only minimal bridge/support cells, prunes boundary voxels that cannot be connected, replaces suitable stair-step boundaries with oriented slopes, and tiles each layer with a connectivity-aware brick scorer. Its console metrics include voxel and multi-view silhouette IoU, voxel dimensions, shape modifications, unresolved supports, connected components, slope/brick counts, and odd scan-ray ratio. Default publishing is quality-gated per source; experimental profiles remain available through explicit `--source` and `--profile` arguments.

The same conversion core powers the in-browser **Import OBJ** dialog. Files stay local; the dialog accepts OBJ files up to 100 MB, can read companion MTL files and map their diffuse colors to legal part colors, adapts voxel resolution to a selected brick budget, and shows source/result silhouettes before the plan is loaded. Generated default assets use a compact tuple format and are expanded only when the asset library loads.

## 🌪️ Stability Lab

Structure X-ray provides immediate static feedback. The stability lab then applies time-varying wind, heavy-rain, or earthquake loads, propagates failed connections through the support graph, and scores survival, static stability, span, and material efficiency. See [the stability model](docs/STABILITY_MODEL.md) for formulas, weights, and limitations.

## 🤖 LLM Configuration

Open **Config** in the app and set:

<p align="center">
  <img src="preview/llm-config.png" alt="LLM configuration preview" width="320">
</p>

- API endpoint: an OpenAI-compatible chat completions URL
- API key: stored locally in the browser
- Model name: any model supported by your endpoint
- Request mode: browser direct or local proxy
- Thinking mode: optional, off by default for faster and more predictable generation
- Structural feedback retry: on by default; if deterministic repair still fails, the validator feedback and previous candidate are sent for one corrected retry

## ⌨️ Keyboard Controls

Keyboard controls are ignored while typing in text fields. Brick movement works after a brick is selected, moves in `1/5` stud steps, and repeats while the key is held.

| Key | Action |
| --- | --- |
| `W` / `A` / `S` / `D` | Move the selected brick relative to the current camera view |
| `R` / `F` | Move the selected brick up or down |
| `Q` | Rotate the selected brick horizontally |
| `E` | Rotate the selected brick vertically |
| `Backspace` | Delete the selected brick |
| `Ctrl`/`Cmd` + `Z` | Undo |
| `Ctrl`/`Cmd` + `Shift` + `Z` or `Ctrl`/`Cmd` + `Y` | Redo |
| `Esc` | Close the open config, import, stability lab, prompt preview, asset library, or build manual dialog |
| `←` / `→` | Move to the previous or next build-manual step while the build manual is open |
| `Enter` / `Space` | Select a focused build-manual step card |

## 🧩 Working With Parts

New or corrected parts should be backed by real references:

1. Check the official LDraw `.dat`, subpart, and primitive data
2. Compare against official LEGO imagery or build-manual images when visual shape matters
3. Preserve real part numbers, dimensions, connector semantics, and regression coverage
4. Run `npm run generate:ldraw` and `npm run validate:builds` after changing LDraw-derived data

For non-LEGO packs, prefer explicit structural semantics instead of forcing every system into LEGO stud and tube rules. The Minecraft basic block uses a bidirectional `studsocket` face connector so the block stays solid while still supporting face-to-face attachment

## 🤝 Contributing

Issues and patches are welcome. Useful contribution areas include:

- Improving the agent workflow
- Expanding the part library and correcting part data
- Creating polished demo assets
- Improving import and export format compatibility
- Optimizing performance

Before opening a pull request:

```bash
npm run verify:release
```

The release gate type-checks and builds the app, runs the full regression suite (including structural-voxel fingerprints and static-gravity cases), validates every default asset/manual round trip, audits LDraw coverage, and requires every bundled OBJ model to remain connected.

## 🙏 Acknowledgements

- [LDraw](https://ldraw.org/): open part geometry, primitives, and the community-maintained part library that make the LDraw-backed pack possible
- [Rebrickable](https://rebrickable.com/downloads/): public element and color datasets used to derive coarse official color availability
