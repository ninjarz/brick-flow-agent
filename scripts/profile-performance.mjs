import * as esbuild from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workspace = process.cwd()
const tempDir = await mkdtemp(join(tmpdir(), 'brick-flow-agent-profile-'))
const entry = join(tempDir, 'entry.ts')
const outfile = join(tempDir, 'entry.mjs')

await writeFile(entry, `
  const results: Array<{ name: string; ms: number; detail?: string }> = [];
  const measure = <T>(name: string, fn: () => T): T => {
    const start = performance.now();
    const value = fn();
    const ms = performance.now() - start;
    results.push({ name, ms });
    return value;
  };
  const measureAsync = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    const value = await fn();
    const ms = performance.now() - start;
    results.push({ name, ms });
    return value;
  };

  const imports = await (async () => {
    const start = performance.now();
    const modules = await Promise.all([
      import(${JSON.stringify(`${workspace}/src/data/basicBricks.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/finishedAssets.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/localGenerator.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/planUtils.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/structuralGrid.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/ldrawVisualGeometry.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/manualSerializer.ts`)}),
    ]);
    results.push({ name: 'module import + default asset construction', ms: performance.now() - start });
    return modules;
  })();

  const [{ brickById, brickDefinitions }, finishedAssets, { generateBuildPlan }, planUtils, structuralGrid, ldrawVisualGeometry, manualSerializer] = imports;
  const defaultFinishedAssets = await measureAsync('load all default finished assets', () => finishedAssets.loadAllDefaultFinishedAssets());
  const {
    createBrickCollisionIndex,
    findSupportedOpenPose,
    getBrickRawOverlapScore,
    hasBrickCollision,
    makeBrick,
    snapBrickToPlan,
    validateBuildPlan,
  } = planUtils;
  const {
    getBrickStructuralCells,
    getBrickWorldCollisionKeys,
  } = structuralGrid;
  const { loadLDrawPartGeometry } = ldrawVisualGeometry;
  const { serializeBuildManual } = manualSerializer;

  const initialPlan = measure('generate default plan', () => generateBuildPlan({ prompt: '一个蓝灰色机器人' }));
  measure('validate current default plan', () => validateBuildPlan(initialPlan));
  measure('validate all finished assets', () => {
    for (const asset of defaultFinishedAssets) validateBuildPlan(asset.plan);
  });
  measure('serialize all finished asset manuals', () => {
    for (const asset of defaultFinishedAssets) serializeBuildManual(asset.plan);
  });
  measure('build collision indexes for all finished assets', () => {
    for (const asset of defaultFinishedAssets) createBrickCollisionIndex(asset.plan.bricks);
  });

  const curvedDefinition = brickById.get('curved-slope-1x2')!;
  measure('6091 structural cells x100', () => {
    for (let index = 0; index < 100; index += 1) getBrickStructuralCells(curvedDefinition);
  });
  measure('6091 world collision keys x100 poses', () => {
    for (let index = 0; index < 100; index += 1) {
      getBrickWorldCollisionKeys(makeBrick('curved-slope-1x2', 'white', index % 8, Math.floor(index / 8) * 0.2, 0));
    }
  });
  await measureAsync('6091 LDraw geometry load/create x100', async () => {
    for (let index = 0; index < 100; index += 1) await loadLDrawPartGeometry(curvedDefinition.partNumber, curvedDefinition.footprint);
  });

  const largestAsset = defaultFinishedAssets.reduce((largest, asset) =>
    asset.plan.bricks.length > largest.plan.bricks.length ? asset : largest
  );
  measure('add 6091 search on largest finished asset x20', () => {
    for (let index = 0; index < 20; index += 1) {
      const brick = makeBrick('curved-slope-1x2', 'white', 0, 0, 0);
      findSupportedOpenPose(snapBrickToPlan(brick, largestAsset.plan.bricks), largestAsset.plan.bricks);
    }
  });
  measure('manual add 6091 fast search on largest finished asset x20', () => {
    for (let index = 0; index < 20; index += 1) {
      const brick = makeBrick('curved-slope-1x2', 'white', 0, 0, 0);
      findSupportedOpenPose(snapBrickToPlan(brick, largestAsset.plan.bricks), largestAsset.plan.bricks, { allowGroundFallback: true, preferGroundFallback: true });
    }
  });
  measure('single moved-brick collision checks on largest asset x200', () => {
    const collisionIndex = createBrickCollisionIndex(largestAsset.plan.bricks);
    for (let index = 0; index < 200; index += 1) {
      const source = largestAsset.plan.bricks[index % largestAsset.plan.bricks.length];
      const moved = {
        ...source,
        pose: {
          ...source.pose,
          xStud: source.pose.xStud + 0.2,
        },
      };
      hasBrickCollision(moved, largestAsset.plan.bricks, collisionIndex);
      getBrickRawOverlapScore(moved, largestAsset.plan.bricks, collisionIndex);
    }
  });
  measure('part definitions scan x1000', () => {
    for (let index = 0; index < 1000; index += 1) {
      brickDefinitions.filter((brick) => brick.name.toLowerCase().includes('slope'));
    }
  });

  const max = Math.max(...results.map((result) => result.ms));
  const table = results.map((result) => ({
    stage: result.name,
    ms: Number(result.ms.toFixed(2)),
    relative: Number((result.ms / max).toFixed(3)),
  }));
  console.table(table);
`)

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent',
})

await import(outfile)
