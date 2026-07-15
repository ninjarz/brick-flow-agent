import * as esbuild from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workspace = process.cwd()
const tempDir = await mkdtemp(join(tmpdir(), 'brick-flow-agent-obj-connectivity-'))
const entry = join(tempDir, 'entry.ts')
const outfile = join(tempDir, 'entry.mjs')

await writeFile(entry, `
  import { loadAllDefaultFinishedAssets } from ${JSON.stringify(`${workspace}/src/lib/finishedAssets.ts`)};
  import { getBrickBounds, getConnectedBrickComponents } from ${JSON.stringify(`${workspace}/src/lib/planUtils.ts`)};

  const distanceBetweenBounds = (source, target) => {
    const axisGap = (sourceMin, sourceMax, targetMin, targetMax) =>
      Math.max(0, sourceMin - targetMax, targetMin - sourceMax);
    const x = axisGap(source.minX, source.maxX, target.minX, target.maxX);
    const y = axisGap(source.minY, source.maxY, target.minY, target.maxY);
    const z = axisGap(source.minZ, source.maxZ, target.minZ, target.maxZ);
    return Math.sqrt(x * x + y * y + z * z);
  };

  const summarizeBounds = (bricks) => bricks.reduce((bounds, brick) => {
    const next = getBrickBounds(brick);
    if (!next) return bounds;
    return {
      minX: Math.min(bounds.minX, next.minX),
      maxX: Math.max(bounds.maxX, next.maxX),
      minY: Math.min(bounds.minY, next.minY),
      maxY: Math.max(bounds.maxY, next.maxY),
      minZ: Math.min(bounds.minZ, next.minZ),
      maxZ: Math.max(bounds.maxZ, next.maxZ),
    };
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });

  const assets = (await loadAllDefaultFinishedAssets()).filter((asset) => asset.category === 'OBJ');
  let disconnectedAssets = 0;
  for (const asset of assets) {
    const components = getConnectedBrickComponents(asset.plan.bricks)
      .sort((source, target) => target.length - source.length);
    const main = components[0] ?? [];
    const mainBoundsByBrick = main.map((brick) => ({ brick, bounds: getBrickBounds(brick) })).filter((item) => item.bounds);
    const details = components.map((component, index) => {
      let nearest;
      if (index > 0) {
        for (const brick of component) {
          const bounds = getBrickBounds(brick);
          if (!bounds) continue;
          for (const target of mainBoundsByBrick) {
            const distance = distanceBetweenBounds(bounds, target.bounds);
            if (!nearest || distance < nearest.distance) {
              nearest = { distance, brick, target: target.brick };
            }
          }
        }
      }
      return {
        index,
        pieces: component.length,
        bounds: summarizeBounds(component),
        nearestToMain: nearest ? {
          distance: Number(nearest.distance.toFixed(3)),
          source: { id: nearest.brick.id, brickId: nearest.brick.brickId, pose: nearest.brick.pose },
          target: { id: nearest.target.id, brickId: nearest.target.brickId, pose: nearest.target.pose },
        } : undefined,
      };
    });
    console.log(JSON.stringify({ assetId: asset.id, pieces: asset.plan.bricks.length, componentCount: components.length, components: details }));
    if (components.length > 1) disconnectedAssets += 1;
  }
  if (disconnectedAssets > 0) throw new Error('Found disconnected OBJ assets');
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
