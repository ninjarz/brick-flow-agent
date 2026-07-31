export type BrickColor =
  | 'red'
  | 'blue'
  | 'yellow'
  | 'green'
  | 'white'
  | 'black'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'tan'
  | 'cyan'
  | 'lime'
  | 'pink'
  | 'trans-pink'

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
  voxelVisual?: VoxelBlockVisual
}

export type BrickPose = {
  xStud: number
  yStud: number
  zStud: number
  rotationQuarterTurns: BrickRotationQuarterTurns
  verticalQuarterTurns?: BrickVerticalQuarterTurns
}

export type PlacedBrick = {
  id: string
  brickId: string
  color: BrickColor
  pose: BrickPose
}

export type BuildStep = {
  id: string
  title: string
  description: string
  brickIds: string[]
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
}
