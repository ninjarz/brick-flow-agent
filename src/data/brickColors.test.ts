import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { brickById, brickDefinitions, colorHex, colorOpacity, getDefaultBrickColor } from './basicBricks'
import { formatLDrawPlan, parseLDrawPlan } from '../lib/ldrawPlan'
import { migrateLegacyTransparentColors, normalizeImportedPlan } from '../lib/planImport'
import { parseImportedPlan } from '../lib/planFileIO'
import { serializeBuildManual } from '../lib/manualSerializer'
import { makeBrick } from '../lib/planUtils'
import type { BrickColor, BuildPlan } from '../types/bricks'

const transparentColors = Object.keys(colorHex).filter((color) => color.startsWith('trans-')) as BrickColor[]
const planFor = (color: BrickColor): BuildPlan => ({
  id: 'transparent-colors', title: 'Transparent colors', prompt: '', source: 'template-local',
  bricks: [makeBrick('brick-trans-1x2', color, 0, 0, 0)], steps: [],
})

describe('transparent part colors', () => {
  it('retains transparency in the official 3065 palette and defaults to clear', () => {
    const definition = brickById.get('brick-trans-1x2')!
    expect(definition.colors).toEqual(expect.arrayContaining(transparentColors))
    expect(definition.colors.every((color) => colorOpacity[color] < 1)).toBe(true)
    expect(getDefaultBrickColor(definition)).toBe('trans-clear')
    for (const brick of brickDefinitions) {
      expect(brick.colors.every((color) => colorHex[color] && Number.isFinite(colorOpacity[color]))).toBe(true)
    }
  })

  it.each(transparentColors)('exports %s using an LDraw color with ALPHA and imports it without app metadata', (color) => {
    const ldraw = formatLDrawPlan(planFor(color))
    const reference = ldraw.split('\n').find((line) => line.startsWith('1 '))!
    const code = reference.split(/\s+/)[1]
    const config = readFileSync(new URL('../../public/ldraw/LDConfig.ldr', import.meta.url), 'utf8')
    const definition = config.split('\n').find((line) => new RegExp(`CODE\\s+${code}\\s`).test(line))
    expect(definition).toMatch(/ALPHA\s+128/)
    const plainLDraw = ldraw.split('\n').filter((line) => !line.startsWith('0 !BRICK_FLOW_AGENT_PLAN')).join('\n')
    const imported = parseLDrawPlan(plainLDraw)
    expect(imported?.usedEmbeddedPlan).toBe(false)
    expect(imported?.unsupportedColorCodes).toEqual([])
    expect(imported?.plan.bricks[0].color).toBe(color)
  })

  it('migrates old transparent-brick colors while preserving opaque bricks and poses', () => {
    const legacy = planFor('green')
    legacy.bricks.push(makeBrick('brick-1x2', 'green', 3, 0, 0))
    const normalized = normalizeImportedPlan(legacy)
    expect(normalized.bricks.map((brick) => brick.color)).toEqual(['trans-green', 'green'])
    expect(normalized.bricks[0].pose).toEqual(legacy.bricks[0].pose)
    expect(normalizeImportedPlan(normalized)).toEqual(normalized)
  })

  it('migrates stored projects and delta manuals without changing unrelated plans', () => {
    const legacy = planFor('green')
    const migrated = migrateLegacyTransparentColors(legacy)
    expect(migrated.bricks[0].color).toBe('trans-green')
    expect(migrateLegacyTransparentColors(migrated)).toBe(migrated)
    const unrelated = { ...legacy, bricks: [makeBrick('brick-1x2', 'green', 0, 0, 0)] }
    expect(migrateLegacyTransparentColors(unrelated)).toBe(unrelated)
    expect(parseImportedPlan(serializeBuildManual(legacy))?.bricks[0].color).toBe('trans-green')
  })

})
