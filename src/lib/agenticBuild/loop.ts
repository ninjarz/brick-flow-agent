/**
 * Agentic build loop (see .agents/design/agentic-build-loop.md, stage 3–4).
 * The model first writes its own build manual, then builds each component
 * through small validated actions. The executor accepts only valid
 * placements, so the build is structurally valid after every turn.
 */
import type { BuildPlan, LlmConfig } from '../../types/bricks'
import { createId } from '../planUtils'
import { modelReasonsWhenDisabled, requestLlmJsonContent } from '../llmGenerator'
import { applyAgentAction, createBuildState, formatAgentCatalogue, getPrimitiveColors, parseAgentAction, summarizeBuild, type ActionResult } from './executor'
import { getComponentCompletionIssue, parseComponentCompletion, type ComponentCompletion } from './completion'
import { tryRoofRecipe } from './roofRecipe'

export type AgentComponent = {
  name: string
  goal: string
  region?: { x?: number[]; z?: number[]; y?: number[] }
  colors?: string[]
  approach?: string
  completion?: ComponentCompletion
}

export type AgentManual = { title: string; size?: number[]; foundation: 'deck' | 'freestanding'; components: AgentComponent[]; details?: string[] }

export type AgenticStatus = {
  phase: 'manual' | 'building' | 'details'
  component?: string
  index?: number
  total?: number
  turn: number
  parts: number
}

export type AgenticLogEntry = { component: string; turn: number; action: string; placed: number; rejected: number; removed: number; note?: string; requestMs?: number; executionMs?: number }

export type AgenticBuildInput = {
  prompt: string
  config: LlmConfig
  signal?: AbortSignal
  locale?: 'zh-CN' | 'en-US'
  /** Turns per component, and in total. */
  maxTurnsPerComponent?: number
  maxTurns?: number
  /** Turns of the final detail pass (0 disables it). */
  detailTurns?: number
  /** A reference image (data URL) the model should reproduce. */
  imageDataUrl?: string
  /** Renders the current build to an image (data URL), shown to the model during the detail pass. */
  captureView?: () => Promise<string | undefined>
  onStatus?: (status: AgenticStatus) => void
  onProgress?: (plan: BuildPlan) => void
  onLog?: (entry: AgenticLogEntry) => void
  onFoundationAccepted?: (ids: readonly string[]) => void
  onComponentVerified?: (ids: readonly string[]) => void
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const deckDimension = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 32

const parseJson = (content: string): unknown => {
  const trimmed = content.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)?.[1] ?? trimmed
  const object = /\{[\s\S]*\}/.exec(fenced)?.[0] ?? fenced
  return JSON.parse(object)
}

export const parseAgentManual = (value: unknown): AgentManual => {
  if (!record(value) || !Array.isArray(value.components) || value.components.length === 0) {
    throw new Error('Manual must contain a non-empty "components" array.')
  }
  if (value.subject !== 'building' && value.subject !== 'other') throw new Error('Manual subject must be "building" or "other".')
  const components = value.components.slice(0, 8).flatMap((item): AgentComponent[] => {
    if (!record(item) || typeof item.name !== 'string') return []
    const completion = parseComponentCompletion(item.completion, item.name)
    return [{
      name: item.name.slice(0, 60),
      goal: typeof item.goal === 'string' ? item.goal.slice(0, 600) : typeof item.description === 'string' ? item.description.slice(0, 600) : '',
      ...(record(item.region) ? { region: item.region as AgentComponent['region'] } : {}),
      ...(Array.isArray(item.colors) ? { colors: item.colors.filter(color => typeof color === 'string').slice(0, 12) as string[] } : {}),
      ...(typeof item.approach === 'string' ? { approach: item.approach.slice(0, 300) } : {}),
      ...(completion ? { completion } : {}),
    }]
  })
  if (!components.length) throw new Error('Manual components need names.')
  const details = Array.isArray(value.details) ? value.details.filter((item): item is string => typeof item === 'string').map(item => item.slice(0, 200)).slice(0, 16) : []
  const foundation = value.foundation === 'freestanding' ? 'freestanding' : 'deck'
  if (value.subject === 'building') {
    const wallsIndex = components.findIndex(component => component.completion?.kind === 'walls')
    const walls = components[wallsIndex]?.completion
    const roofs = components.slice(wallsIndex + 1).flatMap(({ completion }) => completion?.kind === 'roof' ? [completion] : [])
    if (foundation !== 'deck' || wallsIndex < 1 || walls?.kind !== 'walls' || !roofs.length
      || components.slice(0, wallsIndex).some(component => component.completion?.kind === 'roof')) {
      throw new Error('Buildings need a ground deck first, followed by a walls completion target and then a roof completion target.')
    }
    for (let x = walls.x; x < walls.x + walls.width; x++) for (let z = walls.z; z < walls.z + walls.depth; z++) {
      if (!roofs.some(roof => roof.y >= walls.y + walls.courses * 1.2 - 0.01
        && x >= roof.x && x < roof.x + roof.width && z >= roof.z && z < roof.z + roof.depth)) {
        throw new Error('The planned roof completion targets must cover the main walls footprint above its last course.')
      }
    }
  }
  const size = Array.isArray(value.size) && value.size.length === 3
    && value.size.every(dimension => typeof dimension === 'number' && Number.isFinite(dimension) && dimension > 0)
    ? value.size as number[] : undefined
  if (value.foundation !== undefined && value.foundation !== 'deck' && value.foundation !== 'freestanding') {
    throw new Error('Foundation must be "deck" or "freestanding".')
  }
  if (foundation === 'deck' && (!size || !deckDimension(size[0]) || !deckDimension(size[1]))) {
    throw new Error('A ground deck needs integer width and depth from 1 to 32 studs in the manual size.')
  }
  return { title: typeof value.title === 'string' ? value.title.slice(0, 80) : 'Model', foundation, ...(size ? { size } : {}), components, ...(details.length ? { details } : {}) }
}

export const agentSystemPrompt = 'You are a LEGO building agent. You work in small validated steps. Return one compact JSON object only, with no reasoning text.'

let primitivePalette: string | undefined
const describePrimitivePalette = () => primitivePalette ??= Object.entries(getPrimitiveColors())
  .map(([kind, colors]) => `${kind}: ${colors.filter(color => !color.startsWith('lego-')).join('/')}`).join('; ')

const primitivesHelp = () => `Primitives (preferred; they handle bonding and support). x,z is the minimum corner.
Structure:
{"kind":"deck","x":0,"z":0,"size":[12,10],"color":"gray"} two staggered plate courses, 0.8 studs thick: foundation, floor, ceiling, balcony slab, eaves trim band.
{"kind":"walls","x":1,"z":1,"size":[10,8],"courses":6,"color":"light-gray","openings":[{"side":"front","offset":2,"width":2,"bottom":2,"height":2,"color":"white","part":"window"},{"side":"front","offset":5,"width":2,"bottom":0,"height":4,"color":"reddish-brown"}]} closed rectangle of 1-stud walls, 1.2 studs per course. Sides: front (z=z0), back, left (x=x0), right; offset counts from the lower x or z end. "part":"window" puts real window frames (colour = frame colour) in the opening: width and height must be even (each frame is 2 wide, 2 courses tall) and at least 1 stud from the corners. Without "part", the opening is a coloured inlay (doors, shutters, stone accents).
{"kind":"wall","x":0,"z":0,"length":8,"courses":3,"axis":"x","color":"gray","openings":[...]} straight 1-stud wall along x or z (pillars, garden walls, chimneys with length 2).
{"kind":"slope-roof","x":0,"z":0,"size":[12,10],"ridge":"x","color":"dark-gray","gableColor":"light-gray"} real 45° slope roof: rises one brick per stud from both long sides to a ridge along x (or z). The span across the ridge must be even. Put it on a ceiling deck; make it 1 stud larger than the walls on every side for eaves. gableColor fills the triangular ends.
{"kind":"stepped-roof","x":1,"z":1,"size":[10,8],"tiers":4,"style":"gable","color":"dark-gray"} blocky stepped roof (older style; prefer slope-roof).
Detail:
{"kind":"tree","x":4,"z":20,"size":7,"trunk":3,"style":"round","leaves":["green","dark-green","orange"]} a tree centred on the trunk stud x,z: canopy about size studs wide and tall, mottled from the leaf colours. style round, pine or bush (no trunk). Leave size/2 studs of free space around the trunk.
{"kind":"fence","x":0,"z":0,"length":8,"axis":"x","height":1,"color":"white"} posts and a rail: garden fences, balcony railings (place on the balcony slab edge).
{"kind":"tiles","x":10,"z":0,"size":[3,8],"color":"tan"} smooth tiles: paths, water (trans-blue / blue), patios, flat roofs, window sills.
{"kind":"scatter","x":0,"z":8,"size":[6,10],"colors":["green","lime","red","yellow"],"count":12} loose flowers and plants on the free ground studs of a region (never on roofs); use it in a few small clusters along paths, walls and trees, not over the whole base.
Primitive colours used exactly (others become the nearest): ${describePrimitivePalette()}.`

const designHelp = `Design like a good LEGO MOC, not a box:
- Landscape the base: a path to the door, grass in two greens, flower and plant scatter, trees with two or three leaf colours, maybe water or a fence.
- Break up volumes: combine 2–3 wings or storeys of different heights and footprints, setbacks, an overhanging upper floor or balcony, pillars, a chimney.
- Contrast: walls in one colour with trim bands (a thin deck) and roof in another, window frames in a light colour, a door in a dark colour, darker foundation or stone base course.
- Real roofs: slope-roof with eaves, or a flat roof with a trim band and tiles.
- Many windows (every 3–5 studs of wall), sills and lintels, a few small props (lamps, mailbox, crates) from single parts.`

const rulesHelp = `Coordinates are WORLD studs. x,z are the minimum corner of the rotated footprint. Omit y: the part or primitive drops onto the highest support under it (recommended). A brick is 1.2 studs (3 plates) tall, a plate 0.4.
Every part must rest on studs of a part below or on the ground. Parts side by side on the ground do NOT connect to each other, so start with a deck foundation and build on it. Tiles have no studs on top.
Build bottom-up. Each turn place one meaningful batch: 1–6 primitives and/or up to 60 parts. Use "repeat" for rows: {"brickId":"brick-1x2","color":"red","x":0,"z":0,"rotation":0,"repeat":{"count":6,"dx":2}} (dx/dz/dy per copy).
Invalid items are rejected individually with the reason and nearby valid positions; valid ones are kept. Unavailable colours are replaced by the nearest colour automatically.
Actions:
{"action":"place","items":[ ...parts or primitives... ]}
{"action":"remove","ids":["p12"]} (parts resting on removed parts are removed too)
{"action":"done"} when the current component is complete. Better: add "done":true to the place action whose batch completes the component, which saves a turn.`

const describeResult = (result: ActionResult | undefined, parseError?: string) => {
  if (parseError) return `Your last reply could not be used: ${parseError}`
  if (!result) return 'No action yet.'
  const lines = [`Last action: placed ${result.placed} parts${result.removed ? `, removed ${result.removed}` : ''}${result.rejected.length ? `, rejected ${result.rejected.length} items` : ''}.`]
  for (const rejection of result.rejected.slice(0, 10)) {
    lines.push(`- item ${rejection.item}${rejection.part ? ` (${rejection.part}${rejection.at ? ` at ${JSON.stringify(rejection.at)}` : ''})` : ''}: ${rejection.reason}${rejection.candidates?.length ? `; valid nearby [x,y,z]: ${JSON.stringify(rejection.candidates)}` : ''}`)
  }
  if (result.colorSubstitutions.length) {
    lines.push(`Colour substitutions: ${[...new Set(result.colorSubstitutions.map(item => `${item.requested}->${item.used}`))].join(', ')}`)
  }
  return lines.join('\n')
}

export const buildManualPrompt = (prompt: string, hasImage = false) => `User request: ${prompt}
${hasImage ? 'A reference image is attached: reproduce its composition, proportions, colours and characteristic features as closely as the parts allow.\n' : ''}Write a build manual for a detailed LEGO model (MOC) of this request, built step by step with validated placements.
Return JSON: {"title":"English title","subject":"building","size":[width,depth,height] in studs,"foundation":"deck","components":[{"name":"Baseplate","goal":"what it is, its shape, size and the visible features to reach","region":{"x":[x0,x1],"z":[z0,z1],"y":[y0,y1]},"colors":["green"],"approach":"which primitives or parts to use"}],"details":["specific finishing details to add at the end"]}.
Use subject "building" for houses and other roofed buildings, or "other" for models without enclosed walls and a roof. For a building add a separate walls component with completion {"kind":"walls","x":2,"y":0.8,"z":2,"width":12,"depth":10,"courses":5,"openings":[{"side":"front","offset":4,"width":2,"bottom":0,"courses":3}]} and a later roof component with completion {"kind":"roof","x":2,"y":6.8,"z":2,"width":12,"depth":10,"recipe":{"style":"gable","ridge":"x","color":"tan","gableColor":"light-gray","supportDeck":true}}. Adapt both to the actual geometry. Coordinates are in world studs. Walls y is the course base; roof y is its bottom or supporting deck's bottom. List intentional open door and window gaps. Each target is tested against parts built for that component.
Give each simple rectangular roof its own component and recipe. Choose {"style":"flat","color":"gray"} for a flat roof, or "gable" with an even span of at least four studs across the ridge. Allow "supportDeck":true if there is no planned studded ceiling at the roof elevation. The builder tries the recipe automatically. Omit recipe for a custom shape and put chimneys and decorations in later components.
Use 4–8 components in build order. Buildings and landscapes require foundation "deck": the first component is one connected deck at [0,0,0] with the full width and depth (integer dimensions from 1 to 32). Keep the building footprint over that deck. Use foundation "freestanding" only for objects designed to stand on their own, such as a vehicle or animal. Later components rest on earlier ones. Aim for 800–2500 parts. List 6–12 concrete finishing details.
${designHelp}
${primitivesHelp()}`

const buildTurnPrompt = (input: {
  prompt: string
  manual: AgentManual
  index: number
  turn: number
  maxTurns: number
  summary: ReturnType<typeof summarizeBuild>
  lastResult?: ActionResult
  parseError?: string
  completionFeedback?: string
  history: AgenticLogEntry[]
  catalogue: string
  detailPass?: boolean
  hasReference?: boolean
  component?: AgentComponent
  total?: number
}) => {
  const component = input.component ?? input.manual.components[input.index]
  return `User request: ${input.prompt}
Manual: ${JSON.stringify(input.manual)}
Current component ${input.index + 1}/${input.total ?? input.manual.components.length}: ${JSON.stringify(component)}
Turn ${input.turn + 1} of at most ${input.maxTurns} for this component. ${input.detailPass
    ? `This is the detail pass: a render of the current build${input.hasReference ? ' and the reference image are' : ' is'} attached. Compare and add what is missing or plain: details from the manual, plants, trims, props, colour variation. Fix only clear mistakes; remove at most a few loose parts, never structure. Keep roofs clean. Place at least 20 parts per turn${input.turn < 2 ? '; do not return done yet' : ''}.`
    : 'Build the component completely and with its visible features; return done (or "done":true on the last batch) when it matches its goal.'}

${rulesHelp}

${designHelp}

${primitivesHelp()}

${input.catalogue}

Current build (all components so far): ${JSON.stringify(input.summary)}
History: ${input.history.slice(-8).map(entry => `${entry.component}#${entry.turn + 1} ${entry.action} +${entry.placed}${entry.rejected ? ` rejected ${entry.rejected}` : ''}`).join('; ') || 'none'}
${describeResult(input.lastResult, input.parseError)}
${input.completionFeedback ?? ''}
Return the next action JSON.`
}

/** Builds a model from a prompt without a manual: plan the manual, then build it through validated actions. */
export const generateAgenticBuildPlan = async (input: AgenticBuildInput): Promise<BuildPlan> => {
  const { prompt, config, signal, locale = 'zh-CN', imageDataUrl } = input
  const maxTurnsPerComponent = input.maxTurnsPerComponent ?? 8
  const maxTurns = input.maxTurns ?? 60
  const detailTurns = input.detailTurns ?? 4
  const outputBudget = () => modelReasonsWhenDisabled(config) ? 24_576 : 8_192
  const request = (userPrompt: string, images?: string[]) => requestLlmJsonContent({
    config, signal, locale, systemPrompt: agentSystemPrompt, userPrompt, images: images?.length ? images : undefined, temperature: 0.3, maxTokens: outputBudget(), stream: true,
  })

  input.onStatus?.({ phase: 'manual', turn: 0, parts: 0 })
  let manual: AgentManual | undefined
  let manualError = ''
  for (let attempt = 0; attempt < 2 && !manual; attempt++) {
    const content = await request(`${buildManualPrompt(prompt, Boolean(imageDataUrl))}${manualError ? `\nYour previous reply was unusable: ${manualError}` : ''}`, imageDataUrl ? [imageDataUrl] : undefined)
    try { manual = parseAgentManual(parseJson(content)) } catch (error) { manualError = error instanceof Error ? error.message : String(error) }
  }
  if (!manual) throw new Error(`Could not obtain a build manual: ${manualError}`)

  const catalogue = formatAgentCatalogue()
  const state = createBuildState()
  const history: AgenticLogEntry[] = []
  const plan: BuildPlan = { id: createId('plan'), title: manual.title, prompt, source: 'llm', bricks: [], steps: [], structures: [] }
  const snapshot = (): BuildPlan => ({ ...plan, bricks: [...state.bricks], steps: [...plan.steps], structures: [...plan.structures!] })
  let totalTurns = 0
  const protectedIds = new Set<string>()
  const deckSize = manual.foundation === 'deck' ? manual.size!.slice(0, 2) : undefined
  const foundationCommand = deckSize && `Place one ground deck: {"kind":"deck","x":0,"y":0,"z":0,"size":${JSON.stringify(deckSize)},"color":"green"}. Use a colour that fits the design. This component accepts the full deck only.`

  const runComponent = async (component: AgentComponent, index: number, total: number, options: { turns: number; detailPass?: boolean; minimumTurns?: number; foundation?: boolean }) => {
    const componentIds = new Set<string>()
    const completionIssue = () => component.completion && getComponentCompletionIssue(component.completion, state.bricks, componentIds)
    let lastResult: ActionResult | undefined
    let parseError: string | undefined
    let completionFeedback: string | undefined
    let builtFromRecipe = false
    if (component.completion?.kind === 'roof' && component.completion.recipe) {
      signal?.throwIfAborted()
      input.onStatus?.({ phase: 'building', component: component.name, index, total, turn: 0, parts: state.bricks.length })
      const startedAt = performance.now()
      const result = tryRoofRecipe(state, component.completion)
      const entry = {
        component: component.name, turn: 0, action: 'roof-recipe',
        placed: result?.placed ?? 0, removed: 0, rejected: result ? 0 : 1, executionMs: performance.now() - startedAt,
      }
      history.push(entry); input.onLog?.(entry)
      if (result) {
        const ids = result.placedIds
        for (const id of ids) componentIds.add(id)
        plan.steps.push({ id: createId('step'), title: component.name, description: component.goal.slice(0, 160), brickIds: ids })
        input.onProgress?.(snapshot())
        builtFromRecipe = true
      } else {
        completionFeedback = 'The local roof recipe could not be supported or would collide at the planned elevation. Inspect the build and add valid supports or place the roof in smaller groups within the same target.'
      }
    }
    for (let turn = 0; !builtFromRecipe && turn < options.turns && totalTurns < maxTurns; turn++, totalTurns++) {
      signal?.throwIfAborted()
      input.onStatus?.({ phase: options.detailPass ? 'details' : 'building', component: component.name, index, total, turn, parts: state.bricks.length })
      // The detail pass looks at the build: a render of it, and the reference if any.
      const images: string[] = []
      if (options.detailPass) {
        const view = await input.captureView?.().catch(() => undefined)
        if (view) images.push(view)
        if (imageDataUrl) images.push(imageDataUrl)
      }
      const turnPrompt = buildTurnPrompt({
        prompt, manual: manual!, index, turn, maxTurns: options.turns, summary: summarizeBuild(state.bricks), lastResult, parseError, completionFeedback, history, catalogue,
        detailPass: options.detailPass, hasReference: Boolean(imageDataUrl), component, total,
      })
      const requestedAt = performance.now()
      const content = await request(options.foundation ? `${turnPrompt}\n${foundationCommand}` : turnPrompt, images)
      signal?.throwIfAborted()
      const requestMs = performance.now() - requestedAt
      let action
      try {
        action = parseAgentAction(parseJson(content))
        parseError = undefined
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error)
        lastResult = undefined
        const entry = { component: component.name, turn, action: 'invalid', placed: 0, rejected: 0, removed: 0, note: parseError, requestMs }
        history.push(entry); input.onLog?.(entry)
        continue
      }
      if (options.foundation) {
        const deck = action.action === 'place' && action.items.find(item =>
          record(item) && item.kind === 'deck' && item.x === 0 && item.z === 0 && (item.y === undefined || item.y === 0)
          && Array.isArray(item.size) && item.size.length === 2 && item.size.every((dimension, i) => dimension === deckSize?.[i]),
        )
        if (!deck) {
          parseError = 'The required full-size ground deck has not been built.'
          const entry = { component: component.name, turn, action: action.action, placed: 0, removed: 0, rejected: 1, note: parseError, requestMs }
          history.push(entry); input.onLog?.(entry)
          continue
        }
        action = { action: 'place', items: [deck], done: true }
      }
      const early = turn + 1 < (options.minimumTurns ?? 0)
      if (action.action === 'done') {
        const entry = { component: component.name, turn, action: 'done', placed: 0, rejected: 0, removed: 0, requestMs }
        history.push(entry); input.onLog?.(entry)
        if (early) { parseError = 'It is too early to finish the detail pass: add more details first.'; continue }
        if (!options.detailPass && !state.bricks.some(brick => componentIds.has(brick.id))) {
          parseError = 'This component has no accepted parts yet. Build it before completing it.'
          continue
        }
        completionFeedback = completionIssue()
        if (completionFeedback) continue
        break
      }
      const executionStartedAt = performance.now()
      lastResult = applyAgentAction(state, action, protectedIds)
      const entry = { component: component.name, turn, action: action.action, placed: lastResult.placed, rejected: lastResult.rejected.length, removed: lastResult.removed, requestMs, executionMs: performance.now() - executionStartedAt }
      history.push(entry); input.onLog?.(entry)
      if (lastResult.placedIds.length) {
        for (const id of lastResult.placedIds) componentIds.add(id)
        plan.steps.push({ id: createId('step'), title: `${component.name} · ${turn + 1}`, description: component.goal.slice(0, 160), brickIds: [...lastResult.placedIds] })
      }
      if (lastResult.removed) {
        const present = new Set(state.bricks.map(brick => brick.id))
        plan.steps = plan.steps.map(step => ({ ...step, brickIds: step.brickIds.filter(id => present.has(id)) })).filter(step => step.brickIds.length)
        plan.structures = plan.structures!.map(structure => ({ ...structure, brickIds: structure.brickIds.filter(id => present.has(id)) })).filter(structure => structure.brickIds.length)
      }
      input.onProgress?.(snapshot())
      // A batch that completes the component ends it without another turn,
      // unless items were rejected and need another attempt.
      if (completionFeedback || action.done) completionFeedback = completionIssue()
      if (action.done && lastResult.rejected.length === 0 && !early && lastResult.placedIds.length) {
        if (!completionFeedback) break
      }
    }
    const present = new Set(state.bricks.map(brick => brick.id))
    const ids = [...componentIds].filter(id => present.has(id))
    if (options.foundation && ids.length === 0) throw new Error(locale === 'zh-CN'
      ? `模块「${component.name}」未完成：需要 ${deckSize!.join(' × ')} 格的连通底板。`
      : `Component "${component.name}" did not complete the required ${deckSize!.join(' × ')}-stud connected ground deck.`)
    if (!options.detailPass && ids.length === 0) throw new Error(locale === 'zh-CN'
      ? `模块「${component.name}」未完成：没有成功保留任何零件。`
      : `Component "${component.name}" did not retain any accepted parts.`)
    const issue = completionIssue()
    if (issue) throw new Error(locale === 'zh-CN' ? `模块「${component.name}」未通过完工检查：${issue}` : `Component "${component.name}" is incomplete: ${issue}`)
    if (!options.detailPass) for (const id of ids) protectedIds.add(id)
    if (options.foundation) input.onFoundationAccepted?.(ids)
    if (component.completion) input.onComponentVerified?.(ids)
    if (ids.length) plan.structures!.push({ id: createId('structure'), name: component.name, description: component.goal, brickIds: ids })
  }

  const total = manual.components.length + (detailTurns > 0 ? 1 : 0)
  for (const [index, component] of manual.components.entries()) {
    await runComponent(component, index, total, { turns: maxTurnsPerComponent, foundation: index === 0 && Boolean(deckSize) })
  }
  if (detailTurns > 0 && state.bricks.length) {
    const details: AgentComponent = {
      name: 'Details',
      goal: `Finishing pass over the whole model: ${(manual.details ?? []).join('; ') || 'plants, trims, props, colour variation'}.`,
    }
    await runComponent(details, manual.components.length, total, { turns: detailTurns, detailPass: true, minimumTurns: Math.min(2, detailTurns) })
  }
  if (!state.bricks.length) throw new Error('The agent did not place any parts.')
  return snapshot()
}
