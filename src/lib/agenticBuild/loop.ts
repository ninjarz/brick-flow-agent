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

export type AgentComponent = {
  name: string
  goal: string
  region?: { x?: number[]; z?: number[]; y?: number[] }
  colors?: string[]
  approach?: string
}

export type AgentManual = { title: string; size?: number[]; components: AgentComponent[]; details?: string[] }

export type AgenticStatus = {
  phase: 'manual' | 'building' | 'details'
  component?: string
  index?: number
  total?: number
  turn: number
  parts: number
}

export type AgenticLogEntry = { component: string; turn: number; action: string; placed: number; rejected: number; removed: number; note?: string }

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
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

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
  const components = value.components.slice(0, 8).flatMap((item): AgentComponent[] => {
    if (!record(item) || typeof item.name !== 'string') return []
    return [{
      name: item.name.slice(0, 60),
      goal: typeof item.goal === 'string' ? item.goal.slice(0, 600) : typeof item.description === 'string' ? item.description.slice(0, 600) : '',
      ...(record(item.region) ? { region: item.region as AgentComponent['region'] } : {}),
      ...(Array.isArray(item.colors) ? { colors: item.colors.filter(color => typeof color === 'string').slice(0, 12) as string[] } : {}),
      ...(typeof item.approach === 'string' ? { approach: item.approach.slice(0, 300) } : {}),
    }]
  })
  if (!components.length) throw new Error('Manual components need names.')
  const details = Array.isArray(value.details) ? value.details.filter((item): item is string => typeof item === 'string').map(item => item.slice(0, 200)).slice(0, 16) : []
  return { title: typeof value.title === 'string' ? value.title.slice(0, 80) : 'Model', ...(Array.isArray(value.size) ? { size: value.size as number[] } : {}), components, ...(details.length ? { details } : {}) }
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
Return JSON: {"title":"English title","size":[width,depth,height] in studs,"components":[{"name":"Baseplate","goal":"what it is, its shape, size and the visible features to reach","region":{"x":[x0,x1],"z":[z0,z1],"y":[y0,y1]},"colors":["green"],"approach":"which primitives or parts to use"}],"details":["specific finishing details to add at the end"]}.
Use 4–8 components in build order. The first is a deck baseplate on the ground covering the whole footprint (usually green). Later components rest on earlier ones: landscaping, each building wing or storey, roofs, trees. Keep the model inside x,z 0..40. Aim for 800–2500 parts. List 6–12 concrete details (planters on the balcony, a lamp by the door, flowers along the path, a chimney cap, ...).
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

  const runComponent = async (component: AgentComponent, index: number, total: number, options: { turns: number; detailPass?: boolean; minimumTurns?: number }) => {
    const componentIds: string[] = []
    let lastResult: ActionResult | undefined
    let parseError: string | undefined
    for (let turn = 0; turn < options.turns && totalTurns < maxTurns; turn++, totalTurns++) {
      signal?.throwIfAborted()
      input.onStatus?.({ phase: options.detailPass ? 'details' : 'building', component: component.name, index, total, turn, parts: state.bricks.length })
      // The detail pass looks at the build: a render of it, and the reference if any.
      const images: string[] = []
      if (options.detailPass) {
        const view = await input.captureView?.().catch(() => undefined)
        if (view) images.push(view)
        if (imageDataUrl) images.push(imageDataUrl)
      }
      const content = await request(buildTurnPrompt({
        prompt, manual: manual!, index, turn, maxTurns: options.turns, summary: summarizeBuild(state.bricks), lastResult, parseError, history, catalogue,
        detailPass: options.detailPass, hasReference: Boolean(imageDataUrl), component, total,
      }), images)
      let action
      try {
        action = parseAgentAction(parseJson(content))
        parseError = undefined
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error)
        lastResult = undefined
        const entry = { component: component.name, turn, action: 'invalid', placed: 0, rejected: 0, removed: 0, note: parseError }
        history.push(entry); input.onLog?.(entry)
        continue
      }
      const early = turn + 1 < (options.minimumTurns ?? 0)
      if (action.action === 'done') {
        const entry = { component: component.name, turn, action: 'done', placed: 0, rejected: 0, removed: 0 }
        history.push(entry); input.onLog?.(entry)
        if (early) { parseError = 'It is too early to finish the detail pass: add more details first.'; continue }
        break
      }
      lastResult = applyAgentAction(state, action)
      const entry = { component: component.name, turn, action: action.action, placed: lastResult.placed, rejected: lastResult.rejected.length, removed: lastResult.removed }
      history.push(entry); input.onLog?.(entry)
      if (lastResult.placedIds.length) {
        componentIds.push(...lastResult.placedIds)
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
      if (action.done && lastResult.rejected.length === 0 && !early) break
    }
    const present = new Set(state.bricks.map(brick => brick.id))
    const ids = componentIds.filter(id => present.has(id))
    if (ids.length) plan.structures!.push({ id: createId('structure'), name: component.name, description: component.goal, brickIds: ids })
  }

  const total = manual.components.length + (detailTurns > 0 ? 1 : 0)
  for (const [index, component] of manual.components.entries()) {
    await runComponent(component, index, total, { turns: maxTurnsPerComponent })
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
