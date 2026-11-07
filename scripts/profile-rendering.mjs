import { build } from 'esbuild'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const outfile = join(await mkdtemp(join(tmpdir(), 'brick-render-profile-')), 'profile.mjs')
await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import plan from './src/data/legoHogwartsPlan.json';
    import { preparePlanGeometry } from './src/lib/planGeometry';
    import { buildLDrawSceneBatches, createLDrawBatchMesh } from './src/lib/ldrawSceneBatches';
    import { createLDrawPrintBatchMesh } from './src/lib/ldrawPrintBatches';
    import { Raycaster, Vector3 } from 'three';
    const results = [];
    const measure = (name, fn) => { const start = performance.now(); const value = fn(); results.push({ name, ms: +(performance.now() - start).toFixed(2) }); return value; };
    await preparePlanGeometry(plan);
    const options = { highlightedIds: new Set(), excludedIds: new Set(), supportedByBrickId: new Map(), showEdges: true };
    const initial = measure('cold scene batches', () => buildLDrawSceneBatches(plan.bricks, options));
    const printed = initial.printSources[0].instances[0].brick;
    const selected = measure('select printed piece', () => buildLDrawSceneBatches(plan.bricks, { ...options, selectedId: printed.id }, initial));
    if (!selected.printBatches.every(batch => initial.printBatches.includes(batch))) throw Error('Selection rebuilt artwork');
    measure('deselect printed piece', () => buildLDrawSceneBatches(plan.bricks, options, selected));
    const bodies = measure('create body meshes', () => initial.meshBatches.map(createLDrawBatchMesh));
    const prints = measure('create artwork meshes', () => initial.printBatches.map(createLDrawPrintBatchMesh));
    bodies.forEach(mesh => mesh.updateMatrixWorld()); prints.forEach(mesh => mesh.updateMatrixWorld());
    const ray = new Raycaster(new Vector3(30, 100, 100), new Vector3(-.1, -1, -1).normalize());
    measure('body picking x50', () => { for(let i=0;i<50;i++) ray.intersectObjects(bodies); });
    measure('artwork picking x50', () => { for(let i=0;i<50;i++) ray.intersectObjects(prints); });
    console.table(results);
    console.log(JSON.stringify({ pieces: plan.bricks.length, bodyBatches: bodies.length, printChunks: prints.length, results }));
  ` },
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent',
})
await import(outfile)
