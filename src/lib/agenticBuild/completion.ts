import type { PlacedBrick } from '../../types/bricks'
import { getBrickBounds } from '../planUtils'

const sides = ['front', 'back', 'left', 'right'] as const
type Side = typeof sides[number]
type Opening = { side: Side; offset: number; width: number; bottom: number; courses: number }
type Footprint = { x: number; y: number; z: number; width: number; depth: number }
export type RoofRecipe = { style: 'flat'; color: string } | {
  style: 'gable'; color: string; ridge: 'x' | 'z'; gableColor?: string; supportDeck?: boolean
}
export type ComponentCompletion = Footprint & (
  { kind: 'walls'; courses: number; openings: Opening[] } | { kind: 'roof'; recipe?: RoofRecipe }
)

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
const isColor = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= 64

// The recipe is advisory. Preserve the required footprint for model-driven
// placement whenever the optional recipe cannot describe it.
const parseRoofRecipe = (value: unknown, width: number, depth: number): RoofRecipe | undefined => {
  if (!record(value) || !isColor(value.color)) return undefined
  if (value.style === 'flat') return { style: 'flat', color: value.color }
  if (value.style !== 'gable' || (value.ridge !== 'x' && value.ridge !== 'z')) return undefined
  const span = value.ridge === 'x' ? depth : width
  if (span < 4 || span % 2 || Math.min(width, depth) < 2) return undefined
  return {
    style: 'gable', color: value.color, ridge: value.ridge,
    ...(isColor(value.gableColor) ? { gableColor: value.gableColor } : {}),
    ...(value.supportDeck === true ? { supportDeck: true } : {}),
  }
}

export const parseComponentCompletion = (value: unknown, name: string): ComponentCompletion | undefined => {
  if (value === undefined) return undefined
  if (!record(value) || (value.kind !== 'walls' && value.kind !== 'roof')) throw new Error(`Component "${name}" needs a walls or roof completion target.`)
  const { kind, x, y, z, width, depth } = value
  if (!integer(x, 0, 40) || !integer(z, 0, 40) || !integer(width, kind === 'walls' ? 3 : 1, 32)
      || !integer(depth, kind === 'walls' ? 3 : 1, 32) || x + width > 40 || z + depth > 40
      || typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 64) {
    throw new Error(`Component "${name}" has an invalid completion footprint or elevation.`)
  }
  if (kind === 'roof') {
    const recipe = parseRoofRecipe(value.recipe, width, depth)
    return { kind, x, y, z, width, depth, ...(recipe ? { recipe } : {}) }
  }

  const { courses } = value
  if (!integer(courses, 1, 20) || (value.openings !== undefined && !Array.isArray(value.openings))) {
    throw new Error(`Component "${name}" needs 1–20 wall courses and an optional openings array.`)
  }
  const openings: Opening[] = []
  for (const opening of Array.isArray(value.openings) ? value.openings : []) {
    if (!record(opening) || !sides.some(side => side === opening.side)) throw new Error(`Component "${name}" has an invalid wall opening side.`)
    const { offset, width: openingWidth, bottom, courses: height } = opening
    const side = opening.side as Side
    const length = side === 'front' || side === 'back' ? width : depth
    if (!integer(offset, 1, length - 2) || !integer(openingWidth, 1, length - offset - 1)
        || !integer(bottom, 0, courses - 1) || !integer(height, 1, courses - bottom)) {
      throw new Error(`Component "${name}" has a wall opening outside its course or corner limits.`)
    }
    openings.push({ side, offset, width: openingWidth, bottom, courses: height })
  }
  return { kind, x, y, z, width, depth, courses, openings }
}

export const getComponentCompletionIssue = (target: ComponentCompletion, bricks: PlacedBrick[], ids: ReadonlySet<string>) => {
  const bounds = bricks.flatMap(brick => {
    const box = ids.has(brick.id) && getBrickBounds(brick)
    return box ? [box] : []
  })
  const occupied = (x: number, z: number, y?: number) => bounds.some(box =>
    box.minX < x && box.maxX > x && box.minZ < z && box.maxZ > z &&
    (y === undefined ? box.maxY > target.y + 0.1 : box.minY < y && box.maxY > y))
  let missing = 0
  if (target.kind === 'roof') {
    const spans: string[] = []
    let totalSpans = 0
    const endX = target.x + target.width
    for (let z = target.z; z < target.z + target.depth; z++) {
      let startX: number | undefined
      for (let x = target.x; x <= endX; x++) {
        if (x < endX && !occupied(x + 0.5, z + 0.5)) {
          missing++
          startX ??= x
        } else if (startX !== undefined) {
          totalSpans++
          if (spans.length < 16) spans.push(`z=${z}: x=${startX}${startX === x - 1 ? '' : `–${x - 1}`}`)
          startX = undefined
        }
      }
    }
    if (!missing) return undefined
    const remaining = totalSpans - spans.length
    return `Roof coverage is missing ${missing} stud cells. Missing rows (inclusive): ${spans.join('; ')}${remaining ? `; ${remaining} more spans` : ''}. Fill these gaps with supported roof pieces extending above y=${target.y}.`
  }

  let first = ''
  for (const side of sides) {
    const alongX = side === 'front' || side === 'back'
    const length = alongX ? target.width : target.depth
    for (let course = 0; course < target.courses; course++) for (let offset = 0; offset < length; offset++) {
      if (target.openings.some(opening => opening.side === side && offset >= opening.offset && offset < opening.offset + opening.width
        && course >= opening.bottom && course < opening.bottom + opening.courses)) continue
      const x = target.x + (alongX ? offset : side === 'left' ? 0 : target.width - 1)
      const z = target.z + (!alongX ? offset : side === 'front' ? 0 : target.depth - 1)
      if (occupied(x + 0.5, z + 0.5, target.y + (course + 0.5) * 1.2)) continue
      if (missing++ === 0) first = `${side} offset ${offset}, course ${course + 1}`
    }
  }
  return missing ? `Walls are missing ${missing} required stud-course cells, starting at ${first}. Fill them before finishing the component.` : undefined
}
