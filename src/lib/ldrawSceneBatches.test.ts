import { beforeAll, describe, expect, it } from 'vitest'
import { BoxGeometry, Color, DoubleSide, FrontSide, Matrix4, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import { brickById } from '../data/basicBricks'
import { getBrickWorldFrame } from './brickUnits'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { buildLDrawSceneBatches, createLDrawBatchMesh, getLDrawSceneMatrix, getPositiveLDrawGeometry } from './ldrawSceneBatches'
import { createLDrawPrintBatchMesh, mergeLDrawPrintBatches } from './ldrawPrintBatches'
import { makeBrick } from './planUtils'

describe('exact LEGO render batching', () => {
  beforeAll(() => loadLDrawGeneratedVisual(['3005', '3024']), 30_000)

  it('matches the original nested group transform, including reflected source matrices', () => {
    const brick = makeBrick('brick-1x1', 'red', 2, 3, 4)
    const definition = brickById.get(brick.brickId)!
    for (const source of [[1,0,0,0,1,0,0,0,1], [-1,0,0,0,1,0,0,0,1], [0,1,0,-1,0,0,0,0,1]]) {
      for (const yaw of [0,1,2,3] as const) for (const pitch of [0,1,2,3] as const) {
        const placed = { ...brick, pose: { ...brick.pose, rotationQuarterTurns: yaw, verticalQuarterTurns: pitch, rollQuarterTurns: 1 as const, orientationMatrix: source as NonNullable<typeof brick.pose.orientationMatrix> } }
        const frame = getBrickWorldFrame(definition, placed.pose)
        const root = new Mesh(); root.position.set(frame.x, frame.y, frame.z)
        const y = new Mesh(); y.rotation.y = -yaw*Math.PI/2; root.add(y)
        const x = new Mesh(); x.rotation.x = pitch === 3 ? Math.PI/2 : pitch === 2 ? Math.PI : -pitch*Math.PI/2; y.add(x)
        const z = new Mesh(); z.rotation.z = Math.PI/2; x.add(z)
        const leaf = new Mesh(); leaf.matrix.set(source[0],source[1],source[2],0,source[3],source[4],source[5],0,source[6],source[7],source[8],0,0,0,0,1); leaf.matrixAutoUpdate=false; z.add(leaf); root.updateMatrixWorld(true)
        const point = new Vector3(.2,.7,-.4)
        expect(point.clone().applyMatrix4(getLDrawSceneMatrix(definition,placed)).distanceTo(point.clone().applyMatrix4(leaf.matrixWorld))).toBeLessThan(1e-12)
      }
    }
  })

  it('keeps reflected world vertices and front faces with positive instance matrices', () => {
    const geometry = new BoxGeometry(1,2,3).toNonIndexed()
    const source = new Matrix4().makeScale(-1,1,1).setPosition(4,5,6)
    const result = getPositiveLDrawGeometry(geometry,source)
    expect(result.matrix.determinant()).toBeGreaterThan(0)
    expect(result.geometry.index!.getX(1)).toBe(2)
    for(let i=0;i<geometry.getAttribute('position').count;i++) {
      const expected = new Vector3().fromBufferAttribute(geometry.getAttribute('position'),i).applyMatrix4(source)
      const actual = new Vector3().fromBufferAttribute(result.geometry.getAttribute('position'),i).applyMatrix4(result.matrix)
      expect(actual.distanceTo(expected)).toBeLessThan(1e-12)
    }
    expect(getPositiveLDrawGeometry(geometry,source).geometry).toBe(result.geometry)
  })

  it('batches opaque bodies and retains transparent, selected and transformed pieces individually', () => {
    const pieces = Array.from({length:12},(_,i)=>makeBrick('brick-1x1',i===2?'trans-clear':'red',i*2,0,0))
    const result = buildLDrawSceneBatches(pieces,{selectedId:pieces[0].id,excludedIds:new Set([pieces[1].id]),highlightedIds:new Set(),supportedByBrickId:new Map(),showEdges:true})
    expect(result.individualBricks.map(p=>p.id)).toEqual(pieces.slice(0,3).map(p=>p.id))
    expect(result.meshBatches).toHaveLength(1)
    expect(result.meshBatches[0].instances).toHaveLength(9)
    expect(result.lineBatches.reduce((n,b)=>n+b.points.length,0)).toBeGreaterThan(0)
  })

  it('returns the same exact hit point and instance ID with BVH picking', () => {
    const geometry = new BoxGeometry(1,1,1)
    const brick = makeBrick('brick-1x1','red',0,0,0)
    const matrix = new Matrix4().makeTranslation(3,0,0)
    const batch = createLDrawBatchMesh({key:'test',geometry,print:false,doubleSide:false,instances:[{brick,matrix,color:'#ff0000'}]})
    batch.updateMatrixWorld(true)
    const reference = new Mesh(geometry,new MeshStandardMaterial({side:FrontSide}));reference.matrixWorld.copy(matrix)
    const ray = new Raycaster(new Vector3(3,0,5),new Vector3(0,0,-1))
    const expected=ray.intersectObject(reference)[0]
    const actual=ray.intersectObject(batch)[0]
    expect(actual.instanceId).toBe(0); expect(actual.point.distanceTo(expected.point)).toBeLessThan(1e-12)
    const color = new Color(); batch.getColorAt(0,color);expect(color.getHexString()).toBe('ff0000')
    expect(batch.material.side).not.toBe(DoubleSide)
    batch.dispose();batch.material.dispose()
  })
  it('keeps opaque print colours, normals and editable piece IDs after merging', () => {
    const geometry = new BoxGeometry(1,1,1).toNonIndexed()
    const red = makeBrick('brick-1x1','red',0,0,0), blue = makeBrick('brick-1x1','blue',0,0,0)
    const source = {key:'ink',geometry,print:true,doubleSide:false,instances:[
      {brick:red,matrix:new Matrix4().makeTranslation(-3,0,0),color:'#ff0000'},
      {brick:blue,matrix:new Matrix4().makeTranslation(3,0,0),color:'#0000ff'},
    ]}
    const batches=mergeLDrawPrintBatches([source])
    expect(batches.reduce((n,b)=>n+b.geometry.getAttribute('position').count,0)).toBe(72)
    for (const [x,id,hex] of [[-3,red.id,'ff0000'],[3,blue.id,'0000ff']] as const) {
      const ray=new Raycaster(new Vector3(x,0,5),new Vector3(0,0,-1))
      const results=batches.flatMap(batch=>ray.intersectObject(createLDrawPrintBatchMesh(batch)).map(hit=>({hit,batch})))
      expect(results).toHaveLength(1)
      const {hit,batch}=results[0]
      expect(batch.brickIds[batch.triangleBrickIndices[hit.faceIndex!]]).toBe(id)
      expect(new Color().fromBufferAttribute(batch.geometry.getAttribute('color'),hit.face!.a).getHexString()).toBe(hex)
      expect(hit.point.z).toBeCloseTo(.5)
    }
    const reused=mergeLDrawPrintBatches([source],batches)
    expect(reused[0]).toBe(batches[0])
    // Adding/removing another piece in a mould batch must not rebuild chunks
    // whose actual geometry, colours and piece transforms are unchanged.
    const equivalent = mergeLDrawPrintBatches([{ ...source, instances: [...source.instances] }], batches)
    expect(equivalent).toEqual(batches)
    expect(equivalent[0]).toBe(batches[0])
  })

  it('reuses unaffected body and edge batches when selecting another piece', () => {
    const pieces=[makeBrick('brick-1x1','red',0,0,0),makeBrick('plate-1x1','blue',40,0,0)]
    const options={excludedIds:new Set<string>(),highlightedIds:new Set<string>(),supportedByBrickId:new Map<string,boolean>(),showEdges:true}
    const first=buildLDrawSceneBatches(pieces,options)
    const second=buildLDrawSceneBatches(pieces,{...options,selectedId:pieces[0].id},first)
    expect(second.meshBatches[0]).toBe(first.meshBatches[1])
    expect(second.lineBatches[0]).toBe(first.lineBatches[1])
    expect(second.individualBricks[0]).toBe(pieces[0])
  })

})
