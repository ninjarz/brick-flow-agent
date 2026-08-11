import type { BrickColor, BrickConnector, BrickDefinition, VoxelBlockVisual } from '../types/bricks'
import { getLDrawConnectors } from '../lib/ldrawPartRegistry'
import { legoPlateFootprint, plateHeightToWorldStud } from '../lib/brickUnits'
import { getOfficialPartColors } from './officialPartColors'

const makeStudGrid = (
  prefix: string,
  widthStuds: number,
  depthStuds: number,
  heightPlates: number,
): BrickConnector[] =>
  Array.from({ length: widthStuds }).flatMap((_, xStud) =>
    Array.from({ length: depthStuds }).map((__, zStud) => ({
      id: `${prefix}-stud-${xStud}-${zStud}`,
      kind: 'stud',
      gender: 'male',
      axis: 'y',
      direction: { x: 0, y: 1, z: 0 },
      pose: { xStud, yStud: plateHeightToWorldStud(heightPlates), zStud },
    })),
  )

const makeTubeGrid = (
  prefix: string,
  widthStuds: number,
  depthStuds: number,
  heightPlates: number,
): BrickConnector[] =>
  Array.from({ length: widthStuds }).flatMap((_, xStud) =>
    Array.from({ length: depthStuds }).map((__, zStud) => ({
      id: `${prefix}-tube-${xStud}-${zStud}`,
      kind: 'tube',
      gender: 'female',
      axis: 'y',
      direction: { x: 0, y: -1, z: 0 },
      pose: { xStud, yStud: plateHeightToWorldStud(heightPlates), zStud },
    })),
  )

const makeTubeConnector = (
  prefix: string,
  xStud: number,
  yStud: number,
  zStud: number,
): BrickConnector => ({
  id: `${prefix}-tube-${xStud}-${yStud}-${zStud}`,
  kind: 'tube',
  gender: 'female',
  axis: 'y',
  direction: { x: 0, y: -1, z: 0 },
  pose: { xStud, yStud, zStud },
})

const makeStudRow = (
  prefix: string,
  widthStuds: number,
  zStud: number,
  heightPlates: number,
): BrickConnector[] =>
  Array.from({ length: widthStuds }).map((_, xStud) => ({
    id: `${prefix}-stud-${xStud}-${zStud}`,
    kind: 'stud',
    gender: 'male',
    axis: 'y',
    direction: { x: 0, y: 1, z: 0 },
    pose: { xStud, yStud: plateHeightToWorldStud(heightPlates), zStud },
  }))

const makeCenterStud = (
  prefix: string,
  widthStuds: number,
  depthStuds: number,
  heightPlates: number,
): BrickConnector => ({
  id: `${prefix}-stud-center`,
  kind: 'stud',
  gender: 'male',
  axis: 'y',
  direction: { x: 0, y: 1, z: 0 },
  pose: { xStud: widthStuds / 2 - 0.5, yStud: plateHeightToWorldStud(heightPlates), zStud: depthStuds / 2 - 0.5 },
})

const makeSideStud = (
  prefix: string,
  xStud: number,
  heightPlates: number,
  zStud: number,
  axis: BrickConnector['axis'] = 'z',
  direction: BrickConnector['direction'] = axis === 'x' ? { x: 1, y: 0, z: 0 } : axis === 'z' ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 },
): BrickConnector => ({
  id: `${prefix}-side-stud`,
  kind: 'stud',
  gender: 'male',
  axis,
  direction,
  pose: { xStud, yStud: plateHeightToWorldStud(heightPlates), zStud },
})

const makeBarConnector = (
  prefix: string,
  xStud: number,
  heightPlates: number,
  zStud: number,
  axis: BrickConnector['axis'] = 'x',
  gender: BrickConnector['gender'] = 'male',
  direction: BrickConnector['direction'] = axis === 'x' ? { x: 1, y: 0, z: 0 } : axis === 'z' ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 },
): BrickConnector => ({
  id: `${prefix}-bar`,
  kind: 'bar',
  gender,
  axis,
  direction,
  pose: { xStud, yStud: plateHeightToWorldStud(heightPlates), zStud },
})

const makeClipConnector = (
  prefix: string,
  xStud: number,
  heightPlates: number,
  zStud: number,
  axis: BrickConnector['axis'] = 'x',
  direction: BrickConnector['direction'] = axis === 'x' ? { x: 1, y: 0, z: 0 } : axis === 'z' ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 },
): BrickConnector =>
  makeBarConnector(`${prefix}-clip`, xStud, heightPlates, zStud, axis, 'female', direction)

const makePinConnector = (
  prefix: string,
  xStud: number,
  heightPlates: number,
  zStud: number,
  axis: BrickConnector['axis'],
  gender: BrickConnector['gender'],
  direction: BrickConnector['direction'],
): BrickConnector => ({
  id: `${prefix}-pin`,
  kind: 'pin',
  gender,
  axis,
  direction,
  pose: { xStud, yStud: plateHeightToWorldStud(heightPlates), zStud },
})

const makeStudSocketConnector = (
  prefix: string,
  suffix: string,
  axis: BrickConnector['axis'],
  direction: NonNullable<BrickConnector['direction']>,
  pose: BrickConnector['pose'],
): BrickConnector => ({
  id: `${prefix}-studsocket-${suffix}`,
  kind: 'studsocket',
  gender: 'bidirectional',
  axis,
  direction,
  pose,
})

const makeStudSocketFaceConnectors = (
  prefix: string,
  widthStuds: number,
  depthStuds: number,
  heightStuds: number,
  faces: Array<'top' | 'bottom' | 'right' | 'left' | 'back' | 'front'> = ['top', 'bottom', 'right', 'left', 'back', 'front'],
): BrickConnector[] => {
  const centerXStud = widthStuds / 2 - 0.5
  const centerYStud = heightStuds / 2
  const centerZStud = depthStuds / 2 - 0.5

  return [
    makeStudSocketConnector(prefix, 'top', 'y', { x: 0, y: 1, z: 0 }, { xStud: centerXStud, yStud: heightStuds, zStud: centerZStud }),
    makeStudSocketConnector(prefix, 'bottom', 'y', { x: 0, y: -1, z: 0 }, { xStud: centerXStud, yStud: 0, zStud: centerZStud }),
    makeStudSocketConnector(prefix, 'right', 'x', { x: 1, y: 0, z: 0 }, { xStud: 0, yStud: centerYStud, zStud: centerZStud }),
    makeStudSocketConnector(prefix, 'left', 'x', { x: -1, y: 0, z: 0 }, { xStud: 0, yStud: centerYStud, zStud: centerZStud }),
    makeStudSocketConnector(prefix, 'back', 'z', { x: 0, y: 0, z: 1 }, { xStud: centerXStud, yStud: centerYStud, zStud: 0 }),
    makeStudSocketConnector(prefix, 'front', 'z', { x: 0, y: 0, z: -1 }, { xStud: centerXStud, yStud: centerYStud, zStud: 0 }),
  ].filter((connector) => faces.some((face) => connector.id.endsWith(`-${face}`)))
}

export const colorHex: Record<BrickColor, string> = {
  red: '#d62828',
  blue: '#1d4ed8',
  yellow: '#f7c948',
  green: '#2f9e44',
  white: '#f8fafc',
  black: '#171717',
  gray: '#8b949e',
  brown: '#7c4a28',
  orange: '#f97316',
  tan: '#d6b98c',
  cyan: '#06b6d4',
  lime: '#84cc16',
  pink: '#ec4899',
  'trans-pink': '#f5a3c7',
}

export const colorOpacity: Record<BrickColor, number> = {
  red: 1,
  blue: 1,
  yellow: 1,
  green: 1,
  white: 1,
  black: 1,
  gray: 1,
  brown: 1,
  orange: 1,
  tan: 1,
  cyan: 1,
  lime: 1,
  pink: 1,
  'trans-pink': 0.48,
}

const classicColors: BrickColor[] = ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange', 'tan', 'cyan', 'lime', 'pink']
const grayScaleColors: BrickColor[] = ['black', 'gray', 'white']
const eyeTileColors: BrickColor[] = ['white']
const minecraftColors: BrickColor[] = ['green', 'brown', 'gray', 'tan', 'white', 'black', 'red', 'blue', 'yellow']
type BrickDefinitionDraft = Omit<BrickDefinition, 'pack'> & Partial<Pick<BrickDefinition, 'pack'>>
const defaultBrickPack: BrickDefinition['pack'] = 'lego'

const makeBrickDefinition = (
  id: string,
  partNumber: string,
  name: string,
  widthStuds: number,
  depthStuds: number,
  heightPlates: number,
  colors: BrickColor[] = classicColors,
  inventory = 16,
  extraConnectors: BrickConnector[] = [],
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'brick',
  footprint: legoPlateFootprint(widthStuds, depthStuds, heightPlates),
  connectors: [
    ...makeStudGrid(id, widthStuds, depthStuds, heightPlates),
    ...makeTubeGrid(id, widthStuds, depthStuds, 0),
    ...extraConnectors,
  ],
  colors,
  inventory,
})

const connectorMergeTolerance = 0.05

const connectorGroupKey = (connector: BrickConnector) =>
  `${connector.kind}:${connector.axis}`

const isTopStudConnector = (connector: BrickConnector) =>
  connector.kind === 'stud' &&
  connector.gender === 'male' &&
  connector.axis === 'y' &&
  (connector.direction?.y ?? 1) > 0

const getConnectorGroup = (connectors: BrickConnector[], key: string) =>
  connectors.filter((connector) => connectorGroupKey(connector) === key)

const withLDrawConnectors = (definition: BrickDefinitionDraft): BrickDefinitionDraft => {
  const ldrawConnectors = getLDrawConnectors(definition.partNumber, definition.id)
  const topYStud = definition.footprint.heightStuds
  const fallbackGroupKeys = new Set(definition.connectors.map(connectorGroupKey))
  const discardedLDrawGroupKeys = new Set<string>()
  const hasLDrawTopStud = ldrawConnectors.some(isTopStudConnector)

  for (const key of fallbackGroupKeys) {
    const fallbackGroup = getConnectorGroup(definition.connectors, key)
    const ldrawGroup = getConnectorGroup(ldrawConnectors, key)
    if (fallbackGroup.length === 0 || ldrawGroup.length === 0) continue

    const [fallbackKind] = key.split(':')
    const fallbackIsTopStudGrid = fallbackKind === 'stud' && fallbackGroup.every((connector) =>
      Math.abs(connector.pose.yStud - topYStud) <= connectorMergeTolerance,
    )
    const ldrawDropsBelowTop = ldrawGroup.some((connector) =>
      connector.pose.yStud < topYStud - connectorMergeTolerance,
    )

    if (fallbackIsTopStudGrid && ldrawDropsBelowTop) {
      // Keep regular top studs on the brick grid when a generated LDraw stud
      // lands below the known top surface, as with some inverted slopes.
      discardedLDrawGroupKeys.add(key)
    }
  }

  const mergedLDrawConnectors = ldrawConnectors.filter((connector) =>
    !discardedLDrawGroupKeys.has(connectorGroupKey(connector)),
  )
  const fallbackConnectors = definition.connectors.filter((fallbackConnector) => {
    const key = connectorGroupKey(fallbackConnector)
    if (discardedLDrawGroupKeys.has(key)) return true
    if (isTopStudConnector(fallbackConnector) && ldrawConnectors.length > 0 && !hasLDrawTopStud) return false

    const ldrawGroup = getConnectorGroup(mergedLDrawConnectors, key)
    if (ldrawGroup.length === 0) return true

    return false
  })

  return ldrawConnectors.length > 0
    ? { ...definition, connectors: [...mergedLDrawConnectors, ...fallbackConnectors] }
    : definition
}

const makePlateDefinition = (
  id: string,
  partNumber: string,
  name: string,
  widthStuds: number,
  depthStuds: number,
  colors: BrickColor[] = classicColors,
  inventory = 16,
  extraConnectors: BrickConnector[] = [],
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'plate',
  footprint: legoPlateFootprint(widthStuds, depthStuds, 1),
  connectors: [
    ...makeStudGrid(id, widthStuds, depthStuds, 1),
    ...makeTubeGrid(id, widthStuds, depthStuds, 0),
    ...extraConnectors,
  ],
  colors,
  inventory,
})

const makeJumperPlateDefinition = (
  id: string,
  partNumber: string,
  name: string,
  widthStuds: number,
  depthStuds: number,
  colors: BrickColor[] = classicColors,
  inventory = 16,
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'plate',
  footprint: legoPlateFootprint(widthStuds, depthStuds, 1),
  connectors: [
    makeCenterStud(id, widthStuds, depthStuds, 1),
    ...makeTubeGrid(id, widthStuds, depthStuds, 0),
  ],
  colors,
  inventory,
})

const makeTileDefinition = (
  id: string,
  partNumber: string,
  name: string,
  widthStuds: number,
  depthStuds: number,
  colors: BrickColor[] = classicColors,
  inventory = 16,
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'tile',
  footprint: legoPlateFootprint(widthStuds, depthStuds, 1),
  connectors: [...makeTubeGrid(id, widthStuds, depthStuds, 0)],
  colors,
  inventory,
})

const makeSlopeDefinition = (
  id: string,
  partNumber: string,
  name: string,
  widthStuds: number,
  depthStuds: number,
  heightPlates: number,
  colors: BrickColor[] = classicColors,
  inventory = 16,
  studRowZ = Math.max(0, depthStuds - 1),
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'slope',
  footprint: legoPlateFootprint(widthStuds, depthStuds, heightPlates),
  connectors: [
    ...makeStudRow(id, widthStuds, studRowZ, heightPlates),
    ...makeTubeGrid(id, widthStuds, depthStuds, 0),
  ],
  colors,
  inventory,
})

const makeStudlessSlopeDefinition = (
  id: string,
  partNumber: string,
  name: string,
  widthStuds: number,
  depthStuds: number,
  heightPlates: number,
  colors: BrickColor[] = classicColors,
  inventory = 16,
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'slope',
  footprint: legoPlateFootprint(widthStuds, depthStuds, heightPlates),
  connectors: [...makeTubeGrid(id, widthStuds, depthStuds, 0)],
  colors,
  inventory,
})

const makeRoundDefinition = (
  id: string,
  partNumber: string,
  name: string,
  widthStuds: number,
  depthStuds: number,
  heightPlates: number,
  colors: BrickColor[] = classicColors,
  inventory = 16,
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'round',
  footprint: legoPlateFootprint(widthStuds, depthStuds, heightPlates),
  connectors: [
    ...makeStudGrid(id, Math.max(1, Math.floor(widthStuds)), Math.max(1, Math.floor(depthStuds)), heightPlates),
    ...makeTubeGrid(id, Math.max(1, Math.floor(widthStuds)), Math.max(1, Math.floor(depthStuds)), 0),
  ],
  colors,
  inventory,
})

const makeConeDefinition = (
  id: string,
  partNumber: string,
  name: string,
  widthStuds: number,
  depthStuds: number,
  heightPlates: number,
  colors: BrickColor[] = classicColors,
  inventory = 16,
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'cone',
  footprint: legoPlateFootprint(widthStuds, depthStuds, heightPlates),
  connectors: [
    makeCenterStud(id, widthStuds, depthStuds, heightPlates),
    ...makeTubeGrid(id, Math.max(1, Math.floor(widthStuds)), Math.max(1, Math.floor(depthStuds)), 0),
  ],
  colors,
  inventory,
})

const makeConeNoTopStudDefinition = (
  id: string,
  partNumber: string,
  name: string,
  widthStuds: number,
  depthStuds: number,
  heightPlates: number,
  colors: BrickColor[] = classicColors,
  inventory = 16,
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'cone',
  footprint: legoPlateFootprint(widthStuds, depthStuds, heightPlates),
  connectors: [...makeTubeGrid(id, Math.max(1, Math.floor(widthStuds)), Math.max(1, Math.floor(depthStuds)), 0)],
  colors,
  inventory,
})

const makeWheelDefinition = (
  id: string,
  partNumber: string,
  name: string,
  widthStuds: number,
  depthStuds: number,
  colors: BrickColor[] = grayScaleColors,
  inventory = 16,
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'wheel',
  footprint: legoPlateFootprint(widthStuds, depthStuds, 3),
  // Wheels and tires intentionally stay connectorless until the editor models
  // axle holes and tire/rim fits as distinct mechanical joints. Fake studs here
  // would make validation accept physically impossible assemblies.
  connectors: [],
  colors,
  inventory,
})

const makePropellerDefinition = (
  id: string,
  partNumber: string,
  name: string,
  diameterStuds: number,
  heightPlates: number,
  colors: BrickColor[] = grayScaleColors,
  inventory = 1,
  hasPinHole = false,
): BrickDefinitionDraft => ({
  id,
  partNumber,
  name,
  kind: 'propeller',
  footprint: legoPlateFootprint(diameterStuds, diameterStuds, heightPlates),
  connectors: hasPinHole ? [
    makePinConnector(`${id}-hub`, diameterStuds / 2, 0, diameterStuds / 2, 'y', 'female', { x: 0, y: 1, z: 0 }),
  ] : [],
  colors,
  inventory,
})

const classic10696ExtraDefinitions: BrickDefinitionDraft[] = [
  makeBrickDefinition('bracket-1x2-2x2', '44728', '1x2 - 2x2 Bracket', 2, 2, 3, ['black'], 1),
  makeRoundDefinition('brick-round-1x1', '3062', '1x1 Round Brick', 1, 1, 3, ['black', 'cyan', 'green', 'white'], 8),
  makeRoundDefinition('brick-round-2x2-axle-grille', '92947', '2x2 Round Brick with Axle Hole and Grille', 2, 2, 3, ['black'], 1),
  makeConeDefinition('cone-truncated-2x2', '98100', '2x2 Truncated Cone', 2, 2, 3, ['black'], 1),
  makePlateDefinition('plate-4x4', '3031', '4x4 Plate', 4, 4, ['blue', 'lime', 'green'], 8),
  makePlateDefinition('plate-8x16', '92438', '8x16 Plate', 16, 8, ['lime', 'green'], 1),
  makePlateDefinition('plate-6x8', '3036', '6x8 Plate', 8, 6, ['gray'], 1),
  makePlateDefinition('plate-2x3', '3021', '2x3 Plate', 3, 2, ['green', 'gray'], 8),
  makePlateDefinition('plate-4x8', '3035', '4x8 Plate', 8, 4, ['yellow'], 1),
  makePlateDefinition('plate-1x3', '3623', '1x3 Plate', 3, 1, ['tan'], 4),
  makePlateDefinition('plate-1x6', '3666', '1x6 Plate', 6, 1, ['cyan'], 4),
  makeTileDefinition('tile-1x4', '2431', '1x4 Tile', 4, 1, ['lime'], 2),
  makeTileDefinition('tile-2x4', '87079', '2x4 Tile', 4, 2, ['blue'], 2),
  makeTileDefinition('tile-grille-1x2', '2412', '1x2 Grille Tile', 2, 1, ['gray'], 4),
  makeTileDefinition('tile-eye-closed-1x1', '98138', '1x1 Round Closed Eye Tile', 1, 1, eyeTileColors, 2),
  makeTileDefinition('tile-eye-offset-1x1', '98138', '1x1 Round Offset Eye Tile', 1, 1, eyeTileColors, 2),
  makeTileDefinition('tile-eye-centered-1x1', '98138', '1x1 Round Centered Eye Tile', 1, 1, eyeTileColors, 1),
  makeRoundDefinition('brick-round-2x2-axle', '3941', '2x2 Round Brick with Axle Hole', 2, 2, 3, ['pink'], 2),
  makeRoundDefinition('plate-round-2x2-axle', '4032', '2x2 Round Plate with Axle Hole', 2, 2, 1, ['yellow'], 1),
  makeConeNoTopStudDefinition('cone-1x1-groove', '4589', '1x1 Cone with Top Groove', 1, 1, 3, ['gray'], 3),
  makeSlopeDefinition('inverted-slope-1x2', '3665', '1x2 Inverted Slope', 2, 1, 3, ['black'], 4, 0),
  makeSlopeDefinition('slope-2x4', '3037', '2x4 Slope', 4, 2, 3, ['brown'], 1),
  makeSlopeDefinition('slope-3x1-33', '4286', '3x1 Slope 33', 3, 1, 2, ['green'], 2, 0),
  makeSlopeDefinition('slope-curved-2x4', '88930', '2x4 Curved Slope', 4, 2, 2, ['blue'], 2),
  makeSlopeDefinition('slope-curved-4x1-double', '93273', '4x1 Double Curved Slope', 4, 1, 2, ['blue'], 2, 0),
  makeSlopeDefinition('slope-curved-4x1', '61678', '4x1 Curved Slope', 4, 1, 2, ['cyan'], 4, 0),
  makeSlopeDefinition('slope-1x2-low', '85984', '1x2 Low Slope', 2, 1, 2, ['cyan'], 2, 0),
  makeSlopeDefinition('slope-2x1x2', '60481', '2x1x2 Slope 65', 2, 1, 6, ['brown'], 4, 0),
  makeSlopeDefinition('slope-2x1x3', '4460', '2x1x3 Slope 75', 2, 1, 9, ['gray'], 2, 0),
  makeSlopeDefinition('slope-2x2x3', '3684', '2x2x3 Slope 75', 2, 2, 9, ['gray'], 2),
  makeStudlessSlopeDefinition('slope-curved-3x1', '50950', '3x1 Curved Slope', 3, 1, 3, ['gray'], 4),
  makeSlopeDefinition('slope-curved-2x1-low', '11477', '2x1 Low Curved Slope', 2, 1, 2, ['red'], 2, 0),
  makeSlopeDefinition('slope-curved-3x2', '6215', '3x2 Curved Slope with Studs', 3, 2, 3, ['red'], 1),
  makeSlopeDefinition('inverted-slope-3x2', '3747', '3x2 Inverted Slope', 3, 2, 3, ['orange'], 2),
  makeBrickDefinition('brick-1x6', '3009', '1x6 Brick', 6, 1, 3, ['cyan'], 2),
  makeBrickDefinition('brick-2x8', '3007', '2x8 Brick', 8, 2, 3, ['gray'], 2),
  makeBrickDefinition('brick-trans-1x2', '3065', '1x2 Transparent Brick', 2, 1, 3, ['green'], 2),
  makeBrickDefinition('brick-side-studs-1x1', '87087', '1x1 Brick with Stud on Side', 1, 1, 3, ['cyan'], 4, [makeSideStud('brick-side-studs-1x1', 0, 1.5, 0, 'z', { x: 0, y: 0, z: -1 })]),
  makeBrickDefinition('brick-side-studs-1x4', '30414', '1x4 Brick with Studs on Side', 4, 1, 3, ['yellow'], 2, Array.from({ length: 4 }).map((_, xStud) => makeSideStud(`brick-side-studs-1x4-${xStud}`, xStud, 1.5, 0, 'z', { x: 0, y: 0, z: -1 }))),
  makeBrickDefinition('brick-modified-1x2-bar', '30236', '1x2 Brick with Bar Handle on Side', 2, 1, 3, ['black'], 1),
  makeBrickDefinition('brick-modified-2x2-pins', '30000', '2x2 Brick with Pins and Axle Hole', 2, 2, 3, ['gray'], 5),
  makeBrickDefinition('brick-modified-2x2-pin-axle', '6232', '2x2 Brick with Pin and Axle Hole', 2, 2, 3, ['tan'], 1, [
    makePinConnector('brick-modified-2x2-pin-axle', 1, 1.5, 0, 'z', 'male', { x: 0, y: 0, z: -1 }),
  ]),
  makeBrickDefinition('window-1x2x2', '60032', '1x2x2 Window Frame', 2, 1, 6, ['black'], 10),
  makeBrickDefinition('window-1x2x2-rounded', '30044', '1x2x2 Rounded Window Frame', 2, 1, 8, ['tan'], 1),
  makeBrickDefinition('window-shutter-rounded', '94161', 'Rounded Window Shutter', 2, 1, 8, ['brown'], 1),
  makeBrickDefinition('arch-1x4', '3659', '1x4 Arch', 4, 1, 3, ['brown'], 2),
  makeBrickDefinition('arch-1x3x2-curved', '88292', '1x3x2 Arch with Curved End', 3, 1, 6, ['white'], 1),
  makeJumperPlateDefinition('plate-jumper-2x2', '87580', '2x2 Jumper Plate', 2, 2, ['blue'], 1),
  makeJumperPlateDefinition('plate-jumper-1x2', '15573', '1x2 Jumper Plate', 2, 1, ['orange'], 1),
  makePlateDefinition('plate-clip-end-1x2', '63868', '1x2 Plate with End Clip', 2, 1, ['black'], 1),
  makePlateDefinition('plate-clip-open-1x1', '61252', '1x1 Plate with Open Clip', 1, 1, ['yellow'], 4, [
    makeClipConnector('plate-clip-open-1x1', 0.5, 0.5, 1, 'x'),
  ]),
  makePlateDefinition('plate-tooth-1x1', '49668', '1x1 Plate with Tooth', 1, 1, ['white'], 2),
  makePlateDefinition('plate-bar-end-1x2', '60478', '1x2 Plate with Bar Handle on End', 2, 1, ['white'], 1, [
    // LDraw 60478.dat places the handle primitives around x=30 LDU, z=+/-7 LDU:
    // 1.5 studs from the left edge and roughly one third stud outside the end.
    makeBarConnector('plate-bar-end-1x2', 1.5, 0.5, -0.35, 'x'),
  ]),
  makePlateDefinition('plate-bar-frame-2x2', '75937', '2x2 Plate with Octagonal Bar Frame', 2, 2, ['white'], 1),
  makePlateDefinition('plate-cross-3x3', '15397', '3x3 Cross Plate', 3, 3, ['white'], 1),
  makePlateDefinition('plate-open-center-4x4', '64799', '4x4 Plate with 2x2 Open Center', 4, 4, ['yellow'], 1),
  makePlateDefinition('plate-tow-ball-1x4', '3184', '1x4 Plate with Tow Ball', 4, 1, ['black'], 1),
  makePlateDefinition('plate-tow-socket-1x4', '98263', '1x4 Plate with Tow Ball Socket', 4, 1, ['gray'], 2),
  makePlateDefinition('plate-wheel-holder-1x4', '2926', '1x4 Plate with Wheels Holder', 4, 1, ['black'], 2),
  makePlateDefinition('plate-wheel-holder-2x2', '4600', '2x2 Plate with Wheels Holder', 2, 2, ['black'], 2),
  makePlateDefinition('turntable-top-2x2', '3679', '2x2 Turntable Top', 2, 2, ['gray'], 1),
  makePlateDefinition('turntable-base-2x2', '3680', '2x2 Turntable Base', 2, 2, ['red'], 1),
  makePlateDefinition('brick-separator', '96874', 'Brick and Axle Separator', 4, 1, ['orange'], 1),
  makePropellerDefinition('propeller-4-blade-open', '2479', '4 Blade Propeller with Open Hub', 5, 3.5, ['black'], 1, true),
  makePropellerDefinition('propeller-4-blade-closed', '67737', '4 Blade Propeller with Closed Hub', 5, 3.5, ['black'], 1, true),
  makeWheelDefinition('tire-15x6', '87414', '15mm Tire', 1, 1, ['black'], 4),
  makeWheelDefinition('tire-21x12', '87697', '21mm Tire', 2, 1, ['black'], 4),
  makeWheelDefinition('tire-24x7', '61254', '24mm Tire', 2, 1, ['black'], 10),
  makeWheelDefinition('wheel-8x6', '4624', '8mm Wheel', 1, 1, ['gray'], 4),
  makeWheelDefinition('wheel-8x6-slot', '34337', '8mm Wheel with Slot', 1, 1, ['gray'], 1),
  makeWheelDefinition('wheel-11x12', '6014', '11mm Wheel', 1, 1, ['gray'], 4),
  makeWheelDefinition('wheel-18x8', '13971', '18mm Wheel with Spokes', 2, 1, ['gray'], 10),
]

const usesFixedPrintedColors = (definition: BrickDefinitionDraft) =>
  definition.id.startsWith('tile-eye')

const withOfficialColors = (definition: BrickDefinitionDraft): BrickDefinitionDraft => (
  usesFixedPrintedColors(definition)
    ? definition
    : { ...definition, colors: getOfficialPartColors(definition.partNumber, definition.colors) }
)

const withDefaultPack = (definition: BrickDefinitionDraft): BrickDefinition => ({
  ...definition,
  pack: definition.pack ?? defaultBrickPack,
})

const withUnlimitedInventory = (definition: BrickDefinition): BrickDefinition => ({
  ...definition,
  inventory: Number.POSITIVE_INFINITY,
})

const makeMinecraftBlockDefinition = (
  id: string,
  name: string,
  color: BrickColor,
  catalogCategory: 'terrain' | 'stone' | 'wood' | 'ore' | 'building' | 'functional',
  voxelVisual: VoxelBlockVisual,
  options: {
    widthStuds?: number
    depthStuds?: number
    heightStuds?: number
    connectorFaces?: Array<'top' | 'bottom' | 'right' | 'left' | 'back' | 'front'>
  } = {},
): BrickDefinitionDraft => ({
  id,
  pack: 'minecraft',
  partNumber: id,
  name,
  kind: 'block',
  footprint: {
    widthStuds: options.widthStuds ?? 1,
    depthStuds: options.depthStuds ?? 1,
    heightStuds: options.heightStuds ?? 1,
  },
  connectors: makeStudSocketFaceConnectors(
    id,
    options.widthStuds ?? 1,
    options.depthStuds ?? 1,
    options.heightStuds ?? 1,
    options.connectorFaces,
  ),
  colors: [color],
  inventory: 64,
  catalogCategory,
  voxelVisual,
})

const fallbackBrickDefinitions: BrickDefinitionDraft[] = [
  makeMinecraftBlockDefinition('minecraft-grass-block', 'Grass Block', 'green', 'terrain', {
    shape: 'cube', textures: { all: 'grass-side', top: 'grass-top', bottom: 'dirt' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-dirt-block', 'Dirt Block', 'brown', 'terrain', {
    shape: 'cube', textures: { all: 'dirt' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-sand-block', 'Sand Block', 'yellow', 'terrain', {
    shape: 'cube', textures: { all: 'sand' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-snow-block', 'Snow Block', 'white', 'terrain', {
    shape: 'cube', textures: { all: 'snow' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-clay-block', 'Clay Block', 'gray', 'terrain', {
    shape: 'cube', textures: { all: 'clay' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-moss-block', 'Moss Block', 'green', 'terrain', {
    shape: 'cube', textures: { all: 'moss' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-ice-block', 'Ice Block', 'cyan', 'terrain', {
    shape: 'cube', textures: { all: 'ice' }, renderLayer: 'translucent',
  }),
  makeMinecraftBlockDefinition('minecraft-tall-grass', 'Tall Grass', 'green', 'terrain', {
    shape: 'cross', textures: { all: 'grass-plant' }, renderLayer: 'cutout',
  }, { heightStuds: 0.9, connectorFaces: ['bottom'] }),
  makeMinecraftBlockDefinition('minecraft-red-flower', 'Red Flower', 'red', 'terrain', {
    shape: 'cross', textures: { all: 'red-flower' }, renderLayer: 'cutout',
  }, { heightStuds: 0.9, connectorFaces: ['bottom'] }),
  makeMinecraftBlockDefinition('minecraft-yellow-flower', 'Yellow Flower', 'yellow', 'terrain', {
    shape: 'cross', textures: { all: 'yellow-flower' }, renderLayer: 'cutout',
  }, { heightStuds: 0.9, connectorFaces: ['bottom'] }),
  makeMinecraftBlockDefinition('minecraft-blue-flower', 'Blue Flower', 'blue', 'terrain', {
    shape: 'cross', textures: { all: 'blue-flower' }, renderLayer: 'cutout',
  }, { heightStuds: 0.9, connectorFaces: ['bottom'] }),
  makeMinecraftBlockDefinition('minecraft-gravel-block', 'Gravel Block', 'gray', 'terrain', {
    shape: 'cube', textures: { all: 'gravel' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-mud-block', 'Mud Block', 'brown', 'terrain', {
    shape: 'cube', textures: { all: 'mud' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-cactus', 'Cactus', 'green', 'terrain', {
    shape: 'cube', textures: { all: 'cactus-side', top: 'cactus-top', bottom: 'cactus-top' }, renderLayer: 'opaque',
  }, { widthStuds: 0.875, depthStuds: 0.875, connectorFaces: ['bottom', 'top'] }),
  makeMinecraftBlockDefinition('minecraft-stone-block', 'Stone Block', 'gray', 'stone', {
    shape: 'cube', textures: { all: 'stone' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-cobblestone', 'Cobblestone', 'gray', 'stone', {
    shape: 'cube', textures: { all: 'cobblestone' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-stone-bricks', 'Stone Bricks', 'gray', 'stone', {
    shape: 'cube', textures: { all: 'stone-bricks' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-sandstone', 'Sandstone', 'tan', 'stone', {
    shape: 'cube', textures: { all: 'sandstone-side', top: 'sandstone-top', bottom: 'sandstone-top' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-deepslate', 'Deepslate', 'black', 'stone', {
    shape: 'cube', textures: { all: 'deepslate' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-obsidian', 'Obsidian', 'black', 'stone', {
    shape: 'cube', textures: { all: 'obsidian' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-stone-slab', 'Stone Slab', 'gray', 'stone', {
    shape: 'slab', textures: { all: 'stone' }, renderLayer: 'opaque',
  }, { heightStuds: 0.5 }),
  makeMinecraftBlockDefinition('minecraft-stone-stairs', 'Stone Stairs', 'gray', 'stone', {
    shape: 'stairs', textures: { all: 'stone-bricks' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-oak-planks', 'Oak Planks', 'tan', 'wood', {
    shape: 'cube', textures: { all: 'oak-planks' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-birch-planks', 'Birch Planks', 'white', 'wood', {
    shape: 'cube', textures: { all: 'birch-planks' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-spruce-planks', 'Spruce Planks', 'brown', 'wood', {
    shape: 'cube', textures: { all: 'spruce-planks' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-oak-log', 'Oak Log', 'brown', 'wood', {
    shape: 'cube', textures: { all: 'oak-log-side', top: 'oak-log-top', bottom: 'oak-log-top' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-birch-log', 'Birch Log', 'white', 'wood', {
    shape: 'cube', textures: { all: 'birch-log-side', top: 'birch-log-top', bottom: 'birch-log-top' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-spruce-log', 'Spruce Log', 'brown', 'wood', {
    shape: 'cube', textures: { all: 'spruce-log-side', top: 'spruce-log-top', bottom: 'spruce-log-top' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-oak-leaves', 'Oak Leaves', 'green', 'wood', {
    shape: 'cube', textures: { all: 'oak-leaves' }, renderLayer: 'cutout',
  }),
  makeMinecraftBlockDefinition('minecraft-birch-leaves', 'Birch Leaves', 'lime', 'wood', {
    shape: 'cube', textures: { all: 'birch-leaves' }, renderLayer: 'cutout',
  }),
  makeMinecraftBlockDefinition('minecraft-oak-slab', 'Oak Slab', 'tan', 'wood', {
    shape: 'slab', textures: { all: 'oak-planks' }, renderLayer: 'opaque',
  }, { heightStuds: 0.5 }),
  makeMinecraftBlockDefinition('minecraft-oak-stairs', 'Oak Stairs', 'tan', 'wood', {
    shape: 'stairs', textures: { all: 'oak-planks' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-oak-fence', 'Oak Fence', 'brown', 'wood', {
    shape: 'fence', textures: { all: 'oak-planks' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-coal-ore', 'Coal Ore', 'gray', 'ore', {
    shape: 'cube', textures: { all: 'coal-ore' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-iron-ore', 'Iron Ore', 'tan', 'ore', {
    shape: 'cube', textures: { all: 'iron-ore' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-copper-ore', 'Copper Ore', 'orange', 'ore', {
    shape: 'cube', textures: { all: 'copper-ore' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-gold-ore', 'Gold Ore', 'yellow', 'ore', {
    shape: 'cube', textures: { all: 'gold-ore' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-redstone-ore', 'Redstone Ore', 'red', 'ore', {
    shape: 'cube', textures: { all: 'redstone-ore' }, renderLayer: 'emissive', emissiveIntensity: 0.08,
  }),
  makeMinecraftBlockDefinition('minecraft-lapis-ore', 'Lapis Ore', 'blue', 'ore', {
    shape: 'cube', textures: { all: 'lapis-ore' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-diamond-ore', 'Diamond Ore', 'cyan', 'ore', {
    shape: 'cube', textures: { all: 'diamond-ore' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-bricks', 'Brick Block', 'red', 'building', {
    shape: 'cube', textures: { all: 'bricks' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-white-concrete', 'White Concrete', 'white', 'building', {
    shape: 'cube', textures: { all: 'white-concrete' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-gray-concrete', 'Gray Concrete', 'gray', 'building', {
    shape: 'cube', textures: { all: 'gray-concrete' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-red-concrete', 'Red Concrete', 'red', 'building', {
    shape: 'cube', textures: { all: 'red-concrete' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-bookshelf', 'Bookshelf', 'brown', 'building', {
    shape: 'cube', textures: { all: 'bookshelf-side', top: 'oak-planks', bottom: 'oak-planks' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-crafting-table', 'Crafting Table', 'brown', 'building', {
    shape: 'cube', textures: { all: 'crafting-side', top: 'crafting-top', bottom: 'oak-planks' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-furnace', 'Furnace', 'gray', 'building', {
    shape: 'cube', textures: { all: 'furnace-side', top: 'stone', bottom: 'stone' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-oak-door', 'Oak Door', 'brown', 'building', {
    shape: 'cube', textures: { all: 'oak-door', top: 'oak-planks', bottom: 'oak-planks' }, renderLayer: 'cutout',
  }, { depthStuds: 0.1875, heightStuds: 2, connectorFaces: ['bottom'] }),
  makeMinecraftBlockDefinition('minecraft-glass-pane', 'Glass Pane', 'white', 'building', {
    shape: 'cube', textures: { all: 'glass' }, renderLayer: 'translucent',
  }, { depthStuds: 0.125, connectorFaces: ['bottom', 'top'] }),
  makeMinecraftBlockDefinition('minecraft-chest', 'Chest', 'brown', 'building', {
    shape: 'cube', textures: { all: 'chest-side', top: 'chest-top', bottom: 'oak-planks' }, renderLayer: 'opaque',
  }, { widthStuds: 0.875, depthStuds: 0.875, heightStuds: 0.75 }),
  makeMinecraftBlockDefinition('minecraft-hay-bale', 'Hay Bale', 'yellow', 'building', {
    shape: 'cube', textures: { all: 'hay-side', top: 'hay-top', bottom: 'hay-top' }, renderLayer: 'opaque',
  }),
  makeMinecraftBlockDefinition('minecraft-water-block', 'Water Block', 'cyan', 'functional', {
    shape: 'cube', textures: { all: 'water' }, renderLayer: 'translucent',
  }),
  makeMinecraftBlockDefinition('minecraft-glass-block', 'Glass Block', 'white', 'functional', {
    shape: 'cube', textures: { all: 'glass' }, renderLayer: 'translucent',
  }),
  makeMinecraftBlockDefinition('minecraft-redstone-block', 'Redstone Block', 'red', 'functional', {
    shape: 'cube', textures: { all: 'redstone' }, renderLayer: 'emissive', emissiveIntensity: 0.18,
  }),
  makeMinecraftBlockDefinition('minecraft-glow-lamp', 'Glow Lamp', 'yellow', 'functional', {
    shape: 'cube', textures: { all: 'glow-lamp' }, renderLayer: 'emissive', emissiveIntensity: 0.42,
  }),
  makeMinecraftBlockDefinition('minecraft-lantern', 'Lantern', 'yellow', 'functional', {
    shape: 'cube', textures: { all: 'lantern' }, renderLayer: 'emissive', emissiveIntensity: 0.52,
  }, { widthStuds: 0.5, depthStuds: 0.5, heightStuds: 0.75, connectorFaces: ['bottom', 'top'] }),
  makeMinecraftBlockDefinition('minecraft-iron-bars', 'Iron Bars', 'gray', 'functional', {
    shape: 'fence', textures: { all: 'iron-bars' }, renderLayer: 'cutout',
  }),
  {
    id: 'minecraft-basic-block',
    pack: 'minecraft',
    partNumber: 'minecraft-basic-block',
    name: 'Basic Minecraft Block',
    kind: 'block',
    footprint: { widthStuds: 1, depthStuds: 1, heightStuds: 1 },
    connectors: makeStudSocketFaceConnectors('minecraft-basic-block', 1, 1, 1),
    colors: minecraftColors,
    inventory: 64,
    catalogCategory: 'functional',
    voxelVisual: {
      shape: 'cube', textures: { all: 'basic-grid' }, renderLayer: 'opaque',
    },
  },
  {
    id: 'brick-1x1',
    partNumber: '3005',
    name: '1x1 Brick',
    kind: 'brick',
    footprint: legoPlateFootprint(1, 1, 3),
    connectors: [...makeStudGrid('brick-1x1', 1, 1, 3), ...makeTubeGrid('brick-1x1', 1, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange'],
    inventory: 60,
  },
  {
    id: 'brick-1x2',
    partNumber: '3004',
    name: '1x2 Brick',
    kind: 'brick',
    footprint: legoPlateFootprint(2, 1, 3),
    connectors: [...makeStudGrid('brick-1x2', 2, 1, 3), ...makeTubeGrid('brick-1x2', 2, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange', 'tan', 'cyan', 'pink', 'trans-pink'],
    inventory: 80,
  },
  {
    id: 'brick-1x3',
    partNumber: '3622',
    name: '1x3 Brick',
    kind: 'brick',
    footprint: legoPlateFootprint(3, 1, 3),
    connectors: [...makeStudGrid('brick-1x3', 3, 1, 3), ...makeTubeGrid('brick-1x3', 3, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange', 'tan'],
    inventory: 48,
  },
  {
    id: 'brick-1x4',
    partNumber: '3010',
    name: '1x4 Brick',
    kind: 'brick',
    footprint: legoPlateFootprint(4, 1, 3),
    connectors: [...makeStudGrid('brick-1x4', 4, 1, 3), ...makeTubeGrid('brick-1x4', 4, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown'],
    inventory: 52,
  },
  {
    id: 'brick-2x2',
    partNumber: '3003',
    name: '2x2 Brick',
    kind: 'brick',
    footprint: legoPlateFootprint(2, 2, 3),
    connectors: [...makeStudGrid('brick-2x2', 2, 2, 3), ...makeTubeGrid('brick-2x2', 2, 2, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange', 'tan'],
    inventory: 48,
  },
  {
    id: 'brick-2x3',
    partNumber: '3002',
    name: '2x3 Brick',
    kind: 'brick',
    footprint: legoPlateFootprint(3, 2, 3),
    connectors: [...makeStudGrid('brick-2x3', 3, 2, 3), ...makeTubeGrid('brick-2x3', 3, 2, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown'],
    inventory: 36,
  },
  {
    id: 'brick-2x4',
    partNumber: '3001',
    name: '2x4 Brick',
    kind: 'brick',
    footprint: legoPlateFootprint(4, 2, 3),
    connectors: [...makeStudGrid('brick-2x4', 4, 2, 3), ...makeTubeGrid('brick-2x4', 4, 2, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'orange', 'tan', 'cyan'],
    inventory: 36,
  },
  {
    id: 'plate-1x2',
    partNumber: '3023',
    name: '1x2 Plate',
    kind: 'plate',
    footprint: legoPlateFootprint(2, 1, 1),
    connectors: [...makeStudGrid('plate-1x2', 2, 1, 1), ...makeTubeGrid('plate-1x2', 2, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange', 'tan'],
    inventory: 72,
  },
  {
    id: 'plate-1x1',
    partNumber: '3024',
    name: '1x1 Plate',
    kind: 'plate',
    footprint: legoPlateFootprint(1, 1, 1),
    connectors: [...makeStudGrid('plate-1x1', 1, 1, 1), ...makeTubeGrid('plate-1x1', 1, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'orange', 'tan', 'cyan', 'lime', 'pink'],
    inventory: 96,
  },
  {
    id: 'plate-2x2',
    partNumber: '3022',
    name: '2x2 Plate',
    kind: 'plate',
    footprint: legoPlateFootprint(2, 2, 1),
    connectors: [...makeStudGrid('plate-2x2', 2, 2, 1), ...makeTubeGrid('plate-2x2', 2, 2, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'tan'],
    inventory: 64,
  },
  {
    id: 'plate-1x4',
    partNumber: '3710',
    name: '1x4 Plate',
    kind: 'plate',
    footprint: legoPlateFootprint(4, 1, 1),
    connectors: [...makeStudGrid('plate-1x4', 4, 1, 1), ...makeTubeGrid('plate-1x4', 4, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange', 'tan', 'cyan', 'lime'],
    inventory: 56,
  },
  {
    id: 'plate-2x4',
    partNumber: '3020',
    name: '2x4 Plate',
    kind: 'plate',
    footprint: legoPlateFootprint(4, 2, 1),
    connectors: [...makeStudGrid('plate-2x4', 4, 2, 1), ...makeTubeGrid('plate-2x4', 4, 2, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'orange', 'tan'],
    inventory: 48,
  },
  {
    id: 'plate-2x6',
    partNumber: '3795',
    name: '2x6 Plate',
    kind: 'plate',
    footprint: legoPlateFootprint(6, 2, 1),
    connectors: [...makeStudGrid('plate-2x6', 6, 2, 1), ...makeTubeGrid('plate-2x6', 6, 2, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'tan'],
    inventory: 32,
  },
  {
    id: 'plate-2x8',
    partNumber: '3034',
    name: '2x8 Plate',
    kind: 'plate',
    footprint: legoPlateFootprint(8, 2, 1),
    connectors: [...makeStudGrid('plate-2x8', 8, 2, 1), ...makeTubeGrid('plate-2x8', 8, 2, 0)],
    colors: ['white', 'red', 'blue', 'yellow', 'green', 'black', 'gray', 'tan'],
    inventory: 24,
  },
  {
    id: 'plate-4x6',
    partNumber: '3032',
    name: '4x6 Plate',
    kind: 'plate',
    footprint: legoPlateFootprint(6, 4, 1),
    connectors: [...makeStudGrid('plate-4x6', 6, 4, 1), ...makeTubeGrid('plate-4x6', 6, 4, 0)],
    colors: ['green', 'gray', 'tan', 'blue', 'white', 'black'],
    inventory: 18,
  },
  {
    id: 'tile-1x2',
    partNumber: '3069',
    name: '1x2 Tile',
    kind: 'tile',
    footprint: legoPlateFootprint(2, 1, 1),
    connectors: [...makeTubeGrid('tile-1x2', 2, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'white', 'black', 'gray', 'tan'],
    inventory: 52,
  },
  {
    id: 'tile-1x1',
    partNumber: '3070',
    name: '1x1 Tile',
    kind: 'tile',
    footprint: legoPlateFootprint(1, 1, 1),
    connectors: [...makeTubeGrid('tile-1x1', 1, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'white', 'black', 'gray', 'tan', 'cyan', 'lime', 'pink'],
    inventory: 64,
  },
  {
    id: 'tile-eye-1x1',
    partNumber: '98138',
    name: '1x1 Round Eye Tile',
    kind: 'tile',
    footprint: legoPlateFootprint(1, 1, 1),
    connectors: [...makeTubeGrid('tile-eye-1x1', 1, 1, 0)],
    colors: ['white'],
    inventory: 24,
  },
  {
    id: 'round-1x1-plate',
    partNumber: '4073',
    name: '1x1 Round Plate',
    kind: 'round',
    footprint: legoPlateFootprint(1, 1, 1),
    connectors: [...makeStudGrid('round-1x1-plate', 1, 1, 1), ...makeTubeGrid('round-1x1-plate', 1, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'orange', 'tan', 'cyan', 'lime', 'pink'],
    inventory: 80,
  },
  {
    id: 'slope-1x2',
    partNumber: '3040',
    name: '1x2 Slope',
    kind: 'slope',
    // LDraw 3040.dat is moved to 3040b.dat: Slope Brick 45 2 x 1.
    footprint: legoPlateFootprint(2, 1, 3),
    connectors: [
      {
        id: 'slope-1x2-stud-high',
        kind: 'stud',
        gender: 'male',
        axis: 'y',
        direction: { x: 0, y: 1, z: 0 },
        pose: { xStud: 1, yStud: plateHeightToWorldStud(3), zStud: 0 },
      },
      ...makeTubeGrid('slope-1x2', 2, 1, 0),
    ],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange', 'tan', 'cyan'],
    inventory: 36,
  },
  {
    id: 'slope-2x2',
    partNumber: '3039',
    name: '2x2 Slope',
    kind: 'slope',
    // LDraw 3039.dat: Slope Brick 45 2 x 2.
    footprint: legoPlateFootprint(2, 2, 3),
    connectors: [...makeStudRow('slope-2x2', 2, 1, 3), ...makeTubeGrid('slope-2x2', 2, 2, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange', 'tan', 'cyan'],
    inventory: 28,
  },
  {
    id: 'slope-cheese-1x1',
    partNumber: '54200',
    name: '1x1 Cheese Slope',
    kind: 'slope',
    // LDraw 54200.dat: Slope Brick 31 1 x 1 x 0.667, commonly called a cheese slope.
    footprint: legoPlateFootprint(1, 1, 2),
    connectors: [...makeTubeGrid('slope-cheese-1x1', 1, 1, 0)],
    colors: ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'orange', 'tan', 'cyan', 'lime', 'pink'],
    inventory: 48,
  },
  {
    id: 'curved-slope-1x2',
    partNumber: '6091',
    name: '1x2 Curved Slope',
    kind: 'slope',
    // LDraw 6091.dat: Brick 2 x 1 x 1.333 with Curved Top.
    footprint: legoPlateFootprint(2, 1, 4),
    connectors: [
      makeCenterStud('curved-slope-1x2', 2, 1, 3),
      makeTubeConnector('curved-slope-1x2-left', 0, 0, 0),
      makeTubeConnector('curved-slope-1x2-right', 1, 0.8, 0),
    ],
    colors: ['white', 'red', 'blue', 'yellow', 'green', 'black', 'gray', 'cyan'],
    inventory: 24,
  },
  {
    id: 'inverted-slope-2x2',
    partNumber: '3660',
    name: '2x2 Inverted Slope',
    kind: 'slope',
    // LDraw 3660.dat: Slope Brick 45 2 x 2 Inverted.
    footprint: legoPlateFootprint(2, 2, 3),
    connectors: [...makeStudGrid('inverted-slope-2x2', 2, 2, 3), ...makeTubeGrid('inverted-slope-2x2', 2, 2, 0)],
    colors: ['white', 'red', 'blue', 'yellow', 'green', 'black', 'gray'],
    inventory: 24,
  },
  {
    id: 'headlight-brick-1x1',
    partNumber: '4070',
    name: '1x1 Headlight Brick',
    kind: 'brick',
    // LDraw 4070.dat: Brick 1 x 1 with Headlight. The side stud is recessed from
    // the front edge and sits slightly above the vertical center of a normal brick.
    footprint: legoPlateFootprint(1, 1, 3),
    connectors: [
      ...makeStudGrid('headlight-brick-1x1', 1, 1, 3),
      ...makeTubeGrid('headlight-brick-1x1', 1, 1, 0),
      makeSideStud('headlight-brick-1x1', 0, 1.75, 0, 'z', { x: 0, y: 0, z: -1 }),
    ],
    colors: ['white', 'black', 'gray', 'cyan', 'red', 'blue', 'yellow'],
    inventory: 36,
  },
  {
    id: 'cone-2x2',
    partNumber: '3942',
    name: '2x2x2 Cone',
    kind: 'cone',
    // BrickLink 3942: Cone 2 x 2 x 2. It is two bricks tall and tapers to a single top stud.
    footprint: legoPlateFootprint(2, 2, 6),
    connectors: [
      {
        id: 'cone-2x2-stud-center',
        kind: 'stud',
        gender: 'male',
        axis: 'y',
        pose: { xStud: 0.5, yStud: plateHeightToWorldStud(6), zStud: 0.5 },
      },
      ...makeTubeGrid('cone-2x2', 2, 2, 0),
    ],
    colors: ['red', 'blue', 'yellow', 'white', 'black', 'gray', 'orange'],
    inventory: 18,
  },
  ...classic10696ExtraDefinitions,
]

export const brickDefinitions: BrickDefinition[] = fallbackBrickDefinitions
  .map(withLDrawConnectors)
  .map(withOfficialColors)
  .map(withDefaultPack)
  .map(withUnlimitedInventory)

export const brickById = new Map(brickDefinitions.map((brick) => [brick.id, brick]))

export const getDefaultBrickColor = (definition: BrickDefinition): BrickColor => (
  definition.pack === 'lego' && definition.colors.includes('gray')
    ? 'gray'
    : definition.colors[0]
)
