import { beforeAll, describe, expect, it } from 'vitest'
import { brickById } from '../data/basicBricks'
import type { PlacedBrick, BrickPose } from '../types/bricks'
import { transformBrickLocalPoint } from './brickUnits'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { createBuildGraph, getBrickPlacementDiagnostics, getBrickBounds, isBrickSupported } from './planUtils'

const wedge: PlacedBrick = { id:'wedge',brickId:'hogwarts-ldraw-50305',color:'lego-28',pose:{xStud:0,yStud:0,zStud:0,rotationQuarterTurns:0,orientationMatrix:[-1,0,0,0,1,0,0,0,1]} }
const pin: PlacedBrick = { id:'pin',brickId:'brick-pin-1x2',color:'lego-72',pose:{xStud:2.5,yStud:.4,zStud:3,rotationQuarterTurns:0,orientationMatrix:[0,0,-1,0,1,0,-1,0,0]} }

function rotateAroundZ(brick: PlacedBrick, angle: number): PlacedBrick {
  const c=Math.cos(angle),s=Math.sin(angle),m=brick.pose.orientationMatrix!
  const matrix: NonNullable<BrickPose['orientationMatrix']> = [c*m[0]-s*m[3],c*m[1]-s*m[4],c*m[2]-s*m[5],s*m[0]+c*m[3],s*m[1]+c*m[4],s*m[2]+c*m[5],m[6],m[7],m[8]]
  const definition=brickById.get(brick.brickId)!
  const origin=transformBrickLocalPoint(definition,brick.pose,{x:0,y:0,z:0})
  const pose={...brick.pose,xStud:0,yStud:0,zStud:0,orientationMatrix:matrix}
  const anchor=transformBrickLocalPoint(definition,pose,{x:0,y:0,z:0})
  return {...brick,pose:{...pose,xStud:c*origin.x-s*origin.y-anchor.x,yStud:s*origin.x+c*origin.y-anchor.y,zStud:origin.z-anchor.z}}
}

describe('mechanical brick underside connections', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['2458','50305']) })
  it('connects the two studs underneath the pin brick to the wedge plate', () => {
    expect(createBuildGraph([wedge,pin]).components).toHaveLength(1)
    const offset={...pin,pose:{...pin.pose,xStud:3}}
    expect(createBuildGraph([wedge,offset]).components).toHaveLength(2)
  })
  it('retains the clutch near a 45 degree direction tie and rejects crossed interfaces', () => {
    const angledWedge=rotateAroundZ(wedge,Math.PI/4+1e-9)
    const angledPin=rotateAroundZ(pin,Math.PI/4-1e-9)
    expect(createBuildGraph([angledWedge,angledPin]).components).toHaveLength(1)
    const crossed=rotateAroundZ(pin,Math.PI/2)
    expect(createBuildGraph([angledWedge,crossed]).components).toHaveLength(2)
  })
})

const chamberClipAndSnake: PlacedBrick[] = [{"id":"hogwarts-reference-985","brickId":"hogwarts-ldraw-15712","color":"lego-71","pose":{"xStud":24.301619,"yStud":2.801268,"zStud":14.301601,"rotationQuarterTurns":0,"orientationMatrix":[0.8090169522230046,0,0.5877853103096408,0,1,0,0.5877853103096408,0,-0.8090169522230046]}},{"id":"hogwarts-reference-6","brickId":"hogwarts-ldraw-38801","color":"lego-378","pose":{"xStud":24.09837,"yStud":3.292018,"zStud":14.479902,"rotationQuarterTurns":0,"orientationMatrix":[6.123233995736766e-17,0,-1,0,1,0,-1,0,-6.123233995736766e-17]}}]

describe('large snake bar connection', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['15712','38801']) })
  it('clamps the raised-head snake at the actual tail bar and rejects an offset', () => {
    expect(createBuildGraph(chamberClipAndSnake).components).toHaveLength(1)
    const [clip,snake] = structuredClone(chamberClipAndSnake)
    snake.pose.xStud += 1
    expect(createBuildGraph([clip,snake]).components).toHaveLength(2)
  })
})

const serpentDoorBarAndDisc: PlacedBrick[] = [{"id":"hogwarts-reference-3133","brickId":"hogwarts-ldraw-88072","color":"lego-0","pose":{"xStud":39.346978,"yStud":1.02627,"zStud":25.916043,"rotationQuarterTurns":0,"orientationMatrix":[0.801776,0.597625,0,0,0,-1,0.597625,-0.801776,0]}},{"id":"hogwarts-reference-3144","brickId":"hogwarts-ldraw-2723pbf71043s27","color":"lego-0","pose":{"xStud":39.244906,"yStud":1.026271,"zStud":25.777588,"rotationQuarterTurns":0,"orientationMatrix":[-0.801776,0.597625,0,0,0,1,-0.597625,-0.801776,0]}}]

describe('serpent door disc connection', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['88072','2723pbf71043s27']) })
  it('fits the 3.18 mm bar inside the real axle bore and rejects a lateral offset', () => {
    expect(createBuildGraph(serpentDoorBarAndDisc).components).toHaveLength(1)
    const [bar,disc] = structuredClone(serpentDoorBarAndDisc)
    disc.pose.yStud += .5
    expect(createBuildGraph([bar,disc]).components).toHaveLength(2)
  })
})

const hollowStudAndSnake: PlacedBrick[] = [{"id":"hogwarts-reference-1041","brickId":"headlight-brick-1x1","color":"lego-72","pose":{"xStud":27.999993,"yStud":2.401268,"zStud":10.000028,"rotationQuarterTurns":0,"orientationMatrix":[1,0,0,0,1,0,0,0,-1]}},{"id":"hogwarts-reference-2878","brickId":"hogwarts-ldraw-28588","color":"lego-72","pose":{"xStud":28.222243,"yStud":2.835618,"zStud":10.622527,"rotationQuarterTurns":0,"orientationMatrix":[1,0,0,0,1,0,0,0,-1]}}]

describe('headlight hollow side stud', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['4070','28588']) })
  it('accepts a snake neck bar in the side bore and rejects a transverse offset', () => {
    expect(createBuildGraph(hollowStudAndSnake).components).toHaveLength(1)
    const [headlight,snake] = structuredClone(hollowStudAndSnake)
    snake.pose.xStud += .5
    expect(createBuildGraph([headlight,snake]).components).toHaveLength(2)
  })
})

const roundPlateAndMacaroni: PlacedBrick[] = [{"id":"hogwarts-reference-611","brickId":"hogwarts-ldraw-60474","color":"lego-28","pose":{"xStud":31.00004,"yStud":2.801253,"zStud":42.000022,"rotationQuarterTurns":0,"orientationMatrix":[1,0,0,0,1,0,0,0,-1]}},{"id":"hogwarts-reference-615","brickId":"brick-round-corner-2x2","color":"lego-19","pose":{"xStud":33.000031,"yStud":3.201268,"zStud":44.000027,"rotationQuarterTurns":0,"orientationMatrix":[1,0,0,0,1,0,0,0,-1]}}]

describe('macaroni brick underside seats', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['60474','85080']) })
  it('connects both real underside seats to the round plate and rejects a half-stud offset', () => {
    expect(createBuildGraph(roundPlateAndMacaroni).components).toHaveLength(1)
    const [plate,macaroni] = structuredClone(roundPlateAndMacaroni)
    macaroni.pose.xStud += .5
    expect(createBuildGraph([plate,macaroni]).components).toHaveLength(2)
  })
})

const chairBracketAndSilverTooth: PlacedBrick[] = [{"id":"hogwarts-reference-907","brickId":"hogwarts-ldraw-42446","color":"lego-70","pose":{"xStud":25.500012,"yStud":11.603772,"zStud":7.649997,"rotationQuarterTurns":0,"orientationMatrix":[1,0,0,0,-1,0,0,0,1]}},{"id":"hogwarts-reference-908","brickId":"plate-tooth-1x1","color":"lego-179","pose":{"xStud":25.500014,"yStud":12.253771,"zStud":7.449994,"rotationQuarterTurns":0,"orientationMatrix":[1,0,0,0,0,-1,0,-1,0]}}]

describe('upright tooth underside socket', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['42446','49668']) })
  it('seats on the sideways bracket stud without using the tooth bounding box as a socket', () => {
    expect(createBuildGraph(chairBracketAndSilverTooth).components).toHaveLength(1)
    const [bracket,tooth] = structuredClone(chairBracketAndSilverTooth)
    tooth.pose.yStud += .5
    expect(createBuildGraph([bracket,tooth]).components).toHaveLength(2)
  })
})

const torchCupAndFlame: PlacedBrick[] = [{"id":"hogwarts-reference-2913","brickId":"hogwarts-ldraw-20482","color":"lego-297","pose":{"xStud":22.000011,"yStud":13.601268,"zStud":22.000008,"rotationQuarterTurns":0,"orientationMatrix":[-1,0,0,0,-1,0,0,0,-1]}},{"id":"hogwarts-reference-2914","brickId":"hogwarts-ldraw-37775","color":"lego-57","pose":{"xStud":22.300011,"yStud":13.888769,"zStud":22.140007,"rotationQuarterTurns":0,"orientationMatrix":[1,0,0,0,1,0,0,0,-1]}}]

describe('torch cup pin bore', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['20482','37775']) })
  it('accepts the flame stem inside its actual bore and rejects a lateral offset', () => {
    expect(createBuildGraph(torchCupAndFlame).components).toHaveLength(1)
    const [cup,flame] = structuredClone(torchCupAndFlame)
    flame.pose.xStud += .25
    expect(createBuildGraph([cup,flame]).components).toHaveLength(2)
  })
})

const windowFrameAndPrintedGlass: PlacedBrick[] = [{"id":"hogwarts-reference-455","brickId":"hogwarts-ldraw-90195","color":"lego-19","pose":{"xStud":30.000041,"yStud":10.403773,"zStud":38.000017,"rotationQuarterTurns":0,"orientationMatrix":[0,0,-1,0,1,0,-1,0,0]}},{"id":"hogwarts-reference-496","brickId":"hogwarts-ldraw-60601p01","color":"lego-47","pose":{"xStud":30.675017,"yStud":10.753773,"zStud":38.155338,"rotationQuarterTurns":0,"orientationMatrix":[0,0,1,0,1,0,1,0,0]}}]

describe('printed window pane source frame', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['90195','60601p01']) })
  it('retains the unprinted pane transform for its four snap seats and rejects a lateral offset', () => {
    expect(createBuildGraph(windowFrameAndPrintedGlass).components).toHaveLength(1)
    const [frame,glass] = structuredClone(windowFrameAndPrintedGlass)
    glass.pose.zStud += .5
    expect(createBuildGraph([frame,glass]).components).toHaveLength(2)
  })
})

const clockPlateAndBracket: PlacedBrick[] = [{"id":"hogwarts-reference-821","brickId":"plate-2x6","color":"lego-28","pose":{"xStud":21.000078,"yStud":20.00377,"zStud":29.000006,"rotationQuarterTurns":0,"orientationMatrix":[1,0,0,0,1,0,0,0,-1]}},{"id":"hogwarts-reference-829","brickId":"bracket-1x2-2x2","color":"lego-0","pose":{"xStud":23.000081,"yStud":18.80377,"zStud":29.500006,"rotationQuarterTurns":0,"orientationMatrix":[1,0,0,0,1,0,0,0,-1]}}]

describe('clock down bracket underside connection', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['3795','44728']) })
  it('seats the top flange on the plate and rejects a half-stud lateral shift', () => {
    expect(createBuildGraph(clockPlateAndBracket).components).toHaveLength(1)
    const [plate,bracket] = structuredClone(clockPlateAndBracket)
    bracket.pose.xStud += .5
    expect(createBuildGraph([plate,bracket]).components).toHaveLength(2)
  })
})

const headlightAntennaAndFlag: PlacedBrick[] = [{"id": "hogwarts-reference-2182", "brickId": "headlight-brick-1x1", "color": "lego-47", "pose": {"xStud": 21.000007, "yStud": 20.001268, "zStud": 24.000022, "rotationQuarterTurns": 0, "orientationMatrix": [0, 0, -1, 0, 1, 0, -1, 0, 0]}}, {"id": "hogwarts-reference-3234", "brickId": "antenna-4h", "color": "lego-47", "pose": {"xStud": 21.047517, "yStud": 20.201273, "zStud": 24.000005, "rotationQuarterTurns": 0, "orientationMatrix": [0, -1, 0, 1, 0, 0, 0, 0, -1]}}, {"id": "hogwarts-reference-3235", "brickId": "hogwarts-ldraw-30350bpbf71043s56", "color": "lego-0", "pose": {"xStud": 23.522518, "yStud": 17.200574, "zStud": 24.11352, "rotationQuarterTurns": 0, "orientationMatrix": [1, 0, 0, 0, 0, 1, 0, 1, 0]}}]

describe('transparent antenna and hanging flag', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['4070','3957b','30350bpbf71043s56']) })
  it('holds the antenna in the side bore and clips the banner onto its shaft', () => {
    expect(createBuildGraph(headlightAntennaAndFlag).components).toHaveLength(1)
    const [headlight,antenna,flag] = structuredClone(headlightAntennaAndFlag)
    flag.pose.yStud += .5
    expect(createBuildGraph([headlight,antenna,flag]).components).toHaveLength(2)
    antenna.pose.zStud += .5
    expect(createBuildGraph([headlight,antenna]).components).toHaveLength(2)
  })
})

const technicBrickAndTooth: PlacedBrick[] = [{"id":"hogwarts-reference-2186","brickId":"technic-brick-1x1-hole","color":"lego-72","pose":{"xStud":20.000009,"yStud":22.001268,"zStud":23.000022,"rotationQuarterTurns":0,"orientationMatrix":[0,0,1,0,1,0,1,0,0]}},{"id":"hogwarts-reference-2195","brickId":"plate-tooth-1x1","color":"lego-179","pose":{"xStud":19.60001,"yStud":22.726269,"zStud":23.000017,"rotationQuarterTurns":0,"orientationMatrix":[0,1,0,0,0,-1,1,0,0]}}]

describe('technic brick side bore stud seat', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['6541','49668']) })
  it('accepts a stud at the mouth of the pin bore and rejects a transverse offset', () => {
    expect(createBuildGraph(technicBrickAndTooth).components).toHaveLength(1)
    const [brick,tooth] = structuredClone(technicBrickAndTooth)
    tooth.pose.yStud += .5
    expect(createBuildGraph([brick,tooth]).components).toHaveLength(2)
  })
})

const towerSideBoreFixtures: PlacedBrick[][] = [[{"id":"hogwarts-reference-2030","brickId":"brick-side-studs-opposite-1x1","color":"lego-15","pose":{"xStud":23.499995,"yStud":28.003765,"zStud":17.000004,"rotationQuarterTurns":0,"orientationMatrix":[0,0,1,0,1,0,1,0,0]}},{"id":"hogwarts-reference-2483","brickId":"hogwarts-ldraw-20482","color":"lego-297","pose":{"xStud":22.88751,"yStud":28.203759,"zStud":16.999985,"rotationQuarterTurns":0,"orientationMatrix":[0,1,0,0,0,-1,1,0,0]}}],[{"id":"hogwarts-reference-2002","brickId":"brick-side-studs-four-1x1","color":"lego-72","pose":{"xStud":23.5,"yStud":32.003761,"zStud":17,"rotationQuarterTurns":0,"orientationMatrix":[0,0,-1,0,1,0,-1,0,0]}},{"id":"hogwarts-reference-2972","brickId":"hogwarts-ldraw-20482","color":"lego-297","pose":{"xStud":23.500009,"yStud":32.20376,"zStud":16.387485,"rotationQuarterTurns":0,"orientationMatrix":[-1,0,0,0,0,-1,0,1,0]}}]]

describe('bars inside opposite and four-sided stud bricks', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['47905','4733','20482']) })
  it.each(towerSideBoreFixtures.map((bricks,index) => ({bricks,index})))('connects the original hollow side stud in fixture $index and rejects a lateral offset', ({bricks}) => {
    expect(createBuildGraph(bricks).components).toHaveLength(1)
    const [body,decoration]=structuredClone(bricks)
    decoration.pose.yStud += .5
    expect(createBuildGraph([body,decoration]).components).toHaveLength(2)
  })
})

const rockPlateAndHalfPin: PlacedBrick[] = [{"id": "hogwarts-reference-3155", "brickId": "hogwarts-ldraw-4274", "color": "lego-1", "pose": {"xStud": 31, "yStud": 1.126272, "zStud": 10.600015, "rotationQuarterTurns": 0, "orientationMatrix": [1, 0, 0, 0, 0, -1, 0, -1, 0]}}, {"id": "hogwarts-reference-3156", "brickId": "plate-1x10", "color": "lego-72", "pose": {"xStud": 32, "yStud": 1.026272, "zStud": 10.000016, "rotationQuarterTurns": 0, "orientationMatrix": [0, 1, 0, 0, 0, 1, -1, 0, 0]}}]
describe('long plate underside on a half pin stud', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['4274','4477']) })
  it('uses stud seats rather than the intervening support posts and rejects a transverse shift', () => {
    expect(createBuildGraph(rockPlateAndHalfPin).components).toHaveLength(1)
    const [pin,plate]=structuredClone(rockPlateAndHalfPin)
    plate.pose.yStud += .5
    expect(getBrickPlacementDiagnostics(pin,[pin,plate]).details[0].hasConnectorConnection).toBe(false)
  })
})

const curvedWallAndWhitePlate: PlacedBrick[] = [{"id": "hogwarts-reference-2376", "brickId": "slope-curved-2x1-low", "color": "lego-19", "pose": {"xStud": 44.370789, "yStud": 36.601268, "zStud": 28.239753, "rotationQuarterTurns": 0, "orientationMatrix": [-0.597625, 0.801776, 0, 0, 0, 1, 0.801776, 0.597625, 0]}}, {"id": "hogwarts-reference-2377", "brickId": "plate-1x1", "color": "lego-15", "pose": {"xStud": 44.370788, "yStud": 36.601274, "zStud": 29.041536, "rotationQuarterTurns": 0, "orientationMatrix": [0.597625, 0.801776, 0, 0, 0, 1, -0.801776, 0.597625, 0]}}]
describe('stepped underside of a low curved slope', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['11477','3024']) })
  it('seats a plate in the raised underside and rejects a half-stud shift', () => {
    expect(createBuildGraph(curvedWallAndWhitePlate).components).toHaveLength(1)
    const [curve,plate] = structuredClone(curvedWallAndWhitePlate)
    plate.pose.yStud += .5
    expect(createBuildGraph([curve,plate]).components).toHaveLength(2)
  })
})

const roofHandleClipFixtures: PlacedBrick[][] = [[{"id": "hogwarts-reference-2733", "brickId": "plate-bar-end-1x2", "color": "lego-70", "pose": {"xStud": 35.144323, "yStud": 46.401263, "zStud": 27.334322, "rotationQuarterTurns": 0, "orientationMatrix": [-0.989943872, 0, 0.141461845, 0, 1, 0, 0.141461845, 0, 0.989943872]}}, {"id": "hogwarts-reference-2736", "brickId": "hogwarts-ldraw-11476", "color": "lego-15", "pose": {"xStud": 34.340649, "yStud": 47.111728, "zStud": 27.09245, "rotationQuarterTurns": 0, "orientationMatrix": [0.141462845, -0.964477955, 0.223094582, 0, 0.225363, 0.974275, 0.989943875, 0.137818351, -0.031899531]}}], [{"id": "hogwarts-reference-2745", "brickId": "plate-bar-end-1x2", "color": "lego-70", "pose": {"xStud": 40.134283, "yStud": 46.401263, "zStud": 30.33434, "rotationQuarterTurns": 0, "orientationMatrix": [0.141420827, 0, 0.989949751, 0, 1, 0, 0.989949751, 0, -0.141420827]}}, {"id": "hogwarts-reference-2749", "brickId": "hogwarts-ldraw-11476", "color": "lego-15", "pose": {"xStud": 39.892331, "yStud": 47.11167, "zStud": 32.034881, "rotationQuarterTurns": 0, "orientationMatrix": [0.989949754, 0.13777941, -0.031886205, 0, 0.225471, 0.97425, -0.141421827, 0.96445784, -0.223204543]}}]]
describe('roof strip clips on original plate handle axes', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['60478','11476']) })
  it.each(roofHandleClipFixtures.map((bricks,index) => ({bricks,index})))('connects the original handle in fixture $index and rejects a transverse shift', ({bricks}) => {
    expect(createBuildGraph(bricks).components).toHaveLength(1)
    const shifted = structuredClone(bricks)
    shifted[1].pose.yStud += .5
    expect(createBuildGraph(shifted).components).toHaveLength(2)
  })
})

const clippedTailGroundFixture: PlacedBrick[] = [{"id": "hogwarts-reference-1710", "brickId": "hogwarts-ldraw-15712", "color": "lego-297", "pose": {"xStud": 41.000004, "yStud": 42.801268, "zStud": 24.700021, "rotationQuarterTurns": 0, "orientationMatrix": [-0.600000118, 0, 0.800000158, 0, 1, 0, 0.800000158, 0, 0.600000118]}}, {"id": "hogwarts-reference-1711", "brickId": "plate-clip-open-1x1", "color": "lego-297", "pose": {"xStud": 41.300004, "yStud": 42.328871, "zStud": 24.300019, "rotationQuarterTurns": 0, "orientationMatrix": [-0.800000158, 0, -0.600000118, 0, 1, 0, -0.600000118, 0, 0.800000158]}}, {"id": "hogwarts-reference-1712", "brickId": "hogwarts-ldraw-6141", "color": "lego-297", "pose": {"xStud": 41.000009, "yStud": 42.001268, "zStud": 24.700022, "rotationQuarterTurns": 0, "orientationMatrix": [-0.600000118, 0, 0.800000158, 0, 1, 0, 0.800000158, 0, 0.600000118]}}, {"id": "hogwarts-reference-1713", "brickId": "brick-side-studs-four-1x1", "color": "lego-70", "pose": {"xStud": 41.000009, "yStud": 40.801268, "zStud": 24.700022, "rotationQuarterTurns": 0, "orientationMatrix": [-0.600000118, 0, 0.800000158, 0, 1, 0, 0.800000158, 0, 0.600000118]}}, {"id": "hogwarts-reference-1714", "brickId": "hogwarts-ldraw-15712", "color": "lego-297", "pose": {"xStud": 40.28001, "yStud": 41.001268, "zStud": 24.160021, "rotationQuarterTurns": 0, "orientationMatrix": [0.600000118, -0.800000158, 0, 0, 0, -1, -0.800000158, -0.600000118, 0]}}, {"id": "hogwarts-reference-1715", "brickId": "hogwarts-ldraw-26047", "color": "lego-297", "pose": {"xStud": 41.600006, "yStud": 41.001268, "zStud": 24.380024, "rotationQuarterTurns": 0, "orientationMatrix": [-0.800000158, 0.600000118, 0, 0, 0, 1, -0.600000118, -0.800000158, 0]}}, {"id": "hogwarts-reference-1716", "brickId": "hogwarts-ldraw-15712", "color": "lego-297", "pose": {"xStud": 41.800007, "yStud": 41.001268, "zStud": 25.300026, "rotationQuarterTurns": 0, "orientationMatrix": [-0.600000118, 0.800000158, 0, 0, 0, -1, 0.800000158, 0.600000118, 0]}}, {"id": "hogwarts-reference-1717", "brickId": "plate-1x1", "color": "lego-297", "pose": {"xStud": 41.000013, "yStud": 40.401268, "zStud": 24.700018, "rotationQuarterTurns": 0, "orientationMatrix": [-0.800000158, 0, -0.600000118, 0, 1, 0, -0.600000118, 0, 0.800000158]}}, {"id": "hogwarts-reference-2861", "brickId": "hogwarts-ldraw-26047", "color": "lego-297", "pose": {"xStud": 41.001213, "yStud": 41.001268, "zStud": 23.491767, "rotationQuarterTurns": 0, "orientationMatrix": [0, -0.752436974, 0.658664323, 1, 0, 0, 0, -0.658664323, -0.752436974]}}, {"id": "hogwarts-reference-2862", "brickId": "hogwarts-ldraw-15070", "color": "lego-297", "pose": {"xStud": 40.700231, "yStud": 41.001268, "zStud": 23.228305, "rotationQuarterTurns": 0, "orientationMatrix": [0, -0.752436974, -0.658664323, -1, 0, 0, 0, -0.658664323, 0.752436974]}}, {"id": "hogwarts-reference-2863", "brickId": "hogwarts-ldraw-26047", "color": "lego-297", "pose": {"xStud": 42.684285, "yStud": 41.001268, "zStud": 24.704717, "rotationQuarterTurns": 0, "orientationMatrix": [0, 0.827787816, 0.561041354, -1, 0, 0, 0, 0.561041354, -0.827787816]}}, {"id": "hogwarts-reference-2864", "brickId": "hogwarts-ldraw-15070", "color": "lego-297", "pose": {"xStud": 42.353174, "yStud": 41.001268, "zStud": 24.480302, "rotationQuarterTurns": 0, "orientationMatrix": [0, 0.827787816, -0.561041354, 1, 0, 0, 0, 0.561041354, 0.827787816]}}]
describe('ground contact at a clipped curved element tip', () => {
 beforeAll(async () => { await loadLDrawGeneratedVisual(['15712','26047','3024','4733','6141','61252','15070']) })
 it('supports the connected clip when the curved tip rests on the table', () => {
  const bricks=structuredClone(clippedTailGroundFixture)
  const ground=Math.min(...bricks.map(b=>getBrickBounds(b)!.minY))
  for(const b of bricks)b.pose.yStud-=ground
  const graph=createBuildGraph(bricks)
  expect(graph.components).toHaveLength(1)
  expect(bricks.every(b=>isBrickSupported(b,bricks,graph))).toBe(true)
  for(const b of bricks)b.pose.yStud+=.2
  const lifted=createBuildGraph(bricks)
  expect(bricks.every(b=>!isBrickSupported(b,bricks,lifted))).toBe(true)
 })
})

const midRailHalfPinFixture: PlacedBrick[] = [{"id": "hogwarts-reference-5704", "brickId": "hogwarts-ldraw-4274", "color": "lego-1", "pose": {"xStud": 63.90767, "yStud": 1.126274, "zStud": 68.584112, "rotationQuarterTurns": 0, "orientationMatrix": [0.801775, 0.597625, 0, 0, 0, -1, 0.597624, -0.801775, 0]}}, {"id": "hogwarts-reference-5706", "brickId": "plate-1x6", "color": "lego-72", "pose": {"xStud": 61.960365, "yStud": 1.026274, "zStud": 68.700669, "rotationQuarterTurns": 0, "orientationMatrix": [-0.597625, 0.801776, 0, 0, 0, -1, 0.801776, 0.597625, 0]}}]
describe('six-stud side rail on a hollow half pin',()=>{
 beforeAll(async()=>{await loadLDrawGeneratedVisual(['3666','4274'])})
 it('clutches the source underside post inside the hollow stud and rejects a transverse shift',()=>{
  expect(createBuildGraph(midRailHalfPinFixture).components).toHaveLength(1)
  const shifted=structuredClone(midRailHalfPinFixture)
  shifted[1].pose.yStud+=.5
  expect(createBuildGraph(shifted).components).toHaveLength(2)
 })
})

const gobletRimFixture: PlacedBrick[] = [{"id": "hogwarts-reference-5694", "brickId": "hogwarts-ldraw-2343", "color": "lego-71", "pose": {"xStud": 55.371692, "yStud": 2.402521, "zStud": 76.529094, "rotationQuarterTurns": 0, "orientationMatrix": [-0.597625, 0, 0.801776, 0, 1, 0, 0.801776, 0, 0.597625]}}, {"id": "hogwarts-reference-5693", "brickId": "hogwarts-ldraw-6141", "color": "lego-43", "pose": {"xStud": 55.371692, "yStud": 4.152521, "zStud": 76.529094, "rotationQuarterTurns": 0, "orientationMatrix": [-0.597625, 0, 0.801776, 0, 1, 0, 0.801776, 0, 0.597625]}}]
describe("gobletRim",()=>{
 beforeAll(async()=>{await loadLDrawGeneratedVisual(["6269", "6141"])})
 it('connects at the manual position and rejects a transverse half-stud offset',()=>{
  expect(createBuildGraph(gobletRimFixture).components).toHaveLength(1)
  const shifted=structuredClone(gobletRimFixture)
  shifted[0].pose.xStud+=.5
  expect(createBuildGraph(shifted).components).toHaveLength(2)
 })
})

const whiteFlaskFixture: PlacedBrick[] = [{"id": "hogwarts-reference-manual72", "brickId": "hogwarts-ldraw-93549pat0002", "color": "lego-47", "pose": {"xStud": 66.402886, "yStud": 2.401268, "zStud": 59.895954, "rotationQuarterTurns": 0, "orientationMatrix": [-0.597625, 0, 0.801776, 0, 1, 0, 0.801776, 0, 0.597625]}}, {"id": "hogwarts-reference-4470", "brickId": "hogwarts-ldraw-3456", "color": "lego-71", "pose": {"xStud": 59.540231, "yStud": 2.000019, "zStud": 55.493597, "rotationQuarterTurns": 0, "orientationMatrix": [-0.597625, 0, 0.801776, 0, 1, 0, 0.801776, 0, 0.597625]}}]
describe("whiteFlask",()=>{
 beforeAll(async()=>{await loadLDrawGeneratedVisual(["93549pat0002", "3456"])})
 it('connects at the manual position and rejects a transverse half-stud offset',()=>{
  expect(createBuildGraph(whiteFlaskFixture).components).toHaveLength(1)
  const shifted=structuredClone(whiteFlaskFixture)
  shifted[0].pose.xStud+=.5
  expect(createBuildGraph(shifted).components).toHaveLength(2)
 })
})


const cauldronFloorFixture: PlacedBrick[] = [{"id": "hogwarts-reference-4470", "brickId": "hogwarts-ldraw-3456", "color": "lego-71", "pose": {"xStud": 59.540231, "yStud": 2.000019, "zStud": 55.493597, "rotationQuarterTurns": 0, "orientationMatrix": [-0.597625, 0, 0.801776, 0, 1, 0, 0.801776, 0, 0.597625]}}, {"id": "hogwarts-reference-5667", "brickId": "hogwarts-ldraw-98374", "color": "lego-316", "pose": {"xStud": 63.50941, "yStud": 2.400019, "zStud": 61.703655, "rotationQuarterTurns": 0, "orientationMatrix": [-0.597625, 0, 0.801776, 0, 1, 0, 0.801776, 0, 0.597625]}}]
describe('imported loose cauldron resting on a floor',()=>{
 beforeAll(async()=>{await loadLDrawGeneratedVisual(['3456','98374'])})
 it('supports the resting pot and rejects lifted or displaced bodies',()=>{
  expect(isBrickSupported(cauldronFloorFixture[1],cauldronFloorFixture)).toBe(true)
  expect(createBuildGraph(cauldronFloorFixture).components).toHaveLength(1)
  const lifted=structuredClone(cauldronFloorFixture)
  lifted[1].pose.yStud+=.02
  expect(createBuildGraph(lifted).components).toHaveLength(2)
  const displaced=structuredClone(cauldronFloorFixture)
  displaced[1].pose.xStud+=30
  expect(createBuildGraph(displaced).components).toHaveLength(2)
 })
})

const floorFlameFixtures: PlacedBrick[][] = [[{"id":"hogwarts-reference-3392","brickId":"plate-round-open-stud-1x1","color":"lego-57","pose":{"xStud":60.676166,"yStud":2.401273,"zStud":44.313225,"rotationQuarterTurns":0,"orientationMatrix":[-0.597625,0,0.801776,0,1,0,0.801776,0,0.597625]}},{"id":"hogwarts-reference-3385","brickId":"hogwarts-ldraw-64647","color":"lego-57","pose":{"xStud":61.002944,"yStud":2.663773,"zStud":44.680703,"rotationQuarterTurns":0,"orientationMatrix":[-0.507654,0,0.861561,0,1,0,0.861561,0,0.507654]}}],[{"id":"hogwarts-reference-3265","brickId":"plate-round-open-stud-1x1","color":"lego-57","pose":{"xStud":61.084473,"yStud":2.401273,"zStud":47.112027,"rotationQuarterTurns":0,"orientationMatrix":[-0.597625,0,0.801776,0,1,0,0.801776,0,0.597625]}},{"id":"hogwarts-reference-3264","brickId":"hogwarts-ldraw-64647","color":"lego-57","pose":{"xStud":61.425581,"yStud":2.663773,"zStud":46.612527,"rotationQuarterTurns":0,"orientationMatrix":[0.748467,0,0.663171,0,1,0,0.663171,0,-0.748468]}}]]
describe('floor flame accessory stem', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['64647','85861','6141']) })
  it('seats each narrow flame stem in its hollow stud and rejects a lateral offset', () => {
    for (const fixture of floorFlameFixtures) {
      expect(createBuildGraph(fixture).components).toHaveLength(1)
      const [socket,flame] = structuredClone(fixture)
      flame.pose.xStud += .25
      expect(createBuildGraph([socket,flame]).components).toHaveLength(2)
    }
  })
  it('does not treat the closed stud as an accessory socket', () => {
    const [socket,flame] = structuredClone(floorFlameFixtures[0])
    socket.brickId = [...brickById.values()].find(b => b.partNumber === '6141')!.id
    expect(createBuildGraph([socket,flame]).components).toHaveLength(2)
  })
})

const quarterPlateRoundSeats: PlacedBrick[][] = [[{"id":"hogwarts-reference-4890","brickId":"hogwarts-ldraw-30565","color":"lego-28","pose":{"xStud":54.276776,"yStud":22.001268,"zStud":42.126923,"rotationQuarterTurns":0,"orientationMatrix":[0.801776,0,0.597625,0,1,0,0.597625,0,-0.801776]}},{"id":"hogwarts-reference-4872","brickId":"hogwarts-ldraw-6141","color":"lego-71","pose":{"xStud":56.981165,"yStud":22.401257,"zStud":43.431895,"rotationQuarterTurns":0,"orientationMatrix":[0.546916,0,-0.837187,0,1,0,-0.837187,0,-0.546916]}}],[{"id":"hogwarts-reference-4890","brickId":"hogwarts-ldraw-30565","color":"lego-28","pose":{"xStud":54.276776,"yStud":22.001268,"zStud":42.126923,"rotationQuarterTurns":0,"orientationMatrix":[0.801776,0,0.597625,0,1,0,0.597625,0,-0.801776]}},{"id":"hogwarts-reference-4898","brickId":"hogwarts-ldraw-6141","color":"lego-71","pose":{"xStud":55.574114,"yStud":22.40126,"zStud":43.628403,"rotationQuarterTurns":0,"orientationMatrix":[0.597625,0,-0.801776,0,1,0,-0.801776,0,-0.597625]}}],[{"id":"hogwarts-reference-4932","brickId":"hogwarts-ldraw-30565","color":"lego-28","pose":{"xStud":51.069681,"yStud":22.00126,"zStud":39.736419,"rotationQuarterTurns":0,"orientationMatrix":[-0.597625,0,0.801776,0,1,0,0.801776,0,0.597625]}},{"id":"hogwarts-reference-4921","brickId":"hogwarts-ldraw-6141","color":"lego-71","pose":{"xStud":53.766405,"yStud":22.401257,"zStud":41.033741,"rotationQuarterTurns":0,"orientationMatrix":[0.801776,0,0.597625,0,1,0,0.597625,0,-0.801776]}}]]
describe('round plate four-stud friction seats', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['30565','6141']) })
  it('supports the three round roof feet in complete quarter-plate stud squares', () => {
    for (const pair of quarterPlateRoundSeats) expect(createBuildGraph(pair).components).toHaveLength(1)
  })
  it('rejects a round foot lifted above the four studs', () => {
    for (const fixture of quarterPlateRoundSeats) {
      const pair=structuredClone(fixture); pair[1].pose.yStud+=.3
      expect(createBuildGraph(pair).components).toHaveLength(2)
    }
  })
  it('does not invent this seat for square 1x1 plates', () => {
    const ordinary=brickById.get('plate-1x1')!
    expect(ordinary.connectors.some(c=>c.interfaceType==='round-plate-four-stud-seat')).toBe(false)
  })
})

const spireBarSeats: PlacedBrick[][] = [[{"id":"hogwarts-reference-4177","brickId":"brick-round-2x2-axle","color":"lego-31","pose":{"xStud":67.921819,"yStud":24.401268,"zStud":58.890045,"rotationQuarterTurns":0,"orientationMatrix":[0.597625,0,-0.801776,0,1,0,-0.801776,0,-0.597625]}},{"id":"hogwarts-reference-5601","brickId":"hogwarts-ldraw-63965","color":"lego-0","pose":{"xStud":68.901393,"yStud":24.088769,"zStud":59.869622,"rotationQuarterTurns":0,"orientationMatrix":[-0.597625,0,-0.801776,0,-1,0,0.801776,0,-0.597625]}}],[{"id":"hogwarts-reference-4343","brickId":"brick-round-2x2-axle","color":"lego-31","pose":{"xStud":54.176444,"yStud":24.400011,"zStud":77.330864,"rotationQuarterTurns":0,"orientationMatrix":[0.597625,0,-0.801776,0,1,0,-0.801776,0,-0.597625]}},{"id":"hogwarts-reference-5655","brickId":"hogwarts-ldraw-63965","color":"lego-0","pose":{"xStud":55.156014,"yStud":24.087511,"zStud":78.310448,"rotationQuarterTurns":0,"orientationMatrix":[-0.597625,0,-0.801776,0,-1,0,0.801776,0,-0.597625]}}]]
describe('spire bar in round brick axle bore', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['6143','63965']) })
  it('connects both manual325 spire bars to the round brick beneath the round plate', () => {
    for (const pair of spireBarSeats) expect(createBuildGraph(pair).components).toHaveLength(1)
  })
  it('rejects a bar shifted sideways or lifted completely out of the bore', () => {
    for (const fixture of spireBarSeats) {
      const side=structuredClone(fixture); side[1].pose.xStud+=.5
      expect(createBuildGraph(side).components).toHaveLength(2)
      const lifted=structuredClone(fixture); lifted[1].pose.yStud+=8
      expect(createBuildGraph(lifted).components).toHaveLength(2)
    }
  })
})

const wingDishFixture: PlacedBrick[] = [{"id":"hogwarts-reference-4866","brickId":"hogwarts-ldraw-51739","color":"lego-28","pose":{"xStud":56.258968,"yStud":23.201268,"zStud":37.72456,"rotationQuarterTurns":0,"orientationMatrix":[-0.801776,0,-0.597625,0,1,0,-0.597625,0,0.801776]}},{"id":"hogwarts-reference-3301","brickId":"dish-3x3","color":"lego-26","pose":{"xStud":56.36104,"yStud":22.401268,"zStud":37.622481,"rotationQuarterTurns":0,"orientationMatrix":[-0.597625,0,0.801776,0,1,0,0.801776,0,0.597625]}}]
describe('wing underside center tube', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['51739','43898']) })
  it('seats the book4 p47 lamp dish stud in the wing central tube', () => {
    expect(createBuildGraph(wingDishFixture).components).toHaveLength(1)
  })
  it('rejects a dish moved beyond the wing sockets or lifted out of the tube', () => {
    const sideways=structuredClone(wingDishFixture); sideways[1].pose.xStud+=3
    expect(createBuildGraph(sideways).components).toHaveLength(2)
    // Withdraw below the wing, completely beyond its alternative stud sockets.
    const lifted=structuredClone(wingDishFixture); lifted[1].pose.yStud-=2
    expect(createBuildGraph(lifted).components).toHaveLength(2)
  })
})
