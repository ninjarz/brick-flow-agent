import * as esbuild from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workspace = process.cwd()
const enforceBudgets = process.argv.includes('--check')
const tempDir = await mkdtemp(join(tmpdir(), 'brick-flow-agent-profile-'))
const entry = join(tempDir, 'entry.ts')
const outfile = join(tempDir, 'entry.mjs')

await writeFile(entry, `
  const enforceBudgets = ${JSON.stringify(enforceBudgets)};
  const results: Array<{ name: string; ms: number; detail?: string }> = [];
  const measure = <T>(name: string, fn: () => T): T => {
    const start = performance.now();
    const value = fn();
    const ms = performance.now() - start;
    results.push({ name, ms });
    console.log(name + ': ' + ms.toFixed(2) + ' ms');
    return value;
  };
  const measureAsync = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    const value = await fn();
    const ms = performance.now() - start;
    results.push({ name, ms });
    console.log(name + ': ' + ms.toFixed(2) + ' ms');
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
      import(${JSON.stringify(`${workspace}/src/lib/stabilityAnalysis.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/disasterSimulation.ts`)}),
      import(${JSON.stringify(`${workspace}/src/data/worldEntityDefinitions.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/worldEntity.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/worldSimulation.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/voxelChunking.ts`)}),
      import(${JSON.stringify(`${workspace}/src/lib/worldAi.ts`)}),
    ]);
    const ms = performance.now() - start;
    results.push({ name: 'module import + default asset construction', ms });
    console.log('module import + default asset construction: ' + ms.toFixed(2) + ' ms');
    return modules;
  })();

  const [{ brickById, brickDefinitions }, finishedAssets, { generateBuildPlan }, planUtils, structuralGrid, ldrawVisualGeometry, manualSerializer, stabilityAnalysis, disasterSimulation, worldEntityDefinitions, worldEntity, worldSimulation, voxelChunking, worldAi] = imports;
  const defaultFinishedAssets = await measureAsync('load all default finished assets', () => finishedAssets.loadAllDefaultFinishedAssets());
  const largestAsset = defaultFinishedAssets.reduce((largest, asset) =>
    asset.plan.bricks.length > largest.plan.bricks.length ? asset : largest
  );
  const {
    createBrickCollisionIndex,
    createPlanSpatialState,
    findSupportedOpenPose,
    getBrickRawOverlapScore,
    hasBrickCollision,
    isBrickSupported,
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
  measure('build collision index for largest finished asset', () =>
    createBrickCollisionIndex(largestAsset.plan.bricks)
  );
  measure('analyze stability for largest finished asset', () =>
    stabilityAnalysis.analyzeBuildStability(largestAsset.plan.bricks)
  );
  measure('simulate challenge wind for largest finished asset', () =>
    disasterSimulation.runDisasterSimulation(largestAsset.plan.bricks, { scenario: 'wind', intensity: 70, physicsProfile: 'challenge' })
  );
  measure('simulate realistic wind for largest finished asset', () =>
    disasterSimulation.runDisasterSimulation(largestAsset.plan.bricks, { scenario: 'wind', intensity: 70, physicsProfile: 'realistic' })
  );
  measure('simulate challenge rain for largest finished asset', () =>
    disasterSimulation.runDisasterSimulation(largestAsset.plan.bricks, { scenario: 'rain', intensity: 70, physicsProfile: 'challenge' })
  );
  measure('simulate realistic rain for largest finished asset', () =>
    disasterSimulation.runDisasterSimulation(largestAsset.plan.bricks, { scenario: 'rain', intensity: 70, physicsProfile: 'realistic' })
  );
  measure('simulate challenge earthquake for largest finished asset', () =>
    disasterSimulation.runDisasterSimulation(largestAsset.plan.bricks, { scenario: 'earthquake', intensity: 70, physicsProfile: 'challenge' })
  );
  measure('simulate realistic earthquake for largest finished asset', () =>
    disasterSimulation.runDisasterSimulation(largestAsset.plan.bricks, { scenario: 'earthquake', intensity: 70, physicsProfile: 'realistic' })
  );

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

  console.log('largest finished asset: ' + largestAsset.id + ' (' + largestAsset.plan.bricks.length + ' bricks)');
  const searchBrick = makeBrick('curved-slope-1x2', 'white', 0, 0, 0);
  const largestSpatialState = measure('create spatial state for largest finished asset', () =>
    createPlanSpatialState(largestAsset.plan.bricks)
  );
  const snappedSearchBrick = measure('snap 6091 on largest finished asset', () =>
    snapBrickToPlan(searchBrick, largestAsset.plan.bricks, { spatialState: largestSpatialState })
  );
  const largestSpatialCollisionIndex = measure('build cached spatial collision index for largest finished asset', () =>
    largestSpatialState.collisionIndex
  );
  measure('check snapped 6091 collision on largest finished asset', () =>
    hasBrickCollision(snappedSearchBrick, largestAsset.plan.bricks, largestSpatialCollisionIndex)
  );
  measure('check snapped 6091 support on largest finished asset', () =>
    isBrickSupported(snappedSearchBrick, largestAsset.plan.bricks, largestSpatialCollisionIndex)
  );
  measure('place 6091 on largest finished asset', () =>
    findSupportedOpenPose(snappedSearchBrick, largestAsset.plan.bricks)
  );
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
  const makeVoxelBenchmarkPlan = (brickCount: number) => ({
    id: 'voxel-benchmark-' + brickCount,
    title: 'Voxel benchmark ' + brickCount,
    prompt: '',
    source: 'template-local' as const,
    bricks: Array.from({ length: brickCount }, (_, index) => makeBrick(
      'minecraft-stone-block',
      'gray',
      index % 50,
      Math.floor(index / 2500),
      Math.floor(index / 50) % 50,
    )),
    steps: [],
  });
  for (const brickCount of [100, 500, 1500]) {
    const benchmarkPlan = makeVoxelBenchmarkPlan(brickCount);
    measure('validate ' + brickCount + ' voxel blocks', () => validateBuildPlan(benchmarkPlan));
    measure('index ' + brickCount + ' voxel blocks', () => createPlanSpatialState(benchmarkPlan.bricks));
  }

  const simulateNpcScenario = (entityCount: number) => {
    const knight = worldEntityDefinitions.worldEntityDefinitionById.get('knight')!;
    let world = {
      ...worldEntity.createEmptyWorldState('performance-profile'),
      entities: Array.from({ length: entityCount }, (_, index) => worldEntity.createWorldEntity(knight, {
        id: 'profile-npc-' + index,
        factionId: index % 2 === 0 ? 'blue' : 'red',
        transform: {
          x: (index % 10) * 2.5 - 11.25,
          z: Math.floor(index / 10) * 2.5 - Math.floor(entityCount / 20) * 2.5,
        },
      })),
    };
    for (let step = 0; step < 100; step += 1) {
      world = worldSimulation.stepWorldSimulation(world, largestAsset.plan.bricks, 0.1, largestAsset.plan.structures ?? []);
    }
    return world;
  };
  for (const entityCount of [10, 30, 60]) {
    measure('simulate ' + entityCount + ' NPCs for 100 world steps', () => simulateNpcScenario(entityCount));
  }
  const makeAiSnapshotWorld = (entityCount: number) => ({
    ...worldEntity.createEmptyWorldState('ai-snapshot-profile'),
    entities: Array.from({ length: entityCount }, (_, index) => worldEntity.createWorldEntity(
      worldEntityDefinitions.worldEntityDefinitionById.get('knight')!,
      {
        id: 'snapshot-npc-' + index,
        controller: index === 0 ? 'player' as const : 'ai' as const,
        factionId: index % 2 === 0 ? 'blue' : 'red',
        transform: { x: (index % 10) * 4, z: Math.floor(index / 10) * 4 },
      },
    )),
  });
  const aiSnapshotWorld = makeAiSnapshotWorld(60);
  const aiSnapshotBricks = makeVoxelBenchmarkPlan(1500).bricks;
  measure('create AI snapshot for 60 NPCs and 1500 bricks x10', () => {
    for (let index = 0; index < 10; index += 1) {
      worldAi.createWorldAiSnapshot(aiSnapshotWorld, aiSnapshotBricks);
    }
  });
  measure('part definitions scan x1000', () => {
    for (let index = 0; index < 1000; index += 1) {
      brickDefinitions.filter((brick) => brick.name.toLowerCase().includes('slope'));
    }
  });
  const { synchronizeVoxelBlockStates } = await import(${JSON.stringify(`${workspace}/src/lib/voxelBlockState.ts`)});
  const fencePlan = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), brickId: 'minecraft-oak-fence', color: 'brown' as const,
    pose: { xStud: i % 100, yStud: 0, zStud: Math.floor(i / 100), rotationQuarterTurns: 0 as const } }));
  measure('synchronize 10,000 fences', () => synchronizeVoxelBlockStates(fencePlan));
  measure('clone 1500 bricks and 60 NPCs x100', () => {
    for (let i = 0; i < 100; i++) structuredClone({ world: aiSnapshotWorld, plan: { bricks: aiSnapshotBricks } });
  });
  measure('clone 60 NPCs without unchanged plan x100', () => {
    for (let i = 0; i < 100; i++) structuredClone({ world: aiSnapshotWorld });
  });
  measure('partition 10,000 voxel blocks into render chunks', () => {
    const blocks = Array.from({ length: 10_000 }, (_, index) => ({
      x: index % 100,
      z: Math.floor(index / 100),
    }));
    voxelChunking.partitionVoxelItemsByChunk(blocks, (block) => block);
  });

  const max = Math.max(...results.map((result) => result.ms));
  const table = results.map((result) => ({
    stage: result.name,
    ms: Number(result.ms.toFixed(2)),
    relative: Number((result.ms / max).toFixed(3)),
  }));
  console.table(table);
  if (enforceBudgets) {
    const budgets = new Map([
      ['validate 1500 voxel blocks', 180],
      ['index 1500 voxel blocks', 40],
      ['simulate 60 NPCs for 100 world steps', 1800],
      ['create AI snapshot for 60 NPCs and 1500 bricks x10', 150],
      ['partition 10,000 voxel blocks into render chunks', 80],
      ['synchronize 10,000 fences', 300],
    ]);
    const failures = results.flatMap((result) => {
      const budget = budgets.get(result.name);
      return budget !== undefined && result.ms > budget
        ? [result.name + ': ' + result.ms.toFixed(2) + ' ms > ' + budget + ' ms']
        : [];
    });
    if (failures.length) throw new Error('Performance budget exceeded:\\n' + failures.join('\\n'));
    console.log('performance budgets: passed');
  }
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
