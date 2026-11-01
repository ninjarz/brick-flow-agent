import type { BrickDefinition } from '../types/bricks'
import { legoPlateFootprint } from '../lib/brickUnits'

// Official 71043, booklet 1, page 19. Each boat uses these parts individually.
export const hogwartsBricks: Omit<BrickDefinition, 'pack'>[] = [
  { id: 'tile-round-1x1-plain', partNumber: '98138', name: '1x1 Round Tile', kind: 'tile', footprint: legoPlateFootprint(1, 1, 1), connectors: [], colors: ['tan'], inventory: 15 },
  { id: 'plate-3x2-hole', partNumber: '3176', name: '3x2 Plate with Hole', kind: 'plate', footprint: legoPlateFootprint(2, 3, 1), connectors: [], colors: ['reddish-brown'], inventory: 5 },
  { id: 'wing-4x4-cutout', partNumber: '43719', name: '4x4 Wing with 2x2 Cutout', kind: 'plate', footprint: legoPlateFootprint(4, 4, 1), connectors: [], colors: ['dark-blue'], inventory: 5 },
  { id: 'bar-3l', partNumber: '87994', name: '3L Bar', kind: 'round', footprint: { widthStuds: 0.4, depthStuds: 0.4, heightStuds: 3 }, connectors: [], colors: ['black'], inventory: 5 },
  { id: 'plate-round-open-stud-1x1', partNumber: '85861', name: '1x1 Round Plate with Open Stud', kind: 'plate', footprint: legoPlateFootprint(1, 1, 1), connectors: [], colors: ['black', 'trans-blue'], inventory: 10 },
]
