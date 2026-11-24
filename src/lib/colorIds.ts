import { brickDefinitions } from '../data/basicBricks'
import { hogwartsExactColors } from '../data/hogwartsExactColors'
import type { BrickColor } from '../types/bricks'

const toId = (value: string) => value.trim().toLowerCase()
  .replace(/[\s_]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/grey/g, 'gray')
  .replace(/^transparent-/, 'trans-')

/**
 * LDraw material codes (lego-N) that duplicate a named id. The catalogue lists
 * many colours only under their LDraw code (brick-1x3 has lego-70, not
 * reddish-brown), so generation reads and writes the named id and each part
 * resolves it to the code it actually carries. Dark and light bluish grey take
 * the place of the old greys, which few parts carry under their own ids.
 */
const extraCanonical: Record<string, string> = { 'lego-72': 'dark-gray', 'lego-71': 'light-gray' }

let tables: { known: Set<string>; canonical: Map<string, string>; byName: Map<string, string> } | undefined
const getTables = () => {
  if (tables) return tables
  const known = new Set<string>(brickDefinitions.flatMap((definition) => definition.colors))
  const canonical = new Map<string, string>(Object.entries(extraCanonical))
  const byName = new Map<string, string>()
  for (const [id, { name }] of Object.entries(hogwartsExactColors)) {
    const named = toId(name)
    byName.set(named, id)
    if (!canonical.has(id) && named !== id && known.has(named) && !named.startsWith('lego-')) canonical.set(id, named)
  }
  tables = { known, canonical, byName }
  return tables
}

/**
 * Maps the loose spellings models produce (dark_gray, "Dark Grey",
 * transparent-yellow, "Dark Bluish Gray") to a legal colour id. Returns
 * undefined when no legal colour matches, so callers can report or drop it.
 */
export const resolveColorId = (value: unknown): BrickColor | undefined => {
  if (typeof value !== 'string') return undefined
  const { known, byName } = getTables()
  if (known.has(value)) return value as BrickColor
  const id = toId(value)
  if (known.has(id)) return id as BrickColor
  const coded = byName.get(id)
  return coded && known.has(coded) ? coded as BrickColor : undefined
}

/** The readable id generation uses for a colour (lego-70 becomes reddish-brown). */
export const canonicalColorId = (color: string) => getTables().canonical.get(color) ?? color

/** Colours listed once each in their readable form. */
export const canonicalColorIds = (colors: Iterable<string>) => [...new Set([...colors].map(canonicalColorId))]

/** The id a specific part carries for a colour, accepting equivalent spellings and codes. */
export const resolvePartColor = (partColors: readonly string[], value: unknown): BrickColor | undefined => {
  const id = resolveColorId(value)
  if (!id) return undefined
  if (partColors.includes(id)) return id
  const wanted = canonicalColorId(id)
  return partColors.find((color) => canonicalColorId(color) === wanted) as BrickColor | undefined
}

/** The legal id when it can be resolved, otherwise the original value for validation to report. */
export const normalizeColorId = (value: unknown): unknown => resolveColorId(value) ?? value

/** Display names for LDraw codes that have no readable id. */
export const describeCodedColors = (colors: Iterable<string>) => {
  const names = hogwartsExactColors as Record<string, { name: string }>
  return [...new Set(colors)].flatMap((color) => names[color] && canonicalColorId(color) === color
    ? [`${color} ${names[color].name.toLowerCase()}`]
    : [])
}
