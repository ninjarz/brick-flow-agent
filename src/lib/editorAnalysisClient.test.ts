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
  it('cancels only the generation finalizer and ignores late results', async () => {
    const api = await import('./editorAnalysisClient')
    const parts = bricks()
    const plan: BuildPlan = { id: 'test', title: 'test', prompt: '', source: 'llm', bricks: parts, steps: [] }
    const support = api.getEditorSupport(parts)
    const controller = new AbortController()
    const generation = api.getEditorGenerationValidation(plan, controller.signal)
    const aborted = expect(generation).rejects.toMatchObject({ name: 'AbortError' })
    await flush()
    const worker = FakeWorker.instances.find(instance => instance.messages[0].finalizeGeneration)!
    const background = FakeWorker.instances.find(instance => instance !== worker)!
    controller.abort()
    await aborted
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(background.terminate).not.toHaveBeenCalled()
    worker.reply({ requestId: worker.messages[0].requestId, type: 'result', result: { supported: new Map(), finalizedGeneration: { plan, issues: [], repairedLocally: false } } })
    background.reply({ requestId: background.messages[0].requestId, type: 'result', result: { supported: new Map() } })
    expect(await support).toEqual(new Map())
  })

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

  it('shares support analysis across selections and uses a fresh snapshot after a brick edit', async () => {
    const api = await import('./editorAnalysisClient')
    const parts = bricks()
    const first = api.getEditorConnectedSelection(parts, '0')
    const second = api.getEditorConnectedSelection(parts, '1')
    await flush()
    const worker = FakeWorker.instances[0]
    expect(worker.messages).toHaveLength(1)
    worker.reply({
      requestId: worker.messages[0].requestId,
      type: 'result',
      result: { supported: new Map(), connectedComponents: [['0', '1'], ['2']] },
    })
    const component = await first
    expect(component).toEqual(['0', '1'])
    expect(await second).toBe(component)
    expect(api.getEditorConnectedSelection(parts, '1')).toBe(component)
    expect(api.getEditorConnectedSelection(parts, '2')).toEqual(['2'])
    expect(worker.messages).toHaveLength(1)

    const edited = [{ ...parts[0], pose: { ...parts[0].pose, xStud: -1 } }, ...parts.slice(1)]
    const updated = api.getEditorConnectedSelection(edited, '0')
    await flush()
    expect(worker.messages).toHaveLength(2)
    worker.reply({
      requestId: worker.messages[1].requestId,
      type: 'result',
      result: { supported: new Map(), connectedComponents: [['0'], ['1'], ['2']] },
    })
    expect(await updated).toEqual(['0'])
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

  it('isolates group edits from background analysis and reuses the interactive snapshot', async () => {
    const api = await import('./editorAnalysisClient'), parts = bricks()
    const support = api.getEditorSupport(parts)
    await flush()
    const worker = FakeWorker.instances[0]
    worker.reply({ requestId: worker.messages[0].requestId, type: 'result', result: { supported: new Map() } })
    await support
    const next = parts.slice(0, 72).map(brick => ({ ...brick, pose: { ...brick.pose, xStud: brick.pose.xStud + .2 } }))
    const edit = api.getEditorTransform(parts, next, true)
    await flush()
    const interactive = FakeWorker.instances[1]
    const message = interactive.messages[0]
    expect(message.bricks).toHaveLength(800)
    expect(message.transform?.next).toEqual(next)
    expect(message.transform?.reposition).toBe(true)
    interactive.reply({ requestId: message.requestId, type: 'result', result: { supported: new Map(), transformedBricks: next } })
    expect(await edit).toEqual(next)
    const again = api.getEditorTransform(parts, next, false)
    await flush()
    expect(interactive.messages[1].bricks).toEqual([])
    interactive.reply({ requestId: interactive.messages[1].requestId, type: 'result', result: { supported: new Map(), transformedBricks: next } })
    await again
  })

})

it('deduplicates manual preparation by plan and locale and retries failures', async () => {
  const api = await import('./editorAnalysisClient')
  const plan: BuildPlan = { id: 'manual', title: 'Original', prompt: '', source: 'template-local', bricks: bricks(), steps: [] }
  const first = api.getEditorManual(plan, 'en-US')
  expect(api.getEditorManual(plan, 'en-US')).toBe(first)
  await flush()
  const worker = FakeWorker.instances[0]
  expect(worker.messages[0].manualLocale).toBe('en-US')
  const rejected = expect(first).rejects.toThrow('manual failed')
  worker.reply({ requestId: worker.messages[0].requestId, type: 'error', message: 'manual failed' })
  await rejected
  const retry = api.getEditorManual(plan, 'en-US')
  const renamed = api.getEditorManual({ ...plan, title: 'Renamed' }, 'en-US')
  const translated = api.getEditorManual(plan, 'zh-CN')
  await flush()
  expect(worker.messages[1].bricks).toHaveLength(800)
  expect(worker.messages.slice(1).map(message => message.plan?.title)).toEqual(['Original', 'Renamed', 'Original'])
  expect(worker.messages.at(-1)?.manualLocale).toBe('zh-CN')
  for (const message of worker.messages.slice(1)) worker.reply({ requestId: message.requestId, type: 'result', result: { supported: new Map(), manual: { title: message.plan!.title } as NonNullable<import('./editorAnalysisProtocol').EditorAnalysisResult['manual']> } })
  expect((await retry).title).toBe('Original')
  expect((await renamed).title).toBe('Renamed')
  await translated
})

it('keeps interaction results independent of a failed background worker', async () => {
  const api = await import('./editorAnalysisClient')
  const parts = bricks()
  const support = api.getEditorSupport(parts)
  const rejected = expect(support).rejects.toThrow('EDITOR_ANALYSIS_WORKER_FAILED')
  await flush()
  const edit = api.getEditorTransform(parts, parts.slice(0, 2), false)
  await flush()
  const background = FakeWorker.instances[0], interactive = FakeWorker.instances[1]
  background.onerror?.()
  await rejected
  const message = interactive.messages[0]
  interactive.reply({ requestId: message.requestId, type: 'result', result: { supported: new Map(), transformedBricks: message.transform!.next } })
  expect(await edit).toEqual(parts.slice(0, 2))
  expect(interactive.terminate).not.toHaveBeenCalled()
})

it('releases idle worker caches while allowing requested exports and transforms to finish', async () => {
  const api = await import('./editorAnalysisClient'), parts = bricks()
  api.setEditorAnalysisActive(true)
  const edit = api.getEditorTransform(parts, parts.slice(0, 2), false)
  await flush()
  const worker = FakeWorker.instances[0]
  api.setEditorAnalysisActive(false)
  expect(worker.terminate).not.toHaveBeenCalled()
  worker.reply({ requestId: worker.messages[0].requestId, type: 'result', result: { supported: new Map(), transformedBricks: parts.slice(0, 2) } })
  expect(await edit).toEqual(parts.slice(0, 2))
  expect(worker.terminate).toHaveBeenCalledOnce()
  api.setEditorAnalysisActive(true)
  const retry = api.getEditorTransform(parts, parts.slice(0, 2), false)
  await flush()
  const replacement = FakeWorker.instances[1]
  expect(replacement.messages[0].bricks).toHaveLength(parts.length)
  replacement.reply({ requestId: replacement.messages[0].requestId, type: 'result', result: { supported: new Map(), transformedBricks: parts.slice(0, 2) } })
  await retry
})
