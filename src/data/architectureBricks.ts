import type { BrickConnector, BrickDefinition } from '../types/bricks'
import { legoPlateFootprint } from '../lib/brickUnits'

type Definition = Omit<BrickDefinition, 'pack'>

const bottomSockets = (id: string, width: number, depth: number): BrickConnector[] =>
  Array.from({ length: width }, (_, xStud) => Array.from({ length: depth }, (_, zStud) => ({
    id: `${id}-tube-${xStud}-${zStud}`, kind: 'tube' as const, gender: 'female' as const, axis: 'y' as const,
    direction: { x: 0, y: -1, z: 0 }, pose: { xStud, yStud: 0, zStud },
  }))).flat()

// Additional catalogue parts used by Architecture 21013; geometry and sockets come from LDraw.
export const architectureBricks: Definition[] = [
  { id: 'plate-6x10', partNumber: '3033', name: '6x10 Plate', kind: 'plate', footprint: legoPlateFootprint(10, 6, 1), connectors: [], colors: ['black'], inventory: 16 },
  { id: 'tile-1x8', partNumber: '4162', name: '1x8 Tile', kind: 'tile', footprint: legoPlateFootprint(8, 1, 1), connectors: [], colors: ['black', 'light-gray'], inventory: 16 },
  { id: 'tile-big-ben-nameplate', partNumber: '4162p0g', name: '1x8 Big Ben Nameplate', kind: 'tile', footprint: legoPlateFootprint(8, 1, 1), connectors: [], colors: ['black'], inventory: 1 },
  { id: 'plate-jumper-1x2-3794', partNumber: '3794b', name: '1x2 Jumper Plate', kind: 'plate', footprint: legoPlateFootprint(2, 1, 1), connectors: [], colors: ['light-gray'], inventory: 32 },
  { id: 'brick-side-studs-opposite-1x1', partNumber: '47905', name: '1x1 Brick with Two Opposite Side Studs', kind: 'brick', footprint: legoPlateFootprint(1, 1, 3), connectors: [], colors: ['light-gray'], inventory: 16 },
  { id: 'brick-side-studs-four-1x1', partNumber: '4733', name: '1x1 Brick with Four Side Studs', kind: 'brick', footprint: legoPlateFootprint(1, 1, 3), connectors: [], colors: ['black'], inventory: 16 },
  { id: 'cone-1x1-stop', partNumber: '59900', name: '1x1 Cone with Stop', kind: 'cone', footprint: legoPlateFootprint(1, 1, 3), connectors: [], colors: ['dark-gray'], inventory: 16 },
  { id: 'slope-double-1x2', partNumber: '3044b', name: '1x2 Double Slope', kind: 'slope', footprint: legoPlateFootprint(1, 2, 3), connectors: bottomSockets('double-slope', 1, 2), colors: ['tan'], inventory: 16 },
  { id: 'slope-quadruple-2x2x2', partNumber: '3688', name: '2x2x2 Quadruple Slope', kind: 'slope', footprint: legoPlateFootprint(2, 2, 6), connectors: [], colors: ['dark-gray'], inventory: 16 },
  { id: 'tile-round-clock-2x2', partNumber: '4150p03', name: '2x2 Round Clock Tile', kind: 'tile', footprint: legoPlateFootprint(2, 2, 1), connectors: bottomSockets('clock', 2, 2), colors: ['white'], inventory: 4 },
]
