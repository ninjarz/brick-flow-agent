import * as esbuild from 'esbuild'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workspace = process.cwd()
const tempDir = await mkdtemp(join(tmpdir(), 'brick-flow-agent-ldraw-audit-'))
const entry = join(tempDir, 'entry.ts')
const outfile = join(tempDir, 'entry.mjs')
const showDetails = process.argv.includes('--details')

await writeFile(entry, `
  import { brickDefinitions } from ${JSON.stringify(`${workspace}/src/data/basicBricks.ts`)};
  import { getLDrawGeneratedConnectors } from ${JSON.stringify(`${workspace}/src/lib/ldrawGeneratedConnectors.ts`)};
  import { getLDrawGeneratedVisualTriangles } from ${JSON.stringify(`${workspace}/src/lib/ldrawGeneratedVisual.ts`)};
  import { normalizeLDrawPartNumber } from ${JSON.stringify(`${workspace}/src/lib/ldrawPartNumbers.ts`)};

  export const auditInput = brickDefinitions.filter((definition) => definition.pack === 'lego').map((definition) => {
    const normalizedPartNumber = normalizeLDrawPartNumber(definition.partNumber);
    const generatedTriangles = getLDrawGeneratedVisualTriangles(normalizedPartNumber);
    const generatedConnectors = getLDrawGeneratedConnectors(normalizedPartNumber, definition.id);

    return {
      id: definition.id,
      partNumber: definition.partNumber,
      normalizedPartNumber,
      name: definition.name,
      hasGeneratedVisual: Boolean(generatedTriangles),
      generatedTriangles: generatedTriangles?.length ?? 0,
      hasGeneratedConnectors: Boolean(generatedConnectors?.length),
      generatedConnectors: generatedConnectors?.length ?? 0,
    };
  });
`)

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
})

const { auditInput } = await import(`file://${outfile}`)
const withFile = []
const withGeneratedVisual = []
const withGeneratedConnectors = []
const missingFile = []

for (const item of auditInput) {
  if (item.hasGeneratedVisual) {
    withGeneratedVisual.push(item)
  }

  if (item.hasGeneratedConnectors) {
    withGeneratedConnectors.push(item)
  }

  try {
    await access(join(workspace, 'public/ldraw/parts', `${item.normalizedPartNumber}.dat`), constants.R_OK)
    withFile.push(item)
  } catch {
    missingFile.push(item)
  }
}

const summary = {
  totalDefinitions: auditInput.length,
  withGeneratedVisual: withGeneratedVisual.length,
  withGeneratedConnectors: withGeneratedConnectors.length,
  withLocalDatFile: withFile.length,
  missingLocalDatFile: missingFile.length,
}

const details = {
  generatedVisualParts: withGeneratedVisual,
  generatedConnectorParts: withGeneratedConnectors,
  localDatParts: withFile,
  missingDatParts: missingFile,
}

const compactPart = (item) => ({
  id: item.id,
  partNumber: item.partNumber,
  normalizedPartNumber: item.normalizedPartNumber,
  name: item.name,
})

console.log(JSON.stringify(showDetails ? { ...summary, ...details } : {
  ...summary,
  missingDatParts: missingFile.map(compactPart),
  missingGeneratedVisualParts: auditInput.filter((item) => !item.hasGeneratedVisual).map(compactPart),
  missingGeneratedConnectorParts: auditInput.filter((item) => !item.hasGeneratedConnectors).map(compactPart),
}, null, 2))
