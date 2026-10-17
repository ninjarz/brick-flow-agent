import type { BrickConnector, BrickDefinition } from '../types/bricks'
import { legoPlateFootprint } from '../lib/brickUnits'

type Definition = Omit<BrickDefinition, 'pack'>

const bottomSockets = (id: string, width: number, depth: number): BrickConnector[] =>
  Array.from({ length: width }, (_, xStud) => Array.from({ length: depth }, (_, zStud) => ({
    id: `${id}-tube-${xStud}-${zStud}`, kind: 'tube' as const, gender: 'female' as const, axis: 'y' as const,
    direction: { x: 0, y: -1, z: 0 }, pose: { xStud, yStud: 0, zStud },
  }))).flat()

// Catalogue parts used by the audited Architecture replicas; geometry and sockets come from LDraw.
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
  { id: 'brick-corner-2x2', partNumber: '2357', name: '2x2 Corner Brick', kind: 'brick', footprint: legoPlateFootprint(2, 2, 3), connectors: [], colors: ['black'], inventory: 32 },
  { id: 'brick-pin-1x2', partNumber: '2458', name: '1x2 Brick with Pin', kind: 'brick', footprint: legoPlateFootprint(2, 1, 3), connectors: [], colors: ['tan'], inventory: 32 },
  { id: 'brick-curved-top-2x2', partNumber: '30165', name: '2x2 Brick with Curved Top', kind: 'brick', footprint: legoPlateFootprint(2, 2, 3), connectors: [], colors: ['black'], inventory: 32 },
  { id: 'plate-6x12', partNumber: '3028', name: '6x12 Plate', kind: 'plate', footprint: legoPlateFootprint(12, 6, 1), connectors: [], colors: ['black'], inventory: 32 },
  { id: 'plate-4x10', partNumber: '3030', name: '4x10 Plate', kind: 'plate', footprint: legoPlateFootprint(10, 4, 1), connectors: [], colors: ['black'], inventory: 32 },
  { id: 'bar-4l', partNumber: '30374', name: '4L Bar', kind: 'round', footprint: legoPlateFootprint(0.4, 0.4, 10), connectors: [], colors: ['tan'], inventory: 32 },
  { id: 'tile-2x2', partNumber: '3068', name: '2x2 Tile', kind: 'tile', footprint: legoPlateFootprint(2, 2, 1), connectors: bottomSockets('tile-2x2', 2, 2), colors: ['tan'], inventory: 32 },
  { id: 'plate-1x8', partNumber: '3460', name: '1x8 Plate', kind: 'plate', footprint: legoPlateFootprint(8, 1, 1), connectors: [], colors: ['light-gray'], inventory: 32 },
  { id: 'plate-jumper-1x2-3794a', partNumber: '3794a', name: '1x2 Jumper Plate without Groove', kind: 'plate', footprint: legoPlateFootprint(2, 1, 1), connectors: [], colors: ['tan', 'light-gray'], inventory: 32 },
  { id: 'plate-2x10', partNumber: '3832', name: '2x10 Plate', kind: 'plate', footprint: legoPlateFootprint(10, 2, 1), connectors: [], colors: ['light-gray'], inventory: 32 },
  { id: 'antenna-4h', partNumber: '3957b', name: '4H Antenna with Flat Top', kind: 'round', footprint: legoPlateFootprint(1, 1, 12), connectors: [], colors: ['white'], inventory: 32 },
  { id: 'tile-sears-nameplate', partNumber: '4162p08', name: '1x8 Sears Tower Nameplate', kind: 'tile', footprint: legoPlateFootprint(8, 1, 1), connectors: bottomSockets('tile-sears-nameplate', 8, 1), colors: ['black'], inventory: 32 },
  { id: 'tile-empire-state-nameplate', partNumber: '4162p0b', name: '1x8 Empire State Building Nameplate', kind: 'tile', footprint: legoPlateFootprint(8, 1, 1), connectors: bottomSockets('tile-empire-state-nameplate', 8, 1), colors: ['black'], inventory: 32 },
  { id: 'plate-1x10', partNumber: '4477', name: '1x10 Plate', kind: 'plate', footprint: legoPlateFootprint(10, 1, 1), connectors: [], colors: ['light-gray'], inventory: 32 },
  { id: 'panel-1x2x1', partNumber: '4865a', name: '1x2x1 Panel with Square Corners', kind: 'brick', footprint: legoPlateFootprint(2, 1, 3), connectors: [], colors: ['light-gray'], inventory: 32 },
  { id: 'plate-1x12', partNumber: '60479', name: '1x12 Plate', kind: 'plate', footprint: legoPlateFootprint(12, 1, 1), connectors: [], colors: ['black'], inventory: 32 },
  { id: 'tile-1x3', partNumber: '63864', name: '1x3 Tile', kind: 'tile', footprint: legoPlateFootprint(3, 1, 1), connectors: bottomSockets('tile-1x3', 3, 1), colors: ['light-gray'], inventory: 32 },
  { id: 'technic-brick-1x1-hole', partNumber: '6541', name: '1x1 Technic Brick with Hole', kind: 'brick', footprint: legoPlateFootprint(1, 1, 3), connectors: [], colors: ['tan'], inventory: 32 },
  { id: 'tile-1x6', partNumber: '6636', name: '1x6 Tile', kind: 'tile', footprint: legoPlateFootprint(6, 1, 1), connectors: bottomSockets('tile-1x6', 6, 1), colors: ['black', 'light-gray', 'tan'], inventory: 32 },
  { id: 'tile-rockefeller-nameplate', partNumber: '6636p01', name: '1x6 Rockefeller Nameplate', kind: 'tile', footprint: legoPlateFootprint(6, 1, 1), connectors: bottomSockets('tile-rockefeller-nameplate', 6, 1), colors: ['black'], inventory: 32 },
  { id: 'tile-center-nameplate', partNumber: '6636p02', name: '1x6 Center Nameplate', kind: 'tile', footprint: legoPlateFootprint(6, 1, 1), connectors: bottomSockets('tile-center-nameplate', 6, 1), colors: ['black'], inventory: 32 },
]
