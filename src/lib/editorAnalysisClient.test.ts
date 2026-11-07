import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorAnalysisRequest, EditorAnalysisResponse } from './editorAnalysisProtocol'
import type { BuildPlan, PlacedBrick } from '../types/bricks'

class FakeWorker {
  static instances: FakeWorker[]=[]
  messages:EditorAnalysisRequest[]=[]
  onmessage:((event:MessageEvent<EditorAnalysisResponse>)=>void)|null=null
  onerror:(()=>void)|null=null
  onmessageerror:(()=>void)|null=null
  terminate=vi.fn()
  constructor(){FakeWorker.instances.push(this)}
  postMessage(message:EditorAnalysisRequest){this.messages.push(message)}
  reply(data:EditorAnalysisResponse){this.onmessage?.({data} as MessageEvent<EditorAnalysisResponse>)}
}
const bricks=():PlacedBrick[]=>Array.from({length:800},(_,i)=>({id:String(i),brickId:'minecraft-stone-block',color:'gray',pose:{xStud:i,yStud:0,zStud:0,rotationQuarterTurns:0}}))
const flush=()=>new Promise(resolve=>setTimeout(resolve,0))

beforeEach(()=>{vi.resetModules();FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker)})
afterEach(()=>vi.unstubAllGlobals())

describe('shared editor analysis requests',()=>{
  it('deduplicates support and shares a snapshot revision with validation',async()=>{
    const api=await import('./editorAnalysisClient'),parts=bricks()
    const support=api.getEditorSupport(parts)
    expect(api.getEditorSupport(parts)).toBe(support)
    const plan:BuildPlan={id:'test',title:'test',prompt:'',source:'template-local',bricks:parts,steps:[]}
    const validation=api.getEditorValidation(plan)
    await flush()
    const worker=FakeWorker.instances[0]
    expect(worker.messages).toHaveLength(2)
    expect(worker.messages[0].revision).toBe(worker.messages[1].revision)
    expect(worker.messages[0].bricks).toHaveLength(800)
    expect(worker.messages[1].bricks).toEqual([])
    expect(worker.messages[1].geometry).toEqual([])
    const supported=new Map([['0',true]])
    worker.reply({requestId:worker.messages[1].requestId,type:'result',result:{supported,issues:[]}})
    worker.reply({requestId:worker.messages[0].requestId,type:'result',result:{supported}})
    expect(await support).toEqual(supported)
    expect(await validation).toEqual([])
  })
  it('routes overlapping snapshots by request ID rather than response order',async()=>{
    const api=await import('./editorAnalysisClient')
    const first=api.getEditorSupport(bricks()),second=api.getEditorSupport(bricks())
    await flush();const worker=FakeWorker.instances[0]
    const a=worker.messages[0],b=worker.messages[1]
    expect(a.revision).not.toBe(b.revision)
    worker.reply({requestId:b.requestId,type:'result',result:{supported:new Map([['new',true]])}})
    worker.reply({requestId:a.requestId,type:'result',result:{supported:new Map([['old',false]])}})
    expect(await first).toEqual(new Map([['old',false]]))
    expect(await second).toEqual(new Map([['new',true]]))
  })
  it('rejects failed jobs and permits a fresh worker on retry',async()=>{
    const api=await import('./editorAnalysisClient'),parts=bricks()
    const first=api.getEditorSupport(parts);const failure=expect(first).rejects.toThrow('EDITOR_ANALYSIS_WORKER_FAILED')
    await flush();FakeWorker.instances[0].onerror?.();await failure
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
    const retry=api.getEditorSupport(parts);await flush()
    const next=FakeWorker.instances[1]
    expect(next.messages[0].bricks).toHaveLength(800)
    next.reply({requestId:next.messages[0].requestId,type:'result',result:{supported:new Map()}})
    expect(await retry).toEqual(new Map())
  })
  it('keeps only the newest pending drop and deduplicates confirmation at that point', async () => {
    const api = await import('./editorAnalysisClient')
    const parts = bricks(), source = parts.slice(0, 10)
    const first = api.getEditorDrop(parts, source, source[0].id, { x: 1, z: 0 })
    const obsolete = api.getEditorDrop(parts, source, source[0].id, { x: 2, z: 0 })
    const latest = api.getEditorDrop(parts, source, source[0].id, { x: 3, z: 0 })
    expect(api.getEditorDrop(parts, source, source[0].id, { x: 3, z: 0 })).toBe(latest)
    expect(await obsolete).toBeUndefined()
    await flush()
    const worker = FakeWorker.instances[0]
    expect(worker.messages).toHaveLength(1)
    worker.reply({ requestId: worker.messages[0].requestId, type: 'result', result: { supported: new Map(), dropBricks: source } })
    expect(await first).toEqual(source)
    await flush()
    expect(worker.messages).toHaveLength(2)
    expect(worker.messages[1].drop?.point.x).toBe(3)
    worker.reply({ requestId: worker.messages[1].requestId, type: 'result', result: { supported: new Map(), dropBricks: source } })
    expect(await latest).toEqual(source)
  })

  it('resends an evicted snapshot before reusing its revision', async () => {
    const api = await import('./editorAnalysisClient')
    const a = bricks(), b = bricks(), c = bricks()
    const jobs = []
    for (const parts of [a, b, c, a]) {
      jobs.push(api.getEditorValidation({ id: 'plan', title: '', prompt: '', source: 'template-local', bricks: parts, steps: [] }))
      await flush()
    }
    const worker = FakeWorker.instances[0]
    expect(worker.messages.map(message => message.bricks.length)).toEqual([800, 800, 800, 800])
    expect(worker.messages[0].revision).toBe(worker.messages[3].revision)
    for (const message of worker.messages) worker.reply({ requestId: message.requestId, type: 'result', result: { supported: new Map(), issues: [] } })
    await Promise.all(jobs)
  })

  it('routes group edits through the shared worker without retransmitting the model', async () => {
    const api = await import('./editorAnalysisClient'), parts = bricks()
    const support = api.getEditorSupport(parts)
    await flush()
    const worker = FakeWorker.instances[0]
    worker.reply({ requestId: worker.messages[0].requestId, type: 'result', result: { supported: new Map() } })
    await support
    const next = parts.slice(0, 72).map(brick => ({ ...brick, pose: { ...brick.pose, xStud: brick.pose.xStud + .2 } }))
    const edit = api.getEditorTransform(parts, next, true)
    await flush()
    const message = worker.messages[1]
    expect(message.bricks).toEqual([])
    expect(message.transform?.next).toEqual(next)
    expect(message.transform?.reposition).toBe(true)
    worker.reply({ requestId: message.requestId, type: 'result', result: { supported: new Map(), transformedBricks: next } })
    expect(await edit).toEqual(next)
  })

})
