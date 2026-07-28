import { brickById, brickDefinitions } from '../data/basicBricks'
import type { BrickColor, BuildPlan, GeneratorInput, LlmConfig, PlacedBrick } from '../types/bricks'
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
  bricks?: unknown
}

type LlmGenerateInput = GeneratorInput & {
  config: LlmConfig
  signal?: AbortSignal
  locale?: LlmLocale
  repairFeedback?: string
  previousPlan?: BuildPlan
}

type LlmRequestPayload = Record<string, unknown>
type LlmLocale = 'zh-CN' | 'en-US'
export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LlmJsonRequestInput = {
  config: LlmConfig
  systemPrompt: string
  userPrompt: string
  signal?: AbortSignal
  locale?: LlmLocale
  temperature?: number
  maxTokens?: number
}

export type LlmStreamRequestInput = Omit<LlmJsonRequestInput, 'systemPrompt' | 'userPrompt'> & {
  systemPrompt?: string
  userPrompt?: string
  messages?: LlmChatMessage[]
  onDelta: (text: string) => void
  onReasoningDelta?: (text: string) => void
}

const clientRequestTimeoutMs = 240_000
const configTestTimeoutMs = 15_000
const configTestMaxTokens = 128
const generationMaxTokens = 12_800
const generationThinkingMaxTokens = 128_000
export const maxLlmBricks = 64

let omitUnsupportedThinkingParameters = false

export const resetLlmThinkingCompatibility = () => {
  omitUnsupportedThinkingParameters = false
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
    generationTimeout: `LLM 请求超时：${clientRequestTimeoutMs / 1000} 秒内没有返回`,
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
    generationTimeout: `LLM request timed out after ${clientRequestTimeoutMs / 1000} seconds.`,
    emptyGenerationResponse: 'The LLM response was empty. Check the model name, api_key, or endpoint compatibility.',
    generatedTitle: 'LLM generated plan',
  },
}

const colors: BrickColor[] = ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange', 'tan', 'cyan', 'lime', 'pink', 'trans-pink']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asString = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value.trim() : fallback

const asInteger = (value: unknown, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.round(number) : fallback
}

const asHorizontalStudGrid = (value: unknown, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? normalizeHorizontalStud(number) : fallback
}

const asWorldStudGrid = (value: unknown, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? normalizeYStud(number) : fallback
}

const asLegacyPlateGrid = (value: unknown, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? plateHeightToWorldStud(number) : fallback
}

const asColor = (value: unknown, fallback: BrickColor): BrickColor => {
  const color = asString(value)
  return colors.includes(color as BrickColor) ? (color as BrickColor) : fallback
}

const clampRotation = (value: unknown) => {
  const rotation = asInteger(value, 0)
  return (((rotation % 4) + 4) % 4) as 0 | 1 | 2 | 3
}

const normalizeBrickPose = (brick: PlacedBrick): PlacedBrick => ({
  ...brick,
  pose: {
    ...brick.pose,
    xStud: normalizeHorizontalStud(brick.pose.xStud),
    yStud: normalizeYStud(brick.pose.yStud),
    zStud: normalizeHorizontalStud(brick.pose.zStud),
    rotationQuarterTurns: clampRotation(brick.pose.rotationQuarterTurns),
    verticalQuarterTurns: clampRotation(brick.pose.verticalQuarterTurns ?? 0),
  },
})

const formatInventoryForPrompt = (inventory: number) =>
  Number.isFinite(inventory) ? String(inventory) : 'unlimited'

const formatLegoHeightForPrompt = (heightStuds: number) =>
  Number((heightStuds / PLATE_HEIGHT_WORLD).toFixed(3))

const getInventorySummary = (inventoryOverrides?: Record<string, number>) => brickDefinitions
  .filter((brick) => brick.pack === 'lego')
  .map((brick) => {
    const inventory = inventoryOverrides?.[brick.id] ?? brick.inventory
    return `${brick.id}: ${brick.name}, footprint ${brick.footprint.widthStuds}x${brick.footprint.depthStuds}, height ${formatLegoHeightForPrompt(brick.footprint.heightStuds)} plates, colors ${brick.colors.join('/')}, inventory ${formatInventoryForPrompt(inventory)}`
  })
  .join('\n')

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

export const buildLlmUserPrompt = ({ prompt, imageName, inventoryOverrides }: GeneratorInput) => `You generate small brick build plans for a browser 3D editor.

User request: ${prompt}
Reference image file name: ${imageName || 'none'}

Available parts:
${getInventorySummary(inventoryOverrides)}

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

Rules:
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
  if (typeof payload.ok === 'boolean' || Array.isArray(payload.bricks)) return JSON.stringify(payload)
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

const formatRequestError = async (response: Response, requestMode: LlmConfig['requestMode'], locale: LlmLocale) => {
  const labels = llmText[locale]
  const detail = await response.text()

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
  const endpoint = config.endpoint.trim()
  const apiKey = config.apiKey.trim()

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

const hasThinkingParameterError = async (response: Response) => {
  if (response.ok) return false
  const detail = (await response.clone().text()).toLowerCase()
  return detail.includes('thinking') || detail.includes('enable_thinking')
}

const requestLlmChatWithCompatibility = async (
  config: LlmConfig,
  payload: LlmRequestPayload,
  signal: AbortSignal,
) => {
  const effectivePayload = omitUnsupportedThinkingParameters ? withoutThinkingParameters(payload) : payload
  const response = await requestLlmChat(config, effectivePayload, signal)
  if (omitUnsupportedThinkingParameters || !await hasThinkingParameterError(response)) return response

  omitUnsupportedThinkingParameters = true
  return requestLlmChat(config, withoutThinkingParameters(payload), signal)
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

const lowerUntilSupported = (brick: PlacedBrick, placed: PlacedBrick[]) => {
  if (isBrickSupported(brick, placed)) return brick

  for (let yStud = brick.pose.yStud - WORLD_EDIT_STEP_STUDS; yStud >= 0; yStud -= WORLD_EDIT_STEP_STUDS) {
    const candidate = {
      ...brick,
      pose: {
        ...brick.pose,
        yStud: normalizeYStud(yStud),
      },
    }
    if (!hasBrickCollision(candidate, placed) && isBrickSupported(candidate, placed)) return candidate
  }

  return undefined
}

const normalizeBricks = (rawBricks: unknown, locale: LlmLocale, inventoryOverrides?: Record<string, number>): PlacedBrick[] => {
  if (!Array.isArray(rawBricks)) throw new Error(llmText[locale].missingBricks)

  const placed: PlacedBrick[] = []
  const placedCounts = new Map<string, number>()

  for (const rawBrick of rawBricks.slice(0, maxLlmBricks)) {
    if (!isRecord(rawBrick)) continue
    const brick = rawBrick as LlmBrick
    const brickId = asString(brick.brickId)
    const definition = brickById.get(brickId)
    if (!definition) continue
    const currentCount = placedCounts.get(brickId) ?? 0
    const inventory = inventoryOverrides?.[brickId] ?? definition.inventory
    if (Number.isFinite(inventory) && currentCount >= inventory) continue

    const pose = isRecord(brick.pose) ? brick.pose : {}
    const color = asColor(brick.color, definition.colors[0])
    const safeColor = definition.colors.includes(color) ? color : definition.colors[0]
    const candidate = makeBrick(
      brickId,
      safeColor,
      asHorizontalStudGrid(brick.xStud ?? pose.xStud, 0),
      brick.yStud !== undefined || pose.yStud !== undefined
        ? asWorldStudGrid(brick.yStud ?? pose.yStud, 0)
        : asLegacyPlateGrid(brick.yPlate ?? pose.yPlate, 0),
      asHorizontalStudGrid(brick.zStud ?? pose.zStud, 0),
      clampRotation(brick.rotationQuarterTurns ?? pose.rotationQuarterTurns),
      clampRotation(brick.verticalQuarterTurns ?? pose.verticalQuarterTurns),
    )
    const snapped = candidate
    const openBrick = nudgeToNearbyOpenPose(snapped, placed)
    if (!openBrick) continue

    const supportedBrick = lowerUntilSupported(openBrick, placed)
    if (!supportedBrick) continue

    if (placed.length > 0 && supportedBrick.pose.yStud === 0) {
      const supportedOpenBrick = findSupportedOpenPose(supportedBrick, placed)
      if (supportedOpenBrick.pose.yStud > 0 && isBrickSupported(supportedOpenBrick, placed)) {
        placed.push(normalizeBrickPose(supportedOpenBrick))
        placedCounts.set(brickId, currentCount + 1)
      }
      continue
    }

    placed.push(normalizeBrickPose(supportedBrick))
    placedCounts.set(brickId, currentCount + 1)
  }

  if (placed.length === 0) throw new Error(llmText[locale].noUsableParts)
  return placed
}

const normalizeSteps = (bricks: PlacedBrick[]) => createSingleBrickSteps(bricks)

export const isLlmConfigComplete = (config: LlmConfig) =>
  Boolean(config.modelName.trim() && config.endpoint.trim() && config.apiKey.trim())

export const testLlmConnection = async (config: LlmConfig, locale: LlmLocale = 'zh-CN') => {
  resetLlmThinkingCompatibility()
  if (!isLlmConfigComplete(config)) throw new Error(llmText[locale].incompleteConfig)

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), configTestTimeoutMs)
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
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(llmText[locale].configTimeout)
    }
    throw formatFetchError(error, config.requestMode, locale)
  } finally {
    window.clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(await formatRequestError(response, config.requestMode, locale))
  }

  const responseText = await response.text()
  if (!responseText.trim()) throw new Error(llmText[locale].emptyConfigResponse)

  const payload = JSON.parse(responseText) as unknown
  const content = extractMessageContent(payload)
  if (!content) throw new Error(formatEmptyContentError(payload, llmText[locale].configTestContext, locale))
}

export const requestLlmJsonContent = async ({
  config,
  systemPrompt,
  userPrompt,
  signal,
  locale = 'zh-CN',
  temperature = 0.2,
  maxTokens = 4_096,
}: LlmJsonRequestInput) => {
  if (!isLlmConfigComplete(config)) throw new Error(llmText[locale].incompleteConfig)

  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  signal?.addEventListener('abort', abortFromCaller)
  const timeout = window.setTimeout(() => controller.abort(), clientRequestTimeoutMs)
  let response: Response

  try {
    response = await requestLlmChatWithCompatibility(config, applyThinkingMode({
      model: config.modelName.trim(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false,
      response_format: { type: 'json_object' },
    }, config.enableThinking), controller.signal)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw new Error(llmText[locale].generationCanceled)
      throw new Error(llmText[locale].generationTimeout)
    }
    throw formatFetchError(error, config.requestMode, locale)
  } finally {
    signal?.removeEventListener('abort', abortFromCaller)
    window.clearTimeout(timeout)
  }

  if (!response.ok) throw new Error(await formatRequestError(response, config.requestMode, locale))
  const responseText = await response.text()
  if (!responseText.trim()) throw new Error(llmText[locale].emptyGenerationResponse)
  const payload = JSON.parse(responseText) as unknown
  const content = extractMessageContent(payload)
  if (!content) throw new Error(formatEmptyContentError(payload, llmText[locale].responseContext, locale))
  return content
}

const readLlmEventStream = async (
  response: Response,
  onDelta: (text: string) => void,
  onReasoningDelta?: (text: string) => void,
) => {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let transportBuffer = ''
  let content = ''
  const emitPayload = (payloadText: string) => {
    const trimmed = payloadText.trim()
    if (!trimmed || trimmed === '[DONE]') return
    try {
      const payload = JSON.parse(trimmed) as unknown
      const reasoningDelta = extractReasoningContent(payload)
      if (reasoningDelta) onReasoningDelta?.(reasoningDelta)
      const delta = extractMessageContent(payload)
      if (!delta) return
      content += delta
      onDelta(delta)
    } catch {
      content += payloadText
      onDelta(payloadText)
    }
  }

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
      else if (record.trim()) emitPayload(record)
    }
    if (chunk.done) break
  }
  if (transportBuffer.trim()) {
    const data = transportBuffer.startsWith('data:')
      ? transportBuffer.split(/\r?\n/).map((line) => line.replace(/^data:\s?/, '')).join('\n')
      : transportBuffer
    emitPayload(data)
  }
  return content
}

export const requestLlmTextStream = async ({
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
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  signal?.addEventListener('abort', abortFromCaller)
  const timeout = window.setTimeout(() => controller.abort(), clientRequestTimeoutMs)
  try {
    const response = await requestLlmChatWithCompatibility(config, applyThinkingMode({
      model: config.modelName.trim(),
      messages: requestMessages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }, config.enableThinking), controller.signal)
    if (!response.ok) throw new Error(await formatRequestError(response, config.requestMode, locale))
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('text/event-stream') && contentType.includes('application/json')) {
      const payload = await response.json() as unknown
      const reasoning = extractReasoningContent(payload)
      if (reasoning) onReasoningDelta?.(reasoning)
      const content = extractMessageContent(payload)
      if (!content) throw new Error(formatEmptyContentError(payload, llmText[locale].responseContext, locale))
      onDelta(content)
      return content
    }
    const content = await readLlmEventStream(response, onDelta, onReasoningDelta)
    if (!content.trim()) throw new Error(llmText[locale].emptyGenerationResponse)
    return content
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw new Error(llmText[locale].generationCanceled)
      throw new Error(llmText[locale].generationTimeout)
    }
    throw formatFetchError(error, config.requestMode, locale)
  } finally {
    signal?.removeEventListener('abort', abortFromCaller)
    window.clearTimeout(timeout)
  }
}

export const generateLlmBuildPlan = async ({ prompt, imageName, imageDataUrl, inventoryOverrides, config, signal, locale = 'zh-CN', repairFeedback, previousPlan }: LlmGenerateInput): Promise<BuildPlan> => {
  if (!isLlmConfigComplete(config)) throw new Error(llmText[locale].incompleteConfig)

  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  signal?.addEventListener('abort', abortFromCaller)
  const timeout = window.setTimeout(() => controller.abort(), clientRequestTimeoutMs)
  let response: Response
  const userPrompt = `${buildLlmUserPrompt({ prompt, imageName, inventoryOverrides })}${
    repairFeedback && previousPlan ? buildLlmRepairPrompt(previousPlan, repairFeedback) : ''
  }`

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
                { type: 'text', text: userPrompt },
                { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
              ]
            : userPrompt,
        },
      ],
      temperature: 0.2,
      max_tokens: config.enableThinking ? generationThinkingMaxTokens : generationMaxTokens,
      stream: false,
      response_format: { type: 'json_object' },
    }, config.enableThinking), controller.signal)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw new Error(llmText[locale].generationCanceled)
      throw new Error(llmText[locale].generationTimeout)
    }
    throw formatFetchError(error, config.requestMode, locale)
  } finally {
    signal?.removeEventListener('abort', abortFromCaller)
    window.clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(await formatRequestError(response, config.requestMode, locale))
  }

  const responseText = await response.text()
  if (!responseText.trim()) throw new Error(llmText[locale].emptyGenerationResponse)

  const payload = JSON.parse(responseText) as unknown
  const content = extractMessageContent(payload)
  if (!content) throw new Error(formatEmptyContentError(payload, llmText[locale].responseContext, locale))

  const rawPlan = parseJsonContent(content, locale)
  const bricks = normalizeBricks(rawPlan.bricks, locale, inventoryOverrides)
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
}
