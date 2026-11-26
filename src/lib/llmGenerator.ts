import { createStreamedAssembly } from './streamedAssembly'
import { LlmServiceError } from './llmServiceError'
import { LlmOutputLimitError } from './llmOutputLimit'
import { assemblyCheckpointSignature, clearAssemblyCheckpoint, loadAssemblyCheckpoint, saveAssemblyCheckpoint } from './llmAssemblyCheckpoint'
import type { AssemblyCheckpoint } from './llmAssemblyCheckpoint'
import { chatCompletionEndpoint } from './llmEndpoint'
import { assemblyLimits, generateAssembly, parseAssemblyLayout, type AssemblyIssue, type AssemblyModuleProgress } from './llmAssembly'
import { canonicalColorIds, describeCodedColors, resolvePartColor } from './colorIds'
import { normalizeMaxRepairAttempts } from './llmConfig'
import { aiTasks } from './aiTasks'
import { createRequestLifetime, trackResponseActivity, withAbortSignal } from './requestLifetime'
import { brickById, brickDefinitions } from '../data/basicBricks'
import type { BrickDefinition, BrickPack, BuildPlan, GeneratorInput, LlmConfig, PlacedBrick } from '../types/bricks'
import { generateBuildPlan } from './localGenerator'
import { PLATE_HEIGHT_WORLD, WORLD_EDIT_STEP_STUDS, normalizeHorizontalStud, normalizeYStud, plateHeightToWorldStud } from './brickUnits'
import { createId, createSingleBrickSteps, findSupportedOpenPose, hasBrickCollision, isBrickSupported, makeBrick } from './planUtils'

type LlmBrick = {
  brickId?: unknown
  color?: unknown
  xStud?: unknown
  yStud?: unknown
  yPlate?: unknown
  zStud?: unknown
  rotationQuarterTurns?: unknown
  verticalQuarterTurns?: unknown
  pose?: {
    xStud?: unknown
    yStud?: unknown
    yPlate?: unknown
    zStud?: unknown
    rotationQuarterTurns?: unknown
    verticalQuarterTurns?: unknown
  }
}

type LlmPlan = {
  title?: unknown
  modules?: unknown
  commands?: unknown
  bricks?: unknown
}

type LlmGenerateInput = GeneratorInput & {
  config: LlmConfig
  signal?: AbortSignal
  locale?: LlmLocale
  repairFeedback?: string
  previousPlan?: BuildPlan
  onProgress?: (plan: BuildPlan) => void | Promise<void>
  onDraft?: (plan: BuildPlan) => void
  onPhase?: (phase: 'planning' | 'thinking' | 'building') => void
  onModuleProgress?: (progress: AssemblyModuleProgress) => void
  onAssemblyIssue?: (issue: AssemblyIssue) => void
}

type LlmRequestPayload = Record<string, unknown>
type LlmLocale = 'zh-CN' | 'en-US'
export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}
export type LlmTokenUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  totalTokens?: number
}
export type LlmStreamResult = {
  content: string
  usage?: LlmTokenUsage
  finishReason?: string
  maxTokens: number
  retryCount: number
}

export type LlmJsonRequestInput = {
  config: LlmConfig
  systemPrompt: string
  userPrompt: string
  /** Images sent with the user prompt (data URLs), e.g. a reference photo or a render of the build. */
  images?: string[]
  signal?: AbortSignal
  locale?: LlmLocale
  temperature?: number
  maxTokens?: number
  stream?: boolean
  onContent?: (text: string) => void
  onReasoning?: () => void
}

export type LlmStreamRequestInput = Omit<LlmJsonRequestInput, 'systemPrompt' | 'userPrompt'> & {
  systemPrompt?: string
  userPrompt?: string
  messages?: LlmChatMessage[]
  onDelta: (text: string) => void
  onReasoningDelta?: (text: string) => void
}

/** Idle limit: no data for this long aborts. Just above the dev proxy's 230 s, so a silent upstream gets the proxy's 504. */
const clientRequestTimeoutMs = 240_000
/** Total limit for one request, however steadily it streams. */
const clientRequestMaxMs = 15 * 60_000
const configTestTimeoutMs = 15_000
const configTestMaxTokens = 128
const generationMaxTokens = 12_288
const generationThinkingMaxTokens = 24_576
const emptyStreamRetryFloorTokens = 8_192
const emptyStreamRetryMaxTokens = 32_768
export const maxLlmBricks = 64

let omitUnsupportedThinkingParameters = false
let omitUnsupportedReasoningEffort = false
let omitUnsupportedStreamOptions = false
const mandatoryReasoningModels = new Set<string>()
/**
 * Models observed reasoning even though thinking was disabled. Some gateways
 * (Gemini via OpenAI-compatible endpoints) ignore every disable field, and the
 * hidden reasoning counts against max_tokens, so later requests to these
 * models get the thinking output budget instead of being truncated.
 */
const observedReasoningModels = new Set<string>()
const reasoningModelKey = (config: LlmConfig) => `${config.endpoint.trim()}\n${config.modelName.trim()}`
const observedReasoningThreshold = 256
const noteReasoningTokens = (config: LlmConfig, tokens: number) => {
  if (tokens >= observedReasoningThreshold) observedReasoningModels.add(reasoningModelKey(config))
}
export const modelReasonsWhenDisabled = (config: LlmConfig) => observedReasoningModels.has(reasoningModelKey(config))

export const resetLlmThinkingCompatibility = () => {
  omitUnsupportedThinkingParameters = false
  omitUnsupportedReasoningEffort = false
  omitUnsupportedStreamOptions = false
  mandatoryReasoningModels.clear()
  observedReasoningModels.clear()
}

const llmText: Record<LlmLocale, {
  configTestContext: string
  responseContext: string
  reasoningOnlyLength: (context: string) => string
  noTextContent: (context: string) => string
  notJsonObject: string
  proxyUnavailable: string
  upstreamStatus: (status: number) => string
  endpoint: (endpoint: string) => string
  upstreamBody: (body: string) => string
  requestFailed: (detail: string) => string
  directCors: string
  missingBricks: string
  noUsableParts: string
  incompleteConfig: string
  configTimeout: string
  emptyConfigResponse: string
  generationCanceled: string
  generationTimeout: string
  emptyGenerationResponse: string
  generatedTitle: string
}> = {
  'zh-CN': {
    configTestContext: '配置测试',
    responseContext: '响应',
    reasoningOnlyLength: (context) => `LLM ${context}没有生成最终内容：模型把输出 token 用在 reasoning_content 上并因为长度限制停止了。请在模型侧关闭 thinking/reasoning，或换非推理模型后重试。`,
    noTextContent: (context) => `LLM ${context}里没有可解析的文本内容`,
    notJsonObject: 'LLM 返回的内容不是 JSON 对象',
    proxyUnavailable: 'LLM 本地代理不可用：静态部署请切换到浏览器直连模式，或使用 npm run dev / npm run preview 启动带代理的服务',
    upstreamStatus: (status) => `，上游状态 ${status}`,
    endpoint: (endpoint) => `，接口 ${endpoint}`,
    upstreamBody: (body) => `，返回 ${body}`,
    requestFailed: (detail) => `LLM 请求失败：${detail}`,
    directCors: 'LLM 直连失败：浏览器无法访问该接口，常见原因是接口未允许 CORS。可以换支持浏览器访问的 endpoint，或在本地开发时切到本地代理模式。',
    missingBricks: 'LLM 返回缺少 bricks 数组',
    noUsableParts: 'LLM 没有返回可用零件',
    incompleteConfig: '请先填写完整的 LLM 配置',
    configTimeout: `LLM 配置测试超时：${configTestTimeoutMs / 1000} 秒内没有返回`,
    emptyConfigResponse: 'LLM 配置测试失败：响应为空',
    generationCanceled: '生成已取消',
    generationTimeout: `LLM 请求超时：连续 ${clientRequestTimeoutMs / 1000} 秒没有收到数据，或单次请求超过 ${clientRequestMaxMs / 60_000} 分钟`,
    emptyGenerationResponse: 'LLM 响应为空，请检查模型名字、api_key 或接口兼容性',
    generatedTitle: 'LLM 生成方案',
  },
  'en-US': {
    configTestContext: 'config test',
    responseContext: 'response',
    reasoningOnlyLength: (context) => `The LLM ${context} did not produce final content: the model spent output tokens on reasoning_content and stopped because of the length limit. Disable thinking/reasoning for this model or use a non-reasoning model and try again.`,
    noTextContent: (context) => `The LLM ${context} did not contain parseable text content.`,
    notJsonObject: 'The LLM response content is not a JSON object.',
    proxyUnavailable: 'The local LLM proxy is unavailable. For static deployment, switch to browser direct mode, or start npm run dev / npm run preview to use the proxy.',
    upstreamStatus: (status) => `, upstream status ${status}`,
    endpoint: (endpoint) => `, endpoint ${endpoint}`,
    upstreamBody: (body) => `, response ${body}`,
    requestFailed: (detail) => `LLM request failed: ${detail}`,
    directCors: 'LLM direct request failed: the browser could not access this endpoint. The endpoint probably does not allow CORS. Use a browser-accessible endpoint, or switch to local proxy mode during local development.',
    missingBricks: 'The LLM response is missing a bricks array.',
    noUsableParts: 'The LLM did not return any usable parts.',
    incompleteConfig: 'Complete the LLM config first.',
    configTimeout: `LLM config test timed out after ${configTestTimeoutMs / 1000} seconds.`,
    emptyConfigResponse: 'LLM config test failed: the response was empty.',
    generationCanceled: 'Generation was canceled.',
    generationTimeout: `LLM request timed out: no data for ${clientRequestTimeoutMs / 1000} seconds, or the request exceeded ${clientRequestMaxMs / 60_000} minutes.`,
    emptyGenerationResponse: 'The LLM response was empty. Check the model name, api_key, or endpoint compatibility.',
    generatedTitle: 'LLM generated plan',
  },
}


const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asString = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value.trim() : fallback

const asInteger = (value: unknown, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.round(number) : fallback
}

const asPackHorizontalGrid = (value: unknown, pack: BrickPack, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return pack === 'minecraft' ? Math.round(number) : normalizeHorizontalStud(number)
}

const normalizeMinecraftYStud = (value: number) => Number((Math.round(value * 4) / 4).toFixed(2))

const asPackYGrid = (value: unknown, pack: BrickPack, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return pack === 'minecraft' ? normalizeMinecraftYStud(number) : normalizeYStud(number)
}

const asLegacyPlateGrid = (value: unknown, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? plateHeightToWorldStud(number) : fallback
}

const clampRotation = (value: unknown) => {
  const rotation = asInteger(value, 0)
  return (((rotation % 4) + 4) % 4) as 0 | 1 | 2 | 3
}

const normalizeBrickPose = (brick: PlacedBrick, pack: BrickPack): PlacedBrick => ({
  ...brick,
  pose: {
    ...brick.pose,
    xStud: pack === 'minecraft' ? Math.round(brick.pose.xStud) : normalizeHorizontalStud(brick.pose.xStud),
    yStud: pack === 'minecraft' ? normalizeMinecraftYStud(brick.pose.yStud) : normalizeYStud(brick.pose.yStud),
    zStud: pack === 'minecraft' ? Math.round(brick.pose.zStud) : normalizeHorizontalStud(brick.pose.zStud),
    rotationQuarterTurns: clampRotation(brick.pose.rotationQuarterTurns),
    verticalQuarterTurns: clampRotation(brick.pose.verticalQuarterTurns ?? 0),
  },
})

const formatInventoryForPrompt = (inventory: number) =>
  Number.isFinite(inventory) ? String(inventory) : 'unlimited'

const formatLegoHeightForPrompt = (heightStuds: number) =>
  Number((heightStuds / PLATE_HEIGHT_WORLD).toFixed(3))

const getGenerationParts = (pack: BrickPack, partIds?: string[]) => brickDefinitions
  .filter((brick) => brick.pack === pack && (pack !== 'lego' || (!brick.id.startsWith('hogwarts-') && !brick.id.startsWith('architecture-'))))
  // Set-specific printed nameplates are only meaningful in their replicas.
  .filter((brick) => pack !== 'lego' || !brick.id.endsWith('-nameplate'))
  .filter(brick => !partIds || partIds.includes(brick.id))

/**
 * The LEGO catalogue in a compact form. Colours are most of its size, so the
 * colours most parts share are listed once as palette "*" and each part lists
 * only its differences. LDraw codes are shown under their readable ids
 * (reddish-brown, dark-gray); module expansion maps them back to each part.
 */
const formatLegoInventory = (parts: BrickDefinition[], inventoryOverrides?: Record<string, number>) => {
  const colorsById = new Map(parts.map((brick) => [brick.id, canonicalColorIds(brick.colors)]))
  const counts = new Map<string, number>()
  for (const colors of colorsById.values()) for (const color of colors) counts.set(color, (counts.get(color) ?? 0) + 1)
  // Only worth a palette when several parts share it.
  const common = parts.length >= 6 ? [...counts].filter(([, count]) => count >= parts.length * 0.4).map(([color]) => color) : []
  const commonSet = new Set(common)
  const describe = (colors: string[]) => {
    const plain = colors.join('/')
    if (!common.length) return plain
    const has = new Set(colors)
    const missing = common.filter((color) => !has.has(color))
    const extra = colors.filter((color) => !commonSet.has(color))
    const delta = `*${missing.length ? ` -${missing.join('/')}` : ''}${extra.length ? ` +${extra.join('/')}` : ''}`
    return delta.length < plain.length ? delta : plain
  }
  const coded = describeCodedColors([...counts.keys()])
  const header = [
    'Each line: id: name, footprint WxD, height in plates, kind; colours; inventory (unlimited unless listed).',
    'Kind tile has a smooth top and cannot support another brick. Kind slope supports only at its actual stud positions, not its full footprint.',
    ...(common.length ? [`Colour palette * = ${common.join('/')}. "* -a +b" means the palette without a, plus b.`] : []),
    ...(coded.length ? [`Coded colours: ${coded.join(', ')}.`] : []),
  ]
  return [...header, ...parts.map((brick) => {
    const inventory = inventoryOverrides?.[brick.id] ?? brick.inventory
    return `${brick.id}: ${brick.name}, ${brick.footprint.widthStuds}x${brick.footprint.depthStuds}, ${formatLegoHeightForPrompt(brick.footprint.heightStuds)}p, ${brick.kind}; ${describe(colorsById.get(brick.id)!)}${Number.isFinite(inventory) ? `; inventory ${inventory}` : ''}`
  })].join('\n')
}

const getInventorySummary = (pack: BrickPack = 'lego', inventoryOverrides?: Record<string, number>, partIds?: string[]) => {
  const parts = getGenerationParts(pack, partIds)
  if (pack === 'lego') return formatLegoInventory(parts, inventoryOverrides)
  return parts.map((brick) => {
    const inventory = inventoryOverrides?.[brick.id] ?? brick.inventory
    const shape = brick.voxelVisual?.shape ?? 'cube'
    const supportNote = shape === 'cross' ? ', plant: must sit on a solid cube top' : ''
    return `${brick.id}: ${brick.name}, shape ${shape}, size ${brick.footprint.widthStuds}x${brick.footprint.depthStuds}x${brick.footprint.heightStuds} blocks, colors ${brick.colors.join('/')}, inventory ${formatInventoryForPrompt(inventory)}${supportNote}`
  }).join('\n')
}

export const llmSystemPrompt = 'You are a brick build-planning engine. Return compact valid JSON only. Do not include reasoning.'

const formatOfficialReplicaExample = () => {
  const plan = generateBuildPlan({ prompt: '一个 Classic 小幽灵' })
  const example = {
    title: 'Classic Little Ghost',
    bricks: plan.bricks.map((brick) => ({
      brickId: brick.brickId,
      color: brick.color,
      xStud: brick.pose.xStud,
      yStud: brick.pose.yStud,
      zStud: brick.pose.zStud,
      rotationQuarterTurns: brick.pose.rotationQuarterTurns,
      verticalQuarterTurns: brick.pose.verticalQuarterTurns ?? 0,
    })),
  }

  return JSON.stringify(example, null, 2)
}

const formatMinecraftExample = () => JSON.stringify({
  title: 'Small Oak Tree',
  bricks: [
    { brickId: 'minecraft-oak-log', color: 'brown', xStud: 1, yStud: 0, zStud: 1, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
    { brickId: 'minecraft-oak-log', color: 'brown', xStud: 1, yStud: 1, zStud: 1, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
    { brickId: 'minecraft-oak-log', color: 'brown', xStud: 1, yStud: 2, zStud: 1, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
    { brickId: 'minecraft-oak-leaves', color: 'green', xStud: 0, yStud: 2, zStud: 1, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
    { brickId: 'minecraft-oak-leaves', color: 'green', xStud: 2, yStud: 2, zStud: 1, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
    { brickId: 'minecraft-oak-leaves', color: 'green', xStud: 1, yStud: 2, zStud: 0, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
    { brickId: 'minecraft-oak-leaves', color: 'green', xStud: 1, yStud: 2, zStud: 1, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
    { brickId: 'minecraft-oak-leaves', color: 'green', xStud: 1, yStud: 3, zStud: 1, rotationQuarterTurns: 0, verticalQuarterTurns: 0 },
  ],
}, null, 2)

const minecraftRules = `Rules:
- Use 1 to ${maxLlmBricks} blocks.
- Output the title in English, even if the user request is not English.
- xStud and zStud are whole studs. Most blocks occupy 1x1, while doors, panes, lanterns, chests, and cacti use the exact listed size. yStud is measured in blocks and must use 0.25 increments.
- yStud must be 0 or higher. A block resting on a full cube has yStud exactly 1 above the cube's yStud; a slab adds only 0.5.
- rotationQuarterTurns orients stairs and fences and must be 0, 1, 2, or 3. Keep it 0 for plain cubes.
- verticalQuarterTurns must always be 0 for this block set.
- Keep the model compact, usually inside x=0..7 and z=0..7.
- Every raised block must sit directly on another block's top face. Plants (shape cross) may only sit on a solid cube, never on slabs, stairs, fences, or other plants.
- Stairs and slabs still need a solid block or ground directly below them.
- Avoid floating blocks. The final model must be one connected structure through shared faces; fences may bridge small gaps only when both ends touch a block.
- Prefer terrain and wood blocks for landscapes, stone and deepslate for cliffs and caves, ores embedded inside stone walls, and glow lamps or redstone blocks for light accents.
- When a reference image is provided, first block out its silhouette with full cubes, then refine thin layers with slabs and sloped edges with stairs; do not trace pixel-level detail.
- Use only available block ids and their listed colors.
- Do not include markdown or explanatory text.

Good voxel example, a small oak tree:
${formatMinecraftExample()}`

const legoRules = `Rules:
- Use 1 to ${maxLlmBricks} bricks.
- Output the title in English, even if the user request is not English.
- Coordinates use one world unit: xStud, yStud, and zStud are all measured in studs and may use 0.1 increments. One plate is 0.4 studs tall.
- yStud must be 0 or higher.
- rotationQuarterTurns is horizontal rotation and must be 0, 1, 2, or 3.
- verticalQuarterTurns is vertical rotation and must be 0, 1, 2, or 3. Use it when a part must stand on its side, such as a tile attached to a side stud.
- Keep the model compact, usually inside x=0..8 and z=0..6.
- Most raised bricks should sit directly on another brick: yStud should equal the lower brick top height, and their x/z footprints should overlap.
- Side-mounted parts may be supported by aligned side connectors instead of vertical footprint overlap.
- Avoid overlapping bricks. Never place disconnected decorative islands far away from the main object.
- The final model must be one connected structure through vertical stud support or connector alignment. Do not place separate ground-level islands unless they are connected by a shared base plate.
- Wheel and axle pieces are currently disabled, so do not build wheeled vehicles. Prefer static models such as houses, trees, bridges, benches, castles, flowers, rockets, animals, or robots.
- Rotating or side-mounted mechanical parts must attach through compatible pin, bar, clip, stud, or socket connectors; never leave a propeller or decoration floating.
- Use only available brick ids and their listed colors.
- Do not include markdown or explanatory text.

Good official-replica example, calibrated from LEGO Classic 10696 Ghost:
${formatOfficialReplicaExample()}`

const buildSmallLlmUserPrompt = ({ prompt, imageName, inventoryOverrides, pack = 'lego' }: GeneratorInput) => `You generate small ${pack === 'minecraft' ? 'voxel block build plans' : 'brick build plans'} for a browser 3D editor.

User request: ${prompt}
Reference image file name: ${imageName || 'none'}

Available parts:
${getInventorySummary(pack, inventoryOverrides)}

Return only valid JSON with this exact shape:
{
  "title": "short English title",
  "bricks": [
    {
      "brickId": "one available part id",
      "color": "one allowed color for that part",
      "xStud": 0,
      "yStud": 0,
      "zStud": 0,
      "rotationQuarterTurns": 0,
      "verticalQuarterTurns": 0
    }
  ]
}

${pack === 'minecraft' ? minecraftRules : legoRules}`

export const buildLlmUserPrompt = (input: GeneratorInput): string => {
  if (input.pack === 'minecraft') return buildSmallLlmUserPrompt(input)
  return `You design LEGO brick build plans for a browser 3D editor.
User request: ${input.prompt}
Reference image: ${input.imageName ?? 'none'}
Tools (every module MUST specify tool):
- "building": optional parametric hall with buttresses and glazed bays (width 8 or 16, wallCourses 6–10; base (width+4)x12 studs; roof ridge Y=origin.y+1.2+wallCourses*1.2+4.8). Include its complete inline program so no second request is needed: "program":{"commands":[{"kind":"building","at":[0,0,0],"width":16,"wallCourses":8,"wallColor":"tan","roofColor":"gray","windowColor":"black","trimColor":"white","baseColor":"gray"}]}. Do not expand into raw bricks or place a foundation under it; attach later modules outside its volume.
- "sculpture": for recognizable characters/animals, use one module with sculpture-shapes (overlapping ellipsoid/box volumes for head, torso, arms/hands, feet with curved-surface markings for face/clothing). State actual proportions, anatomy and features; plan a 3D figure (~16–20W x 10–14D x 20–26H studs, <=2048 parts) facing +Z (front = max Z), with eye whites, pupils, projecting nose, mouth and small accessories.
- "parts": custom shapes from individual real bricks, arrays and structural primitives (deck surfaces, walls with coloured openings, stepped roofs). Each parts module receives the exact part/colour/inventory catalogue (including brick-1x1) at assembly time.
Plan silhouette, proportions, palette and attachment interfaces now. Return only a compact module layout—never an individual brick list—and keep each module description under 80 words. Leave brick placement, connectors and collision checks to assembly.
JSON format: {"title":"English title","modules":[{"name":"Main structure","tool":"parts","description":"Exact dimensions, palette and requested character","requiredColors":["gray"],"origin":[0,0,0]}]}.
Use 1–${assemblyLimits.modules} modules in construction order (1–3 when sufficient), at most ${assemblyLimits.moduleBricks} expanded parts per module and ${assemblyLimits.bricks} total. A shared connected foundation must precede walls, towers, roofs and decoration; bridge ground-plate seams with two staggered overlapping plate layers (plates have studs only at listed grid positions). Later modules attach to accepted modules via world-coordinate interfaces and use local coordinates relative to their origin during assembly.
For regular rectangular cabins/houses, plan a studded foundation, separate wall shell, then roof, with inline programs for simple foundation/wall modules so the editor compiles them locally. Example: foundation at [0,0,0] with {"kind":"deck","at":[0,0,0],"size":[12,10],"color":"green"}; wall module depending on it at [1,0.8,1] with "program":{"commands":[{"kind":"walls","at":[0,0,0],"size":[10,8],"courses":4,"color":"brown","openings":[{"side":"front","offset":4,"width":2,"bottom":0,"height":3,"color":"black"}]}]}. Wall top is origin.y + 1.2 * courses; attach the next module there. Sides: front=min Z, back=max Z, left=min X, right=max X. For a real window frame add "part":"window" with even width/height and >=1 stud at each corner. Put porch furniture, foliage and custom geometry in separate parts modules without inline programs.
Every parts or sculpture module must specify requiredColors using hyphenated colour ids (e.g. dark-gray, reddish-brown, trans-yellow) for all identifying features (body, face, pupils, clothing, accents) and assign each in its description; they are verified against compiled parts and must survive repair. Include characteristic facial features rather than a blank face.
Give every module after the first a dependsOn array of earlier module names it attaches to (modules attaching only to the foundation list only that module for parallel generation).
Positions are the min X/Z corner and bottom Y of the rotated footprint (a 4x2 brick at [0,0,0] spans X=0..4, Z=0..2, Y=0..1.2; odd quarter turns 0–3 swap width/depth). Coordinates use the 0.1-stud grid; one plate is 0.4 studs tall. Every construction prefix must be connected, supported, non-overlapping and use compatible connectors, legal colours and available inventory.
Return only the chosen JSON shape; module programs are requested separately. Do not claim fidelity to an official set without its instructions and inventory.`
}

export const buildLlmRepairPrompt = (previousPlan: BuildPlan, repairFeedback: string) => `

The previous candidate failed the editor's structural validator.
Validation feedback: ${repairFeedback}

Previous candidate:
${JSON.stringify({
  title: previousPlan.title,
  bricks: previousPlan.bricks.map((brick) => ({
    brickId: brick.brickId,
    color: brick.color,
    ...brick.pose,
  })),
})}

Return a corrected full replacement JSON plan. Preserve the recognizable subject, but remove collisions, below-ground parts, unsupported parts, disconnected islands, and impossible mechanical attachments. Follow every original rule and do not explain the changes.`

const extractTextContent = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractTextContent).join('')
  if (!isRecord(value)) return ''

  const text = value.text
  if (typeof text === 'string') return text
  if (isRecord(text) && typeof text.value === 'string') return text.value

  const content = value.content
  if (typeof content === 'string' || Array.isArray(content)) return extractTextContent(content)

  const outputText = value.output_text
  if (typeof outputText === 'string') return outputText

  const response = value.response
  if (typeof response === 'string') return response

  return ''
}

const stringifyDirectJsonPayload = (payload: Record<string, unknown>) => {
  if (typeof payload.ok === 'boolean' || Array.isArray(payload.bricks) || Array.isArray(payload.modules) || Array.isArray(payload.commands)) return JSON.stringify(payload)
  return ''
}

const extractMessageContent = (payload: unknown) => {
  if (!isRecord(payload)) return ''

  const directContent = extractTextContent(payload.output_text)
    || extractTextContent(payload.response)
    || extractTextContent(payload.content)
    || extractTextContent(payload.message)
    || extractTextContent(payload.output)
  if (directContent) return directContent

  const choices = payload.choices
  if (Array.isArray(choices)) {
    const choiceContent = choices
      .map((choice) => {
        if (!isRecord(choice)) return ''
        return extractTextContent(choice.message)
          || extractTextContent(choice.delta)
          || extractTextContent(choice.text)
      })
      .join('')
    if (choiceContent) return choiceContent
  }

  return stringifyDirectJsonPayload(payload)
}

const extractReasoningContent = (payload: unknown) => {
  if (!isRecord(payload)) return ''
  const fromRecord = (value: unknown) => {
    if (!isRecord(value)) return ''
    return extractTextContent(value.reasoning_content)
      || extractTextContent(value.reasoning)
      || extractTextContent(value.thinking)
  }
  const directReasoning = fromRecord(payload)
    || fromRecord(payload.message)
    || fromRecord(payload.delta)
  if (directReasoning) return directReasoning
  return Array.isArray(payload.choices)
    ? payload.choices.map((choice) => (
        fromRecord(choice)
        || (isRecord(choice) ? fromRecord(choice.message) || fromRecord(choice.delta) : '')
      )).join('')
    : ''
}

const readUsageNumber = (...values: unknown[]) => {
  const value = values.find((candidate) => typeof candidate === 'number' && Number.isFinite(candidate))
  return typeof value === 'number' ? Math.max(0, Math.round(value)) : undefined
}

const extractLlmTokenUsage = (payload: unknown): LlmTokenUsage | undefined => {
  if (!isRecord(payload)) return undefined
  const usage = isRecord(payload.usage)
    ? payload.usage
    : isRecord(payload.usage_metadata)
      ? payload.usage_metadata
      : undefined
  if (!usage) return undefined
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : undefined
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : undefined
  const inputTokens = readUsageNumber(usage.prompt_tokens, usage.input_tokens, usage.promptTokenCount)
  const outputTokens = readUsageNumber(usage.completion_tokens, usage.output_tokens, usage.candidatesTokenCount)
  const cachedTokens = readUsageNumber(
    promptDetails?.cached_tokens,
    inputDetails?.cached_tokens,
    usage.cached_tokens,
    usage.total_cached_tokens,
    usage.cache_read_input_tokens,
    usage.cachedContentTokenCount,
  )
  const totalTokens = readUsageNumber(usage.total_tokens, usage.totalTokenCount)
  return inputTokens !== undefined || outputTokens !== undefined || cachedTokens !== undefined || totalTokens !== undefined
    ? {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(cachedTokens !== undefined ? { cachedTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
      }
    : undefined
}

const extractReasoningTokens = (payload: unknown) => {
  if (!isRecord(payload)) return undefined
  const usage = isRecord(payload.usage) ? payload.usage : isRecord(payload.usage_metadata) ? payload.usage_metadata : undefined
  if (!usage) return undefined
  const completion = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : undefined
  const output = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : undefined
  return readUsageNumber(completion?.reasoning_tokens, output?.reasoning_tokens, usage.reasoning_tokens, usage.thoughtsTokenCount)
}

const extractLlmFinishReason = (payload: unknown) => {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined
  const reason = payload.choices
    .map((choice) => isRecord(choice) ? choice.finish_reason : undefined)
    .find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate))
  return reason
}

const hasReasoningOnlyLengthFinish = (payload: unknown) => {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return false

  return payload.choices.some((choice) => {
    if (!isRecord(choice)) return false
    const finishReason = choice.finish_reason
    const reasoningContent = extractTextContent(choice.reasoning_content)
      || (isRecord(choice.message) ? extractTextContent(choice.message.reasoning_content) : '')
      || (isRecord(choice.delta) ? extractTextContent(choice.delta.reasoning_content) : '')

    return finishReason === 'length' && Boolean(reasoningContent)
  })
}

const formatEmptyContentError = (payload: unknown, context: string, locale: LlmLocale) =>
  hasReasoningOnlyLengthFinish(payload)
    ? llmText[locale].reasoningOnlyLength(context)
    : llmText[locale].noTextContent(context)

const parseJsonContent = (content: string, locale: LlmLocale): LlmPlan => {
  const trimmed = content.trim()
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = fencedMatch?.[1] ?? trimmed
  const objectMatch = jsonText.match(/\{[\s\S]*\}/)
  const parsed = JSON.parse(objectMatch?.[0] ?? jsonText) as unknown

  if (!isRecord(parsed)) throw new Error(llmText[locale].notJsonObject)
  return parsed as LlmPlan
}

const quotaError = (locale: LlmLocale, seconds?: number) => {
  const wait = seconds && seconds > 0 ? (locale === 'zh-CN' ? `请在 ${seconds} 秒后重试` : `Retry after ${seconds} seconds`) : (locale === 'zh-CN' ? '请稍后重试' : 'Try again later')
  return new LlmServiceError(locale === 'zh-CN'
    ? `模型服务已触发请求或 Token 配额限制（429）。${wait}，或更换可用模型。`
    : `The model service hit its request or token quota (429). ${wait}, or choose another available model.`, 429)
}

const checkProviderError = (payload: unknown, locale: LlmLocale): void => {
  if (Array.isArray(payload)) { payload.forEach(item => checkProviderError(item, locale)); return }
  if (!isRecord(payload) || !payload.error) return
  const error = isRecord(payload.error) ? payload.error : { message: String(payload.error) }
  const status = Number(error.code ?? payload.code) || (error.status === 'RESOURCE_EXHAUSTED' ? 429 : 502)
  if (status === 429) throw quotaError(locale)
  const message = String(error.message ?? 'Upstream generation failed').slice(0, 240)
  throw new LlmServiceError(locale === 'zh-CN' ? `模型服务返回错误（${status}）：${message}` : `Model service error (${status}): ${message}`, status)
}

const formatRequestError = async (response: Response, requestMode: LlmConfig['requestMode'], locale: LlmLocale) => {
  const labels = llmText[locale]
  const detail = await response.text()

  let upstreamStatus = response.status
  try {
    const body = JSON.parse(detail)
    if (typeof body?.upstreamStatus === 'number') upstreamStatus = body.upstreamStatus
  } catch { /* Non-JSON errors still retain their HTTP status. */ }
  if (upstreamStatus === 429) {
    const retryAfter = response.headers.get('retry-after')
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined
    throw quotaError(locale, seconds)
  }
  if (requestMode === 'proxy' && response.status === 404) {
    return labels.proxyUnavailable
  }

  try {
    const parsed = JSON.parse(detail) as unknown
    if (isRecord(parsed) && typeof parsed.error === 'string') {
      const upstreamStatus = typeof parsed.upstreamStatus === 'number' ? labels.upstreamStatus(parsed.upstreamStatus) : ''
      const endpoint = typeof parsed.endpoint === 'string' ? labels.endpoint(parsed.endpoint) : ''
      const upstreamBody = typeof parsed.upstreamBody === 'string' ? labels.upstreamBody(parsed.upstreamBody.slice(0, 160)) : ''
      return labels.requestFailed(`${parsed.error}${upstreamStatus}${endpoint}${upstreamBody}`)
    }
  } catch {
    return labels.requestFailed(`${response.status} ${detail.slice(0, 160)}`)
  }

  return labels.requestFailed(`${response.status} ${detail.slice(0, 160)}`)
}

const requestLlmChat = (config: LlmConfig, payload: LlmRequestPayload, signal: AbortSignal) => {
  signal.throwIfAborted()
  const endpoint = chatCompletionEndpoint(config.endpoint)
  const apiKey = config.apiKey.trim()
  const mandatory = mandatoryReasoningModels.has(`${endpoint}\n${config.modelName}`)
  const requestedTokens = Number(payload.max_tokens) || 4096
  const maxTokens = mandatory && requestedTokens > configTestMaxTokens
    ? Math.max(requestedTokens, 32_768) : requestedTokens
  payload = { ...payload, max_tokens: aiTasks.request(signal, maxTokens) }
  if (new URL(endpoint).hostname === 'openrouter.ai') {
    const enabled = payload.enable_thinking === true
    const reasoning = enabled ? { enabled: true, effort: 'high' }
      : mandatory ? { enabled: true, effort: 'low' } : { enabled: false }
    payload = { ...payload, reasoning }
    delete payload.enable_thinking
    delete payload.thinking
    delete payload.reasoning_effort
  }

  if (config.requestMode === 'proxy') {
    return fetch('/api/llm/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        endpoint,
        apiKey,
        payload,
      }),
    })
  }

  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify(payload),
  })
}

const withoutThinkingParameters = (payload: LlmRequestPayload): LlmRequestPayload => {
  const compatiblePayload = { ...payload }
  delete compatiblePayload.thinking
  delete compatiblePayload.enable_thinking
  return compatiblePayload
}

const withoutReasoningEffort = (payload: LlmRequestPayload): LlmRequestPayload => {
  const compatiblePayload = { ...payload }
  delete compatiblePayload.reasoning_effort
  return compatiblePayload
}

const withoutStreamOptions = (payload: LlmRequestPayload): LlmRequestPayload => {
  const compatiblePayload = { ...payload }
  delete compatiblePayload.stream_options
  return compatiblePayload
}

const requestLlmChatWithCompatibility = async (
  config: LlmConfig,
  payload: LlmRequestPayload,
  signal: AbortSignal,
) => {
  const compatiblePayload = () => {
    let next = payload
    if (omitUnsupportedThinkingParameters) next = withoutThinkingParameters(next)
    if (omitUnsupportedReasoningEffort) next = withoutReasoningEffort(next)
    if (omitUnsupportedStreamOptions) next = withoutStreamOptions(next)
    return next
  }
  let response = await requestLlmChat(config, compatiblePayload(), signal)
  if (response.ok) return response
  let detail = (await withAbortSignal(signal, () => response.clone().text())).toLowerCase()
  const endpoint = chatCompletionEndpoint(config.endpoint)
  if (new URL(endpoint).hostname === 'openrouter.ai'
    && detail.includes('reasoning is mandatory') && detail.includes('cannot be disabled')) {
    mandatoryReasoningModels.add(`${endpoint}\n${config.modelName}`)
    response = await requestLlmChat(config, compatiblePayload(), signal)
    if (response.ok) return response
    detail = (await withAbortSignal(signal, () => response.clone().text())).toLowerCase()
  }
  // Providers reject unknown fields one message at a time (NVIDIA names only
  // enable_thinking first). Drop whichever fields each error names and retry,
  // at most once per field group.
  for (;;) {
    let changed = false
    if (!omitUnsupportedReasoningEffort && detail.includes('reasoning_effort')) {
      omitUnsupportedReasoningEffort = true
      changed = true
    }
    if (!omitUnsupportedThinkingParameters && (detail.includes('enable_thinking') || /\bthinking\b/.test(detail.replaceAll('reasoning_effort', '')))) {
      omitUnsupportedThinkingParameters = true
      changed = true
    }
    if (!omitUnsupportedStreamOptions && detail.includes('stream_options')) {
      omitUnsupportedStreamOptions = true
      changed = true
    }
    if (!changed) return response
    response = await requestLlmChat(config, compatiblePayload(), signal)
    if (response.ok) return response
    detail = (await withAbortSignal(signal, () => response.clone().text())).toLowerCase()
  }
}

const formatFetchError = (error: unknown, requestMode: LlmConfig['requestMode'], locale: LlmLocale) => {
  if (requestMode === 'direct' && error instanceof TypeError) {
    return new Error(llmText[locale].directCors)
  }

  return error
}

const applyThinkingMode = (payload: LlmRequestPayload, enableThinking: boolean): LlmRequestPayload => enableThinking
  ? {
      ...payload,
      enable_thinking: true,
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    }
  : {
      ...payload,
      enable_thinking: false,
      thinking: { type: 'disabled' },
    }

const nudgeToNearbyOpenPose = (brick: PlacedBrick, placed: PlacedBrick[]) => {
  if (!hasBrickCollision(brick, placed)) return brick

  for (let radius = 1; radius <= 2; radius += 1) {
    for (let zOffset = -radius; zOffset <= radius; zOffset += 1) {
      for (let xOffset = -radius; xOffset <= radius; xOffset += 1) {
        const candidate = {
          ...brick,
          pose: {
            ...brick.pose,
            xStud: normalizeHorizontalStud(brick.pose.xStud + xOffset),
            zStud: normalizeHorizontalStud(brick.pose.zStud + zOffset),
          },
        }
        if (!hasBrickCollision(candidate, placed)) return candidate
      }
    }
  }

  return undefined
}

const lowerUntilSupported = (brick: PlacedBrick, placed: PlacedBrick[], pack: BrickPack) => {
  if (isBrickSupported(brick, placed)) return brick

  const verticalStep = pack === 'minecraft' ? 0.25 : WORLD_EDIT_STEP_STUDS
  for (let yStud = brick.pose.yStud - verticalStep; yStud >= 0; yStud -= verticalStep) {
    const candidate = {
      ...brick,
      pose: {
        ...brick.pose,
        yStud: pack === 'minecraft' ? normalizeMinecraftYStud(yStud) : normalizeYStud(yStud),
      },
    }
    if (!hasBrickCollision(candidate, placed) && isBrickSupported(candidate, placed)) return candidate
  }

  return undefined
}

const normalizeBricks = (
  rawBricks: unknown,
  locale: LlmLocale,
  inventoryOverrides: Record<string, number> | undefined,
  pack: BrickPack,
): PlacedBrick[] => {
  if (!Array.isArray(rawBricks)) throw new Error(llmText[locale].missingBricks)

  const placed: PlacedBrick[] = []
  const placedCounts = new Map<string, number>()

  for (const rawBrick of rawBricks.slice(0, maxLlmBricks)) {
    if (!isRecord(rawBrick)) continue
    const brick = rawBrick as LlmBrick
    const brickId = asString(brick.brickId)
    const definition = brickById.get(brickId)
    if (!definition || definition.pack !== pack) continue
    const currentCount = placedCounts.get(brickId) ?? 0
    const inventory = inventoryOverrides?.[brickId] ?? definition.inventory
    if (Number.isFinite(inventory) && currentCount >= inventory) continue

    const pose = isRecord(brick.pose) ? brick.pose : {}
    const safeColor = resolvePartColor(definition.colors, brick.color) ?? definition.colors[0]
    const candidate = makeBrick(
      brickId,
      safeColor,
      asPackHorizontalGrid(brick.xStud ?? pose.xStud, pack, 0),
      brick.yStud !== undefined || pose.yStud !== undefined
        ? asPackYGrid(brick.yStud ?? pose.yStud, pack, 0)
        : asLegacyPlateGrid(brick.yPlate ?? pose.yPlate, 0),
      asPackHorizontalGrid(brick.zStud ?? pose.zStud, pack, 0),
      clampRotation(brick.rotationQuarterTurns ?? pose.rotationQuarterTurns),
      clampRotation(brick.verticalQuarterTurns ?? pose.verticalQuarterTurns),
    )
    const snapped = candidate
    const openBrick = nudgeToNearbyOpenPose(snapped, placed)
    if (!openBrick) continue

    const supportedBrick = lowerUntilSupported(openBrick, placed, pack)
    if (!supportedBrick) continue

    if (placed.length > 0 && supportedBrick.pose.yStud === 0) {
      const supportedOpenBrick = findSupportedOpenPose(supportedBrick, placed)
      if (supportedOpenBrick.pose.yStud > 0 && isBrickSupported(supportedOpenBrick, placed)) {
        placed.push(normalizeBrickPose(supportedOpenBrick, pack))
        placedCounts.set(brickId, currentCount + 1)
      }
      continue
    }

    placed.push(normalizeBrickPose(supportedBrick, pack))
    placedCounts.set(brickId, currentCount + 1)
  }

  if (placed.length === 0) throw new Error(llmText[locale].noUsableParts)
  return placed
}

const normalizeSteps = (bricks: PlacedBrick[]) => createSingleBrickSteps(bricks)

export const isLlmConfigComplete = (config: LlmConfig) =>
  Boolean(config.modelName.trim() && config.endpoint.trim() && config.apiKey.trim())

const testLlmConnectionImpl = async (config: LlmConfig, locale: LlmLocale = 'zh-CN', signal?: AbortSignal) => {
  resetLlmThinkingCompatibility()
  if (!isLlmConfigComplete(config)) throw new Error(llmText[locale].incompleteConfig)

  const { controller, dispose } = createRequestLifetime(signal, configTestTimeoutMs)
  aiTasks.bind(signal, controller.signal)
  let response: Response

  try {
    response = await requestLlmChatWithCompatibility(config, applyThinkingMode({
      model: config.modelName.trim(),
      messages: [
        {
          role: 'system',
          content: 'Return compact JSON only. Do not use thinking or reasoning.',
        },
        {
          role: 'user',
          content: 'Return {"ok":true}.',
        },
      ],
      temperature: 0,
      max_tokens: configTestMaxTokens,
      stream: false,
      response_format: { type: 'json_object' },
    }, false), controller.signal)

    if (!response.ok) {
      throw new Error(await formatRequestError(response, config.requestMode, locale))
    }

    aiTasks.phase(signal, 'receiving')
    const responseText = await withAbortSignal(controller.signal, () => response.text())
    controller.signal.throwIfAborted()
    if (!responseText.trim()) throw new Error(llmText[locale].emptyConfigResponse)

    aiTasks.phase(signal, 'validating')
    const payload = JSON.parse(responseText) as unknown
    checkProviderError(payload, locale)
    const content = extractMessageContent(payload)
    if (!content) throw new Error(formatEmptyContentError(payload, llmText[locale].configTestContext, locale))
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(llmText[locale].configTimeout)
    }
    throw formatFetchError(error, config.requestMode, locale)
  } finally {
    dispose()
  }
}

const requestLlmJsonContentImpl = async ({
  config,
  systemPrompt,
  userPrompt,
  images,
  signal,
  locale = 'zh-CN',
  temperature = 0.2,
  maxTokens = 4_096,
  stream = false,
  onContent, onReasoning,
}: LlmJsonRequestInput) => {
  if (!isLlmConfigComplete(config)) throw new Error(llmText[locale].incompleteConfig)

  const { controller, touch, dispose } = createRequestLifetime(signal, clientRequestTimeoutMs, clientRequestMaxMs)
  aiTasks.bind(signal, controller.signal)
  let response: Response

  try {
    response = await requestLlmChatWithCompatibility(config, applyThinkingMode({
      model: config.modelName.trim(),
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: images?.length
            ? [{ type: 'text', text: userPrompt }, ...images.map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } }))]
            : userPrompt,
        },
      ],
      temperature,
      max_tokens: maxTokens,
      stream,
      response_format: { type: 'json_object' },
    }, config.enableThinking), controller.signal)
    response = trackResponseActivity(response, touch)

    if (!response.ok) throw new Error(await formatRequestError(response, config.requestMode, locale))
    aiTasks.phase(signal, 'receiving')
    return await readGenerationContent(response, controller.signal, locale, onContent, onReasoning, tokens => noteReasoningTokens(config, tokens))

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw new Error(llmText[locale].generationCanceled)
      throw new Error(llmText[locale].generationTimeout)
    }
    throw formatFetchError(error, config.requestMode, locale)
  } finally {
    dispose()
  }
}

const readLlmEventStream = async (
  response: Response,
  onDelta: (text: string) => void,
  onReasoningDelta?: (text: string) => void,
  locale: LlmLocale = 'zh-CN',
  onReasoningTokens?: (tokens: number) => void,
) => {
  if (!response.body) return { content: '', maxTokens: 0, retryCount: 0 } satisfies LlmStreamResult
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let transportBuffer = ''
  let content = ''
  let usage: LlmTokenUsage | undefined
  let finishReason: string | undefined
  const emitPayload = (payloadText: string) => {
    const trimmed = payloadText.trim()
    if (!trimmed || trimmed === '[DONE]') return
    let payload: unknown
    try { payload = JSON.parse(trimmed) } catch {
      content += payloadText
      onDelta(payloadText)
      return
    }
    checkProviderError(payload, locale)
    usage = extractLlmTokenUsage(payload) ?? usage
    const reasoningTokens = extractReasoningTokens(payload)
    if (reasoningTokens !== undefined) onReasoningTokens?.(reasoningTokens)
    finishReason = extractLlmFinishReason(payload) ?? finishReason
    const reasoningDelta = extractReasoningContent(payload)
    if (reasoningDelta) onReasoningDelta?.(reasoningDelta)
    const delta = extractMessageContent(payload)
    if (!delta) return
    content += delta
    onDelta(delta)
  }

  try {
    while (true) {
      const chunk = await reader.read()
      transportBuffer += decoder.decode(chunk.value, { stream: !chunk.done })
      const records = transportBuffer.split(/\r?\n\r?\n/)
      transportBuffer = records.pop() ?? ''
      for (const record of records) {
        const dataLines = record.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
        if (dataLines.length > 0) emitPayload(dataLines.join('\n'))
        else if (/^[{[]/.test(record.trim())) emitPayload(record)
      }
      if (chunk.done) break
    }
    if (transportBuffer.trim()) {
      const lines = transportBuffer.split(/\r?\n/).filter(line => line.startsWith('data:'))
      if (lines.length) emitPayload(lines.map(line => line.slice(5).trimStart()).join('\n'))
      else if (/^[{[]/.test(transportBuffer.trim())) emitPayload(transportBuffer)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }

  return {
    content,
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finishReason } : {}),
    maxTokens: 0,
    retryCount: 0,
  } satisfies LlmStreamResult
}

const readGenerationContent = async (response: Response, signal: AbortSignal, locale: LlmLocale, onContent?: (text: string) => void, onReasoning?: () => void, onReasoningTokens?: (tokens: number) => void) => {
  let content: string
  let finishReason: string | undefined
  let reasoningLength = 0
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const result = await withAbortSignal(signal, () => readLlmEventStream(response, text => onContent?.(text), text => { reasoningLength += text.length; onReasoning?.() }, locale, onReasoningTokens))
    aiTasks.usage(signal, result.usage?.outputTokens)
    content = result.content
    finishReason = result.finishReason
  } else {
    const payload: unknown = await withAbortSignal(signal, () => response.json())
    checkProviderError(payload, locale)
    content = extractMessageContent(payload)
    if (content) onContent?.(content)
    finishReason = extractLlmFinishReason(payload)
    reasoningLength = extractReasoningContent(payload).length
    const reasoningTokens = extractReasoningTokens(payload)
    if (reasoningTokens !== undefined) onReasoningTokens?.(reasoningTokens)
    aiTasks.usage(signal, extractLlmTokenUsage(payload)?.outputTokens)
    if (!content && finishReason !== 'length') throw new Error(formatEmptyContentError(payload, llmText[locale].responseContext, locale))
  }
  if (finishReason === 'length') {
    // A provider can report length after emitting an already complete JSON object.
    try { parseJsonContent(content, locale) } catch {
      throw new LlmOutputLimitError(locale, !content.trim() && reasoningLength > 0)
    }
  }
  if (!content.trim()) throw new Error(llmText[locale].emptyGenerationResponse)
  return content
}

export const getLlmEmptyResponseRetryTokens = (maxTokens: number) => Math.min(
  emptyStreamRetryMaxTokens,
  Math.max(emptyStreamRetryFloorTokens, Math.max(1, Math.round(maxTokens)) * 2),
)

const requestLlmTextStreamImpl = async ({
  config,
  systemPrompt,
  userPrompt,
  messages,
  signal,
  locale = 'zh-CN',
  temperature = 0.5,
  maxTokens = 4_096,
  onDelta,
  onReasoningDelta,
}: LlmStreamRequestInput) => {
  if (!isLlmConfigComplete(config)) throw new Error(llmText[locale].incompleteConfig)
  const requestMessages = messages?.length
    ? messages
    : systemPrompt && userPrompt
      ? [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: userPrompt },
        ]
      : []
  if (requestMessages.length === 0) throw new Error('LLM messages are required.')
  const { controller, touch, dispose } = createRequestLifetime(signal, clientRequestTimeoutMs, clientRequestMaxMs)
  aiTasks.bind(signal, controller.signal)
  try {
    const retryMaxTokens = getLlmEmptyResponseRetryTokens(maxTokens)
    const tokenBudgets = retryMaxTokens > maxTokens ? [maxTokens, retryMaxTokens] : [maxTokens]
    for (let attempt = 0; attempt < tokenBudgets.length; attempt += 1) {
      const attemptMaxTokens = tokenBudgets[attempt]
      const response = trackResponseActivity(await requestLlmChatWithCompatibility(config, applyThinkingMode({
        model: config.modelName.trim(),
        messages: requestMessages,
        temperature,
        max_tokens: attemptMaxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }, config.enableThinking), controller.signal), touch)
      if (!response.ok) throw new Error(await formatRequestError(response, config.requestMode, locale))
      aiTasks.phase(signal, 'receiving')
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (!contentType.includes('text/event-stream') && contentType.includes('application/json')) {
        const payload = await withAbortSignal(controller.signal, () => response.json()) as unknown
        checkProviderError(payload, locale)
        const reasoning = extractReasoningContent(payload)
        if (reasoning) onReasoningDelta?.(reasoning)
        const content = extractMessageContent(payload)
        if (!content) {
          if (attempt + 1 < tokenBudgets.length) continue
          throw new Error(formatEmptyContentError(payload, llmText[locale].responseContext, locale))
        }
        onDelta(content)
        const usage = extractLlmTokenUsage(payload)
        const finishReason = extractLlmFinishReason(payload)
        return {
          content,
          ...(usage ? { usage } : {}),
          ...(finishReason ? { finishReason } : {}),
          maxTokens: attemptMaxTokens,
          retryCount: attempt,
        } satisfies LlmStreamResult
      }
      const result = await withAbortSignal(controller.signal, () => readLlmEventStream(response, onDelta, onReasoningDelta, locale))
      if (result.content.trim()) {
        return { ...result, maxTokens: attemptMaxTokens, retryCount: attempt }
      }
      if (attempt + 1 >= tokenBudgets.length) throw new Error(llmText[locale].emptyGenerationResponse)
    }
    throw new Error(llmText[locale].emptyGenerationResponse)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw new Error(llmText[locale].generationCanceled)
      throw new Error(llmText[locale].generationTimeout)
    }
    throw formatFetchError(error, config.requestMode, locale)
  } finally {
    dispose()
  }
}

const generatePlannedAssembly = async (checkpoint: AssemblyCheckpoint, input: LlmGenerateInput) => {
  const { prompt, imageName, config, inventoryOverrides, signal, locale = 'zh-CN' } = input
  saveAssemblyCheckpoint(checkpoint)
  const plan = await generateAssembly(checkpoint.layout, { prompt, imageName }, async (modulePrompt, tool, onProgram, options) => {
    // Requests started ahead of the current module must not change its phase.
    const foreground = !options?.background
    // The layout already exists; until the first command streams in, the
    // model is working on this module rather than re-planning the build.
    if (foreground) input.onPhase?.('thinking')
    const push = input.onDraft && onProgram
      ? createStreamedAssembly(program => { if (foreground) input.onPhase?.('building'); onProgram(program) })
      : undefined
    const requestSignal = options?.signal ?? signal
    // Count background requests against the same generation task.
    if (options?.signal) aiTasks.bind(signal, options.signal)
    const content = await requestLlmJsonContentImpl({
      config, signal: requestSignal, locale, systemPrompt: llmSystemPrompt,
      userPrompt: `User request: ${prompt}\nAvailable parts:\n${tool === 'building' ? 'The building tool uses real standard LEGO parts. Choose parameter colours from its allowed palette.' : getInventorySummary('lego', inventoryOverrides, tool === 'sculpture' ? ['plate-1x1', 'plate-1x2', 'plate-1x3', 'plate-1x4', 'plate-2x2', 'plate-2x3', 'plate-2x4', 'plate-4x4'] : undefined)}\n${modulePrompt}`,
      // Leave room for hidden reasoning when the model reasons regardless.
      maxTokens: tool === 'building'
        ? (modelReasonsWhenDisabled(config) ? 8_192 : 1_024)
        : config.enableThinking || modelReasonsWhenDisabled(config) ? generationThinkingMaxTokens : generationMaxTokens,
      stream: true,
      onContent: push, onReasoning: foreground ? () => input.onPhase?.('thinking') : undefined,
    })
    return parseJsonContent(content, locale)
  }, signal, inventoryOverrides, config.autoRepair ? normalizeMaxRepairAttempts(config.maxRepairAttempts) : 0, locale, {
    programs: checkpoint.programs,
    save: programs => saveAssemblyCheckpoint({ ...checkpoint, programs }),
    onProgress: async plan => { input.onPhase?.('building'); await input.onProgress?.(plan) },
    onDraft: input.onDraft,
    onModule: input.onModuleProgress,
    onIssue: input.onAssemblyIssue,
  })
  clearAssemblyCheckpoint(checkpoint.signature)
  return plan
}

const generateLlmBuildPlanImpl = async ({ prompt, imageName, imageDataUrl, inventoryOverrides, pack, config, signal, locale = 'zh-CN', repairFeedback, previousPlan, onProgress, onDraft, onPhase, onModuleProgress, onAssemblyIssue }: LlmGenerateInput): Promise<BuildPlan> => {
  if (!isLlmConfigComplete(config)) throw new Error(llmText[locale].incompleteConfig)

  const input = { prompt, imageName, imageDataUrl, inventoryOverrides, pack, config, signal, locale, onProgress, onDraft, onPhase, onModuleProgress, onAssemblyIssue }
  onPhase?.('planning')
  const signature = (pack ?? 'lego') === 'lego' && !previousPlan ? await assemblyCheckpointSignature(input, config) : ''
  signal?.throwIfAborted()
  const checkpoint = signature ? loadAssemblyCheckpoint(signature) : undefined
  if (checkpoint) return generatePlannedAssembly(checkpoint, input)

  const { controller, touch, dispose } = createRequestLifetime(signal, clientRequestTimeoutMs, clientRequestMaxMs)
  aiTasks.bind(signal, controller.signal)
  let response: Response
  const userPrompt = `${(previousPlan ? buildSmallLlmUserPrompt : buildLlmUserPrompt)({ prompt, imageName, inventoryOverrides, pack })}${
    repairFeedback && previousPlan ? buildLlmRepairPrompt(previousPlan, repairFeedback) : ''
  }`

  try {
    let content = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      controller.signal.throwIfAborted()
      const recovery = (pack ?? 'lego') === 'lego'
        ? '\nThe previous response exceeded the output budget. Return ONLY a compact layout {"title":"name","modules":[{"name":"module","tool":"parts","description":"construction dimensions, palette and connections","origin":[0,0,0]}]}. Use at most 8 small modules in construction order, each description under 100 words. Do not output any bricks, commands or inline programs in this response. Preserve the requested subject and colours. Do not substitute an architectural hall for an animal or character.'
        : '\nThe previous response exceeded the output budget. Return compact JSON for at most 32 blocks, preserving the requested silhouette. No reasoning or explanatory text.'
      const attemptPrompt = attempt === 0 ? userPrompt : `${userPrompt}${recovery}`
      try {
        response = await requestLlmChatWithCompatibility(config, applyThinkingMode({
          model: config.modelName.trim(),
          messages: [
            {
              role: 'system',
              content: llmSystemPrompt,
            },
            {
              role: 'user',
              content: imageDataUrl
                ? [
                    { type: 'text', text: attemptPrompt },
                    { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
                  ]
                : attemptPrompt,
            },
          ],
          temperature: 0.2,
          max_tokens: attempt === 0 ? (config.enableThinking || modelReasonsWhenDisabled(config) ? generationThinkingMaxTokens : 4_096) : 8_192,
          stream: true,
          response_format: { type: 'json_object' },
        }, attempt === 0 && config.enableThinking), controller.signal)
        response = trackResponseActivity(response, touch)

        if (!response.ok) {
          throw new Error(await formatRequestError(response, config.requestMode, locale))
        }

        aiTasks.phase(signal, 'receiving')
        content = await readGenerationContent(response, controller.signal, locale, undefined, () => onPhase?.('thinking'), tokens => noteReasoningTokens(config, tokens))

        break
      } catch (error) {
        if (!(error instanceof LlmOutputLimitError) || attempt > 0) throw error
      }
    }

    const rawPlan = parseJsonContent(content, locale)
    if ((pack ?? 'lego') === 'lego' && isRecord(rawPlan) && rawPlan.modules !== undefined) {
      dispose()
      const layout = parseAssemblyLayout(rawPlan)
      return await generatePlannedAssembly({ signature, layout, programs: [] }, input)
    }
    if ((pack ?? 'lego') === 'lego' && Array.isArray(rawPlan.bricks) && rawPlan.bricks.length > maxLlmBricks) {
      throw new Error('Use an assembly layout for designs exceeding 64 individual parts.')
    }
    const bricks = normalizeBricks(rawPlan.bricks, locale, inventoryOverrides, pack ?? 'lego')
    const steps = normalizeSteps(bricks)

    return {
      id: createId('plan'),
      title: asString(rawPlan.title, llmText[locale].generatedTitle),
      prompt,
      source: 'llm',
      imageName,
      bricks,
      steps,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw new Error(llmText[locale].generationCanceled)
      throw new Error(llmText[locale].generationTimeout)
    }
    throw formatFetchError(error, config.requestMode, locale)
  } finally {
    dispose()
  }
}

export const testLlmConnection = (config: LlmConfig, locale: LlmLocale = 'zh-CN', signal?: AbortSignal) => aiTasks.run('connection', signal, next => testLlmConnectionImpl(config, locale, next))
export const requestLlmJsonContent = (input: LlmJsonRequestInput) => aiTasks.run('json', input.signal, signal => requestLlmJsonContentImpl({ ...input, signal }))
export const requestLlmTextStream = (input: LlmStreamRequestInput) => aiTasks.run('story-stream', input.signal, signal => requestLlmTextStreamImpl({ ...input, signal, onDelta: text => { signal.throwIfAborted(); input.onDelta(text) }, onReasoningDelta: text => { signal.throwIfAborted(); input.onReasoningDelta?.(text) } }))
export const generateLlmBuildPlan = (input: LlmGenerateInput) => aiTasks.run('build', input.signal, signal => generateLlmBuildPlanImpl({ ...input, signal }))
