export type BrickColor =
  | 'red'
  | 'blue'
  | 'yellow'
  | 'green'
  | 'white'
  | 'black'
  | 'gray'
  | 'light-gray'
  | 'dark-gray'
  | 'dark-green'
  | 'dark-blue'
  | 'reddish-brown'
  | 'pearl-gold'
  | 'brown'
  | 'orange'
  | 'tan'
  | 'cyan'
  | 'lime'
  | 'pink'
  | 'trans-pink'
  | 'trans-red'
  | 'trans-blue'
  | 'trans-yellow'
  | 'trans-green'
  | 'trans-orange'
  | 'trans-cyan'
  | 'trans-lime'
  | 'trans-brown'
  | 'trans-black'
  | 'trans-clear'
  | 'lego-0'
  | 'lego-1'
  | 'lego-2'
  | 'lego-3'
  | 'lego-4'
  | 'lego-5'
  | 'lego-10'
  | 'lego-14'
  | 'lego-15'
  | 'lego-19'
  | 'lego-25'
  | 'lego-26'
  | 'lego-27'
  | 'lego-28'
  | 'lego-29'
  | 'lego-31'
  | 'lego-70'
  | 'lego-71'
  | 'lego-72'
  | 'lego-73'
  | 'lego-78'
  | 'lego-84'
  | 'lego-85'
  | 'lego-272'
  | 'lego-288'
  | 'lego-308'
  | 'lego-320'
  | 'lego-321'
  | 'lego-322'
  | 'lego-330'
  | 'lego-378'
  | 'lego-379'
  | 'lego-484'
  | 'lego-33'
  | 'lego-34'
  | 'lego-36'
  | 'lego-37'
  | 'lego-38'
  | 'lego-40'
  | 'lego-41'
  | 'lego-43'
  | 'lego-46'
  | 'lego-47'
  | 'lego-52'
  | 'lego-57'
  | 'lego-179'
  | 'lego-316'
  | 'lego-135'
  | 'lego-297'
  | 'lego-80'
  | 'lego-81'

export type BrickKind =
  | 'brick'
  | 'block'
  | 'plate'
  | 'tile'
  | 'slope'
  | 'round'
  | 'cone'
  | 'propeller'
  | 'wheel'
  | 'axle'

export type BrickPack = 'lego' | 'minecraft'

export type BrickRotationQuarterTurns = 0 | 1 | 2 | 3
export type BrickVerticalQuarterTurns = 0 | 1 | 2 | 3

export type ConnectorKind = 'stud' | 'tube' | 'studsocket' | 'axle' | 'bar' | 'pin'

export type ConnectorGender = 'male' | 'female' | 'bidirectional'

export type ConnectorAxis = 'x' | 'y' | 'z'

export type ConnectorPose = {
  xStud: number
  yStud: number
  zStud: number
}

export type ConnectorDirection = {
  x: number
  y: number
  z: number
}

export type BrickConnector = {
  id: string
  kind: ConnectorKind
  gender: ConnectorGender
  axis: ConnectorAxis
  pose: ConnectorPose
  direction?: ConnectorDirection
  interfaceType?: string
}

export type BrickFootprint = {
  widthStuds: number
  depthStuds: number
  heightStuds: number
}

export type VoxelBlockShape = 'cube' | 'slab' | 'stairs' | 'fence' | 'cross'

export type VoxelRenderLayer = 'opaque' | 'cutout' | 'translucent' | 'emissive'

export type VoxelFaceTextures = {
  all: string
  side?: string
  top?: string
  bottom?: string
}

export type VoxelBlockVisual = {
  shape: VoxelBlockShape
  textures: VoxelFaceTextures
  renderLayer: VoxelRenderLayer
  emissiveIntensity?: number
}

export type BrickDefinition = {
  id: string
  pack: BrickPack
  partNumber: string
  name: string
  kind: BrickKind
  footprint: BrickFootprint
  connectors: BrickConnector[]
  colors: BrickColor[]
  inventory: number
  catalogCategory?: string
  voxelVisual?: VoxelBlockVisual
}

export type BrickPose = {
  xStud: number
  yStud: number
  zStud: number
  rotationQuarterTurns: BrickRotationQuarterTurns
  verticalQuarterTurns?: BrickVerticalQuarterTurns
  rollQuarterTurns?: BrickRotationQuarterTurns
  /** Exact local-frame orientation for hinged assemblies imported from LDraw. */
  orientationMatrix?: [number, number, number, number, number, number, number, number, number]
}

export type VoxelFenceConnections = {
  north: boolean
  east: boolean
  south: boolean
  west: boolean
}

export type VoxelBlockState = {
  slabHalf?: 'bottom' | 'top'
  fenceConnections?: VoxelFenceConnections
  open?: boolean
  powered?: boolean
  containerName?: string
  /** Lightweight story-facing contents, not a general inventory system. */
  storyContents?: Array<{
    id: string
    title: string
    description: string
    tags?: string[]
    discovered?: boolean
    taken?: boolean
  }>
}

export type PlacedBrick = {
  id: string
  brickId: string
  color: BrickColor
  pose: BrickPose
  voxelState?: VoxelBlockState
}

export type BuildStep = {
  id: string
  title: string
  description: string
  brickIds: string[]
  /** Keep this group aligned with an official instruction step in the standard manual. */
  instructionStep?: number
}

export type BrickStructure = {
  id: string
  name: string
  description: string
  brickIds: string[]
}

export type BuildPlan = {
  id: string
  title: string
  prompt: string
  source: 'template-local' | 'llm'
  imageName?: string
  bricks: PlacedBrick[]
  steps: BuildStep[]
  structures?: BrickStructure[]
}

export type LlmConfig = {
  modelName: string
  endpoint: string
  apiKey: string
  requestMode: 'direct' | 'proxy'
  enableThinking: boolean
  autoRepair: boolean
  /** LLM repair retries allowed after the first invalid candidate (1-4, default 2). */
  maxRepairAttempts?: number
}

export type FinishedAsset = {
  id: string
  i18nKey?: string
  title: string
  category: string
  description: string
  instructionUrl?: string
  instructionStatus?: 'mapped' | 'inspired'
  plan: BuildPlan
}

export type GeneratorInput = {
  prompt: string
  imageName?: string
  imageDataUrl?: string
  inventoryOverrides?: Record<string, number>
  pack?: BrickPack
}
