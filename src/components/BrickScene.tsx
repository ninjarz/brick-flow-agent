import { CameraKeyboardNavigation } from './scene/CameraKeyboardNavigation'
import { ManualCameraFollow } from './scene/ManualCameraFollow'
import { getSceneGridFade } from '../lib/sceneGridFade'
import { useLDrawBatchResources } from './scene/useLDrawBatchResources'
import { useSceneCallbacks } from './scene/useSceneCallbacks'
import { getEditorSupport, getEditorStability, backgroundAnalysisThreshold } from '../lib/editorAnalysisClient'
import { SceneGround } from './scene/SceneGround'
import { useSceneCanvasGesture } from './scene/useSceneCanvasGesture'
import { useBrickInteractionHandlers } from './scene/useBrickInteractionHandlers'
import { LDrawBatch, LDrawPrints, LDrawBatchLines } from './scene/LDrawBatches'
import { LargePlacementGhosts } from './scene/LargePlacementGhosts'
import { buildLDrawSceneBatches, prepareLDrawSceneBatches, type LDrawSceneBatches } from '../lib/ldrawSceneBatches'
import { Billboard, Edges, Html, Line, OrbitControls, Text } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { memo, type CSSProperties, type ReactNode, type RefCallback, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Matrix4, Object3D, Vector3, type DirectionalLight, type Group, type InstancedMesh } from 'three'
import { brickById, colorHex, colorOpacity } from '../data/basicBricks'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { getWorldCombatPresentationPhase } from '../lib/worldCombatPresentation'
import { createRound2x2AxleBodyGeometry, createRound2x2AxleGrilleBodyGeometry } from '../lib/csgBrickGeometry'
import { getBrickWorldBoundsFrame } from '../lib/ldrawBounds'
import { prepareBrickDefinitionsGeometry } from '../lib/planGeometry'
import { getLDrawEdgePoints } from '../lib/ldrawEdgePoints'
import { createLoadedLDrawBodyGeometry, createLDrawPrintGeometries } from '../lib/ldrawVisualGeometry'
import { getVisibleBricksDuringPlacement } from '../lib/brickPlacementPreview'
import { createBuildGraph, getBrickBounds } from '../lib/planUtils'
import { getScenePerformanceSettings, getWorldAnimationFps, shouldInstanceVoxelGroup } from '../lib/scenePerformance'
import { getSceneCameraFrameRequestKey } from '../lib/sceneCamera'
import { getWorldProjectileVisuals, sampleWorldProjectilePosition, type WorldProjectileVisual } from '../lib/worldProjectiles'
import { layoutWorldSpeechBubbles, selectWorldSpeechEntities } from '../lib/worldSpeechLayout'
import { analyzeBuildStability, getStabilityRiskColor, type StabilityAnalysis } from '../lib/stabilityAnalysis'
import { getBrickWorldRenderStructuralCellBoxes, type StructuralCellKind, type WorldStructuralCellBox } from '../lib/structuralGrid'
import { WORLD_EDIT_STEP_STUDS, getBrickConnectors, getBrickWorldFrame, poseToWorld } from '../lib/brickUnits'
import { useI18n } from '../lib/i18n'
import { getVoxelBlockMaterials, getVoxelVisualKey } from '../lib/voxelBlockMaterials'
import { partitionVoxelItemsByChunk } from '../lib/voxelChunking'
import { isVoxelPlantSupported, type VoxelPlacementSurface } from '../lib/voxelBlockState'
import {
  createCheeseSlopeGeometry,
  createCurvedSlope3x1Geometry,
  createCurvedSlope3x1OutlineGeometry,
  createInvertedSlope45Geometry,
  createSlope45Geometry,
} from '../lib/slopeGeometries'
import type { BrickDefinition, BrickPose, PlacedBrick } from '../types/bricks'
import type { WorldEntity, WorldEvent } from '../types/world'

export type BrickSceneViewMode = 'border' | 'borderless' | 'xray' | 'voxel'

export type BrickSceneTransform = {
  translation?: { x: number; y: number; z: number }
  rotation?: {
    pivot: { x: number; y: number; z: number }
    axis: { x: number; z: number }
    angle: number
  }
}

export type BrickSelectionOptions = {
  toggle?: boolean
}

export type BrickSceneProps = {
  analysisPaused?: boolean
  bricks: PlacedBrick[]
  selectedId?: string
  highlightedIds?: string[]
  cameraFollowStepKey?: string
  cameraFrameKey?: string
  cameraFocusBrickIds?: string[]
  preserveDrawingBuffer?: boolean
  initialCameraAzimuthDegrees?: number
  viewMode?: BrickSceneViewMode
  stabilityAnalysis?: StabilityAnalysis
  displayColorByBrickId?: Map<string, string>
  transformsByBrickId?: Map<string, BrickSceneTransform>
  worldEntities?: WorldEntity[]
  worldEvents?: WorldEvent[]
  worldElapsedSeconds?: number
  worldPaused?: boolean
  hiddenBrickIds?: string[]
  hiddenWorldEntityIds?: string[]
  showHiddenObjects?: boolean
  worldEntityPlacementPreview?: WorldEntity
  selectedWorldEntityId?: string
  placementPreviewBricks?: PlacedBrick[]
  placementSourceBrickIds?: string[]
  placementActive?: boolean
  keyboardEnabled?: boolean
  onCameraAzimuthChange?: (degrees: number) => void
  onSelect: (id: string, options?: BrickSelectionOptions) => void
  onSelectConnected?: (id: string) => void
  onSelectWorldEntity?: (id: string) => void
  onPlacementPointChange?: (point: VoxelPlacementSurface) => void
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
  onBeginDragSelected?: (id: string, point: { x: number; z: number }) => void
  onEndNudge?: (cancel?: boolean) => void
  onNudgeSelected: (delta: { xStud?: number; yStud?: number; zStud?: number }) => void
  onRotateSelected: (axis: 'horizontal' | 'vertical', deltaQuarterTurns: -1 | 1) => void
  onDeleteSelected: () => void
}

const studRadius = 0.18
const studHeight = 0.12
const connectorRadius = 0.07
const edgeColor = '#172033'
const floatingWarningColor = '#ef4444'
const structuralVoxelStyle: Record<StructuralCellKind, { color: string; opacity: number }> = {
  solid: { color: '#ef4444', opacity: 0.78 },
  enterable: { color: '#22d3ee', opacity: 0.18 },
  stud: { color: '#f59e0b', opacity: 0.9 },
  socket: { color: '#3b82f6', opacity: 0.86 },
  studsocket: { color: '#10b981', opacity: 0.9 },
}
const structuralVoxelRenderOrder: StructuralCellKind[] = ['enterable', 'solid', 'studsocket', 'stud', 'socket']
const defaultGridExtent = 15
const gridPadding = 4
const nudgeRepeatDelayMs = 280
const nudgeRepeatIntervalMs = 90


const isPlacementGhostObject = (object: Object3D) => {
  let current: Object3D | null = object
  while (current) {
    if (current.userData.placementGhost === true) return true
    current = current.parent
  }
  return false
}

const getFirstPlacementSurfacePoint = (event: ThreeEvent<PointerEvent>) => {
  const surfaceHit = event.intersections.find((intersection) => !isPlacementGhostObject(intersection.object))
  const point = surfaceHit?.point ?? event.point
  const normal = surfaceHit?.face?.normal
    ? surfaceHit.face.normal.clone().transformDirection(surfaceHit.object.matrixWorld)
    : new Vector3(0, 1, 0)
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    normalX: normal.x,
    normalY: normal.y,
    normalZ: normal.z,
    viewDirectionX: event.ray.direction.x,
    viewDirectionZ: event.ray.direction.z,
  }
}


const BoundsOutline = ({ position, size, color }: {
  position: [number, number, number]
  size: [number, number, number]
  color: string
}) => (
  <mesh position={position} raycast={() => null}>
    <boxGeometry args={size} />
    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    <Edges color={color} threshold={15} />
  </mesh>
)

const TransformedBrick = ({ transform, children }: {
  transform?: BrickSceneTransform
  children: ReactNode
}) => {
  if (!transform) return children
  const translation = transform.translation ?? { x: 0, y: 0, z: 0 }
  const rotation = transform.rotation
  const rotated = rotation ? (
    <group
      position={[rotation.pivot.x, rotation.pivot.y, rotation.pivot.z]}
      quaternion={[
        rotation.axis.x * Math.sin(rotation.angle / 2),
        0,
        rotation.axis.z * Math.sin(rotation.angle / 2),
        Math.cos(rotation.angle / 2),
      ]}
    >
      <group position={[-rotation.pivot.x, -rotation.pivot.y, -rotation.pivot.z]}>
        {children}
      </group>
    </group>
  ) : children

  return <group position={[translation.x, translation.y, translation.z]}>{rotated}</group>
}

const connectorDirection = (connector: ReturnType<typeof getBrickConnectors>[number]) => (
  connector.direction ?? (
    connector.axis === 'x'
      ? { x: 1, y: 0, z: 0 }
      : connector.axis === 'z'
        ? { x: 0, y: 0, z: 1 }
        : { x: 0, y: 1, z: 0 }
  )
)

const connectorRotation = (connector: ReturnType<typeof getBrickConnectors>[number]): [number, number, number] => {
  const direction = connectorDirection(connector)
  if (Math.abs(direction.x) > 0.5) return [0, 0, Math.PI / 2]
  if (Math.abs(direction.z) > 0.5) return [Math.PI / 2, 0, 0]
  return [0, 0, 0]
}

const connectorMarkerColor = (connector: ReturnType<typeof getBrickConnectors>[number]) => {
  if (connector.kind === 'stud') return '#f59e0b'
  if (connector.kind === 'tube') return '#60a5fa'
  if (connector.kind === 'studsocket') return '#10b981'
  return '#a855f7'
}

const BrickBodyMaterial = ({
  color,
  opacity = 1,
  isSlope = false,
  flatShading = isSlope,
  showEdges = true,
  edgeGeometry,
}: {
  color: string
  opacity?: number
  isSlope?: boolean
  flatShading?: boolean
  showEdges?: boolean
  edgeGeometry?: BufferGeometry
}) => (
  <>
    <meshStandardMaterial
      key={`${color}:${opacity}:${isSlope ? 'slope' : 'body'}:${flatShading ? 'flat' : 'smooth'}`}
      color={color}
      roughness={0.48}
      metalness={0.02}
      side={isSlope ? DoubleSide : undefined}
      flatShading={flatShading}
      transparent={opacity < 1}
      opacity={opacity}
      depthWrite={opacity >= 1}
    />
    {showEdges && (edgeGeometry
      ? <Line segments points={getLDrawEdgePoints(edgeGeometry)} color={edgeColor} raycast={() => null} />
      : <Edges color={edgeColor} threshold={15} />)}
  </>
)

const VoxelBlockMesh = ({
  definition,
  size,
  position,
  rotation,
  opacity,
  showEdges,
}: {
  definition: BrickDefinition
  size: [number, number, number]
  position?: [number, number, number]
  rotation?: [number, number, number]
  opacity: number
  showEdges: boolean
}) => (
  <mesh
    material={definition.voxelVisual ? [...getVoxelBlockMaterials(definition.voxelVisual, opacity)] : undefined}
    castShadow={definition.voxelVisual?.renderLayer !== 'translucent'}
    receiveShadow={definition.voxelVisual?.renderLayer === 'opaque'}
    position={position}
    rotation={rotation}
  >
    <boxGeometry args={size} />
    {showEdges && <Edges color={edgeColor} threshold={15} />}
  </mesh>
)

const VoxelBlockBody = ({
  definition,
  brick,
  width,
  height,
  depth,
  opacity,
  showEdges,
}: {
  definition: BrickDefinition
  brick: PlacedBrick
  width: number
  height: number
  depth: number
  opacity: number
  showEdges: boolean
}) => {
  const shape = definition.voxelVisual?.shape ?? 'cube'
  if (brick.brickId === 'minecraft-oak-door' && brick.voxelState?.open) {
    return <VoxelBlockMesh definition={definition} size={[depth, height, width]} position={[width / 2 - depth / 2, 0, width / 2 - depth / 2]} opacity={opacity} showEdges={showEdges} />
  }
  if (brick.brickId === 'minecraft-chest' && brick.voxelState?.open) {
    return <group>
      <VoxelBlockMesh definition={definition} size={[width, height * 0.72, depth]} position={[0, -height * 0.14, 0]} opacity={opacity} showEdges={showEdges} />
      <group position={[0, height * 0.34, -depth * 0.42]} rotation={[-Math.PI / 3, 0, 0]}>
        <VoxelBlockMesh definition={definition} size={[width, height * 0.24, depth]} position={[0, 0, depth * 0.42]} opacity={opacity} showEdges={showEdges} />
      </group>
    </group>
  }
  if (shape === 'stairs') {
    return (
      <group>
        <VoxelBlockMesh
          definition={definition}
          size={[width, height / 2, depth]}
          position={[0, -height / 4, 0]}
          opacity={opacity}
          showEdges={showEdges}
        />
        <VoxelBlockMesh
          definition={definition}
          size={[width, height / 2, depth / 2]}
          position={[0, height / 4, depth / 4]}
          opacity={opacity}
          showEdges={showEdges}
        />
      </group>
    )
  }

  if (shape === 'fence') {
    const postWidth = Math.min(width, depth) * 0.3
    const railHeight = height * 0.16
    const railDepth = Math.min(width, depth) * 0.16
    const connections = brick.voxelState?.fenceConnections ?? {
      north: true,
      east: true,
      south: true,
      west: true,
    }
    const arms = [
      { key: 'north', connected: connections.north, size: [railDepth, railHeight, depth / 2] as [number, number, number], position: [0, 0, -depth / 4] as [number, number, number] },
      { key: 'east', connected: connections.east, size: [width / 2, railHeight, railDepth] as [number, number, number], position: [width / 4, 0, 0] as [number, number, number] },
      { key: 'south', connected: connections.south, size: [railDepth, railHeight, depth / 2] as [number, number, number], position: [0, 0, depth / 4] as [number, number, number] },
      { key: 'west', connected: connections.west, size: [width / 2, railHeight, railDepth] as [number, number, number], position: [-width / 4, 0, 0] as [number, number, number] },
    ]
    return (
      <group>
        <VoxelBlockMesh definition={definition} size={[postWidth, height, postWidth]} opacity={opacity} showEdges={showEdges} />
        {[-height * 0.2, height * 0.22].flatMap((y) => arms
          .filter((arm) => arm.connected)
          .map((arm) => (
            <VoxelBlockMesh
              key={`${arm.key}-${y}`}
              definition={definition}
              size={arm.size}
              position={[arm.position[0], y, arm.position[2]]}
              opacity={opacity}
              showEdges={showEdges}
            />
          )))}
      </group>
    )
  }

  if (shape === 'cross') {
    const planeWidth = Math.min(width, depth) * 1.08
    return (
      <group>
        <VoxelBlockMesh definition={definition} size={[planeWidth, height, 0.035]} rotation={[0, Math.PI / 4, 0]} opacity={opacity} showEdges={false} />
        <VoxelBlockMesh definition={definition} size={[planeWidth, height, 0.035]} rotation={[0, -Math.PI / 4, 0]} opacity={opacity} showEdges={false} />
      </group>
    )
  }

  return <group>
    <VoxelBlockMesh definition={definition} size={[width, height, depth]} opacity={opacity} showEdges={showEdges} />
    {brick.brickId === 'minecraft-lantern' && brick.voxelState?.powered !== false && <pointLight color="#ffd36a" intensity={1.25} distance={5} decay={2} />}
  </group>
}

const createSlopeGeometry = (width: number, height: number, depth: number, rotationQuarterTurns: number) => {
  const geometry = new BufferGeometry()
  const y0 = height / -2
  const lowY = y0 + height / 3
  const y1 = height / 2
  const highSide = (((rotationQuarterTurns % 4) + 4) % 4)
  const across = highSide % 2 === 0 ? width : depth
  const run = highSide % 2 === 0 ? depth : width
  const across0 = across / -2
  const across1 = across / 2
  const run0 = run / -2
  const run1 = run / 2
  const highFlatDepth = run > 1 ? 1 : run * 0.22
  const slopeRun1 = run1 - highFlatDepth

  const orient = (xAcross: number, zRun: number) => {
    switch (highSide) {
      case 1:
        return [-zRun, xAcross]
      case 2:
        return [xAcross, -zRun]
      case 3:
        return [zRun, xAcross]
      default:
        return [xAcross, zRun]
    }
  }

  const point = (xAcross: number, y: number, zRun: number) => {
    const [x, z] = orient(xAcross, zRun)
    return [x, y, z]
  }

  const p = {
    bottomLowLeft: point(across0, y0, run0),
    bottomLowRight: point(across1, y0, run0),
    bottomHighRight: point(across1, y0, run1),
    bottomHighLeft: point(across0, y0, run1),
    lowLeft: point(across0, lowY, run0),
    lowRight: point(across1, lowY, run0),
    slopeHighLeft: point(across0, y1, slopeRun1),
    slopeHighRight: point(across1, y1, slopeRun1),
    highRight: point(across1, y1, run1),
    highLeft: point(across0, y1, run1),
  }

  const triangles = [
    p.bottomLowLeft, p.bottomHighRight, p.bottomLowRight,
    p.bottomLowLeft, p.bottomHighLeft, p.bottomHighRight,
    p.bottomLowLeft, p.bottomLowRight, p.lowRight,
    p.bottomLowLeft, p.lowRight, p.lowLeft,
    p.bottomHighLeft, p.highRight, p.bottomHighRight,
    p.bottomHighLeft, p.highLeft, p.highRight,
    p.bottomLowLeft, p.bottomHighLeft, p.highLeft,
    p.bottomLowLeft, p.highLeft, p.slopeHighLeft,
    p.bottomLowLeft, p.slopeHighLeft, p.lowLeft,
    p.bottomLowRight, p.highRight, p.bottomHighRight,
    p.bottomLowRight, p.slopeHighRight, p.highRight,
    p.bottomLowRight, p.lowRight, p.slopeHighRight,
    p.lowLeft, p.lowRight, p.slopeHighRight,
    p.lowLeft, p.slopeHighRight, p.slopeHighLeft,
    p.slopeHighLeft, p.slopeHighRight, p.highRight,
    p.slopeHighLeft, p.highRight, p.highLeft,
  ]
  const vertices = new Float32Array(triangles.flat())

  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

const getVerticalRotationRadians = (verticalQuarterTurns: number) => {
  switch ((((verticalQuarterTurns % 4) + 4) % 4)) {
    case 1:
      return -Math.PI / 2
    case 2:
      return Math.PI
    case 3:
      return Math.PI / 2
    default:
      return 0
  }
}

const getHorizontalRotationRadians = (rotationQuarterTurns: number) =>
  -((((rotationQuarterTurns % 4) + 4) % 4) * Math.PI) / 2

const exactOrientationMatrix4 = (values: NonNullable<BrickPose['orientationMatrix']>) => new Matrix4().set(
  values[0], values[1], values[2], 0, values[3], values[4], values[5], 0, values[6], values[7], values[8], 0, 0, 0, 0, 1,
)

const BrickPoseRotation = ({
  rotationQuarterTurns,
  verticalQuarterTurns,
  rollQuarterTurns = 0,
  orientationMatrix,
  children,
}: {
  rotationQuarterTurns: number
  verticalQuarterTurns: number
  rollQuarterTurns?: number
  orientationMatrix?: BrickPose['orientationMatrix']
  children: ReactNode
}) => (
  <group rotation={[0, getHorizontalRotationRadians(rotationQuarterTurns), 0]}>
    <group rotation={[getVerticalRotationRadians(verticalQuarterTurns), 0, 0]}>
      <group rotation={[0, 0, rollQuarterTurns * Math.PI / 2]}>
        {orientationMatrix ? <group matrix={exactOrientationMatrix4(orientationMatrix)} matrixAutoUpdate={false}>{children}</group> : children}
      </group>
    </group>
  </group>
)

const localBrickPosition = (
  xStud: number,
  yStud: number,
  zStud: number,
  widthStuds: number,
  heightStuds: number,
  depthStuds: number,
): [number, number, number] => [
  xStud - widthStuds / 2,
  yStud - heightStuds / 2,
  zStud - depthStuds / 2,
]

const Round2x2AxleBody = ({ color, height, grille = false }: { color: string; height: number; grille?: boolean }) => (
  <>
    <mesh castShadow receiveShadow>
      <primitive object={grille ? createRound2x2AxleGrilleBodyGeometry(height) : createRound2x2AxleBodyGeometry(height)} attach="geometry" />
      <meshStandardMaterial color={color} roughness={0.48} metalness={0.02} />
    </mesh>
    {[-0.5, 0.5].flatMap((x) =>
      [-0.5, 0.5].map((z) => (
        <mesh key={`${x}-${z}`} castShadow position={[x, height / 2 + studHeight / 2, z]}>
          <cylinderGeometry args={[studRadius, studRadius, studHeight, 24]} />
          <meshStandardMaterial color={color} roughness={0.42} />
          <Edges color={edgeColor} threshold={20} />
        </mesh>
      )),
    )}
  </>
)

const GroovedCone1x1Body = ({ color, height }: { color: string; height: number }) => (
  <>
    <mesh castShadow receiveShadow>
      <cylinderGeometry args={[0.28, 0.5, height, 40]} />
      <BrickBodyMaterial color={color} />
    </mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, height / 2 - 0.12, 0]}>
      <torusGeometry args={[0.25, 0.028, 10, 32]} />
      <meshStandardMaterial color="#111827" roughness={0.46} />
    </mesh>
    <mesh position={[0, height / 2 + 0.006, 0]}>
      <cylinderGeometry args={[0.16, 0.16, 0.018, 24]} />
      <meshStandardMaterial color="#111827" roughness={0.46} />
    </mesh>
  </>
)

const RoundEyeTilePrints = ({ variant, height }: { variant: string; height: number }) => {
  const pupilOffset = variant === 'tile-eye-offset-1x1' || variant === 'tile-eye-1x1' ? 0.08 : 0
  const printY = height / 2 + 0.026

  return (
    <>
      {variant === 'tile-eye-closed-1x1' ? (
        <mesh position={[0, printY, 0.02]}>
          <boxGeometry args={[0.48, 0.018, 0.07]} />
          <meshStandardMaterial color="#111827" roughness={0.34} />
        </mesh>
      ) : (
        <>
          <mesh position={[pupilOffset, printY, 0]}>
            <cylinderGeometry args={[0.24, 0.24, 0.024, 28]} />
            <meshStandardMaterial color="#1e40af" roughness={0.34} depthWrite={false} />
          </mesh>
          <mesh position={[pupilOffset + 0.035, printY + 0.014, 0.035]}>
            <cylinderGeometry args={[0.11, 0.11, 0.026, 24]} />
            <meshStandardMaterial color="#111827" roughness={0.34} depthWrite={false} />
          </mesh>
        </>
      )}
    </>
  )
}

const RoundEyeTileBody = ({ variant, height }: { variant: string; height: number }) => (
  <>
    <mesh castShadow receiveShadow>
      <cylinderGeometry args={[0.5, 0.5, height, 40]} />
      <BrickBodyMaterial color="#f8fafc" />
    </mesh>
    <RoundEyeTilePrints variant={variant} height={height} />
  </>
)

const GrilleTile1x2Body = ({ color, height }: { color: string; height: number }) => (
  <>
    <mesh castShadow receiveShadow>
      <boxGeometry args={[2, height, 1]} />
      <BrickBodyMaterial color={color} />
    </mesh>
    {[-0.3, 0, 0.3].map((x) => (
      <mesh key={x} position={[x, height / 2 + 0.012, 0]}>
        <boxGeometry args={[0.08, 0.018, 0.74]} />
        <meshStandardMaterial color="#1f2937" roughness={0.42} />
      </mesh>
    ))}
  </>
)

const CurvedSlope3x1Body = ({ color, width, height, depth }: { color: string; width: number; height: number; depth: number }) => {
  const outlineGeometry = useMemo(() => createCurvedSlope3x1OutlineGeometry(width, height, depth), [depth, height, width])

  return (
    <>
      <mesh castShadow receiveShadow={false}>
        <primitive object={createCurvedSlope3x1Geometry(width, height, depth)} attach="geometry" />
        <BrickBodyMaterial color={color} isSlope flatShading={false} showEdges={false} />
      </mesh>
      <lineSegments geometry={outlineGeometry}>
        <lineBasicMaterial color={edgeColor} />
      </lineSegments>
    </>
  )
}

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

const toStudDelta = (direction: Vector3) => {
  const xMagnitude = Math.abs(direction.x)
  const zMagnitude = Math.abs(direction.z)

  if (xMagnitude > zMagnitude) {
    return { xStud: (Math.sign(direction.x) || 0) * WORLD_EDIT_STEP_STUDS }
  }

  return { zStud: (Math.sign(direction.z) || 0) * WORLD_EDIT_STEP_STUDS }
}

const KeyboardShortcuts = ({
  selectedId,
  onNudgeSelected,
  onEndNudge,
  onRotateSelected,
  onDeleteSelected,
}: Pick<BrickSceneProps, 'selectedId' | 'onNudgeSelected' | 'onEndNudge' | 'onRotateSelected' | 'onDeleteSelected'>) => {
  const { camera } = useThree()
  const selectedIdRef = useRef(selectedId)
  const onEndNudgeRef = useRef(onEndNudge)
  const onNudgeSelectedRef = useRef(onNudgeSelected)
  const onRotateSelectedRef = useRef(onRotateSelected)
  const onDeleteSelectedRef = useRef(onDeleteSelected)
  const heldNudgeRef = useRef<{
    key: string
    delayId?: number
    intervalId?: number
  }>()

  useEffect(() => {
    selectedIdRef.current = selectedId
    onEndNudgeRef.current = onEndNudge
    onNudgeSelectedRef.current = onNudgeSelected
    onRotateSelectedRef.current = onRotateSelected
    onDeleteSelectedRef.current = onDeleteSelected
  }, [onDeleteSelected, onNudgeSelected, onEndNudge, onRotateSelected, selectedId])

  useEffect(() => {
    const clearHeldNudge = (finish: boolean | Event = true) => {
      const held = heldNudgeRef.current
      if (held?.delayId !== undefined) window.clearTimeout(held.delayId)
      if (held?.intervalId !== undefined) window.clearInterval(held.intervalId)
      heldNudgeRef.current = undefined
      if (held && finish !== false) onEndNudgeRef.current?.()
    }

    const getNudgeDelta = (key: string) => {
      const forward = new Vector3()
      camera.getWorldDirection(forward)
      forward.y = 0
      forward.normalize()

      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
      right.y = 0
      right.normalize()

      if (key === 'w') return toStudDelta(forward)
      if (key === 's') return toStudDelta(forward.multiplyScalar(-1))
      if (key === 'd') return toStudDelta(right)
      if (key === 'a') return toStudDelta(right.multiplyScalar(-1))
      if (key === 'r') return { yStud: WORLD_EDIT_STEP_STUDS }
      if (key === 'f') return { yStud: -WORLD_EDIT_STEP_STUDS }
      return undefined
    }

    const triggerNudge = (key: string) => {
      const delta = getNudgeDelta(key)
      if (document.querySelector('[aria-modal="true"]') || isTypingTarget(document.activeElement)) { clearHeldNudge(); return }
      if (delta && selectedIdRef.current) onNudgeSelectedRef.current(delta)
    }

    const startHeldNudge = (key: string) => {
      clearHeldNudge(false)
      triggerNudge(key)

      const delayId = window.setTimeout(() => {
        const held = heldNudgeRef.current
        if (!held || held.key !== key) return
        held.intervalId = window.setInterval(() => triggerNudge(key), nudgeRepeatIntervalMs)
      }, nudgeRepeatDelayMs)

      heldNudgeRef.current = { key, delayId }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]') || isTypingTarget(document.activeElement)) { clearHeldNudge(); return }
      if (event.ctrlKey || event.metaKey || event.altKey) { clearHeldNudge(false); onEndNudgeRef.current?.(true); return }
      if (!selectedIdRef.current || isTypingTarget(event.target)) return

      const key = /^Key[WASDRFQE]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase()
      const isNudgeKey = ['w', 'a', 's', 'd', 'r', 'f'].includes(key)
      if (['q', 'e'].includes(key) || event.key === 'Backspace') { clearHeldNudge(false); onEndNudgeRef.current?.(true) }

      if (isNudgeKey) {
        event.preventDefault()
        if (event.repeat || heldNudgeRef.current?.key === key) return
        startHeldNudge(key)
      } else if (event.key === 'Escape') {
        clearHeldNudge(false); onEndNudgeRef.current?.(true)
      } else if (key === 'q') {
        if (event.repeat) return
        event.preventDefault()
        onRotateSelectedRef.current('horizontal', 1)
      } else if (key === 'e') {
        if (event.repeat) return
        event.preventDefault()
        onRotateSelectedRef.current('vertical', 1)
      } else if (event.key === 'Backspace') {
        if (event.repeat) return
        event.preventDefault()
        onDeleteSelectedRef.current()
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (heldNudgeRef.current?.key === (/^Key[WASDRFQE]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase())) {
        clearHeldNudge()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearHeldNudge)
    return () => {
      clearHeldNudge()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearHeldNudge)
    }
  }, [camera])

  return null
}

const CameraFrame = ({ centerX, centerY, centerZ, size, frameKey, azimuthDegrees = 18 }: {
  centerX: number
  centerY: number
  centerZ: number
  size: number
  frameKey: string
  azimuthDegrees?: number
}) => {
  const { camera } = useThree()
  const frameRef = useRef({ centerX, centerY, centerZ, size, azimuthDegrees })
  frameRef.current = { centerX, centerY, centerZ, size, azimuthDegrees }

  useEffect(() => {
    const { centerX, centerY, centerZ, size, azimuthDegrees } = frameRef.current
    const distance = Math.max(9, size)
    const azimuth = (azimuthDegrees * Math.PI) / 180
    const horizontalDistance = distance * 1.14
    camera.position.set(
      centerX + Math.sin(azimuth) * horizontalDistance,
      centerY + distance * 0.62 + 4,
      centerZ + Math.cos(azimuth) * horizontalDistance,
    )
    camera.near = 0.1
    camera.far = Math.max(100, distance * 8)
    camera.lookAt(centerX, centerY, centerZ)
    camera.updateProjectionMatrix()
  }, [camera, frameKey])

  return null
}

const normalizeDegrees = (degrees: number) => (degrees % 360 + 360) % 360

const angularDistance = (source: number, target: number) =>
  Math.abs((source - target + 540) % 360 - 180)

const CameraAzimuthObserver = ({ onChange }: {
  onChange?: (degrees: number) => void
}) => {
  const { camera } = useThree()
  const directionRef = useRef(new Vector3())
  const previousDegreesRef = useRef<number>()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useFrame(() => {
    if (!onChangeRef.current) return
    camera.getWorldDirection(directionRef.current)
    const direction = directionRef.current
    const horizontalLength = Math.hypot(direction.x, direction.z)
    if (horizontalLength <= 0.000001) return
    const degrees = normalizeDegrees(Math.atan2(-direction.x, -direction.z) * 180 / Math.PI)
    if (previousDegreesRef.current !== undefined && angularDistance(degrees, previousDegreesRef.current) < 0.2) return
    previousDegreesRef.current = degrees
    onChangeRef.current(Number(degrees.toFixed(1)))
  })

  return null
}

const SceneAnimationDriver = ({ active, targetFps }: {
  active: boolean
  targetFps: number
}) => {
  const { invalidate } = useThree()

  useEffect(() => {
    if (!active || targetFps <= 0) return
    const intervalMs = 1_000 / targetFps
    let animationFrameId = 0
    let previousRenderMs: number | undefined
    const animate = (timeMs: number) => {
      if (previousRenderMs === undefined || timeMs - previousRenderMs >= intervalMs - 1) {
        previousRenderMs = timeMs
        invalidate()
      }
      animationFrameId = window.requestAnimationFrame(animate)
    }
    animationFrameId = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(animationFrameId)
  }, [active, invalidate, targetFps])

  return null
}

const SceneLighting = ({
  centerX,
  centerY,
  centerZ,
  size,
  enableShadows,
}: {
  centerX: number
  centerY: number
  centerZ: number
  size: number
  enableShadows: boolean
}) => {
  const { scene } = useThree()
  const lightRef = useRef<DirectionalLight>(null)
  const target = useMemo(() => new Object3D(), [])
  const shadowExtent = Math.max(24, size / 2 + 8)
  const shadowFar = Math.max(90, shadowExtent * 4)
  const lightOffset = useMemo(() => new Vector3(18, 28, 22), [])

  useLayoutEffect(() => {
    scene.add(target)
    return () => {
      scene.remove(target)
    }
  }, [scene, target])

  useLayoutEffect(() => {
    const targetY = Math.max(0.8, centerY)
    target.position.set(centerX, targetY, centerZ)

    const light = lightRef.current
    if (!light) return

    light.position.set(centerX + lightOffset.x, targetY + lightOffset.y, centerZ + lightOffset.z)
    light.target = target
    light.target.updateMatrixWorld()
    light.shadow.camera.left = -shadowExtent
    light.shadow.camera.right = shadowExtent
    light.shadow.camera.top = shadowExtent
    light.shadow.camera.bottom = -shadowExtent
    light.shadow.camera.near = 0.5
    light.shadow.camera.far = shadowFar
    light.shadow.camera.updateProjectionMatrix()
  }, [centerX, centerY, centerZ, lightOffset, shadowExtent, shadowFar, target])

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight
        ref={lightRef}
        castShadow={enableShadows}
        intensity={1.4}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00015}
        shadow-normalBias={0.025}
      />
    </>
  )
}

const BrickMesh = memo(function BrickMesh({ brick, selected, highlighted, floating, preferDetailedGeometry, showEdges, displayColor, batchedPrints, inactive = false, ghost = false, placementActive, onSelect, onSelectConnected, onBeginDragSelected, onConfirmPlacement, onCancelPlacement }: {
  brick: PlacedBrick
  selected: boolean
  highlighted: boolean
  floating: boolean
  preferDetailedGeometry: boolean
  showEdges: boolean
  displayColor?: string
  batchedPrints?: boolean
  inactive?: boolean
  ghost?: boolean
  placementActive: boolean
  onSelect: (id: string, options?: BrickSelectionOptions) => void
  onSelectConnected?: (id: string) => void
  onBeginDragSelected?: (id: string, point: { x: number; z: number }) => void
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) {
  const definition = brickById.get(brick.brickId)
  if (!definition) return null

  return (
    <BrickMeshBody
      brick={brick}
      definition={definition}
      selected={selected}
      highlighted={highlighted}
      floating={floating}
      preferDetailedGeometry={preferDetailedGeometry}
      showEdges={showEdges}
      displayColor={displayColor}
      batchedPrints={batchedPrints}
      inactive={inactive}
      ghost={ghost}
      placementActive={placementActive}
      onSelect={onSelect}
      onSelectConnected={onSelectConnected}
      onBeginDragSelected={onBeginDragSelected}
      onConfirmPlacement={onConfirmPlacement}
      onCancelPlacement={onCancelPlacement}
    />
  )
})

const BrickMeshBody = ({ brick, definition, selected, highlighted, floating, preferDetailedGeometry, showEdges, displayColor, batchedPrints, inactive = false, ghost, placementActive, onSelect, onSelectConnected, onBeginDragSelected, onConfirmPlacement, onCancelPlacement }: {
  brick: PlacedBrick
  definition: BrickDefinition
  selected: boolean
  highlighted: boolean
  floating: boolean
  preferDetailedGeometry: boolean
  showEdges: boolean
  displayColor?: string
  batchedPrints?: boolean
  inactive?: boolean
  ghost: boolean
  placementActive: boolean
  onSelect: (id: string, options?: BrickSelectionOptions) => void
  onSelectConnected?: (id: string) => void
  onBeginDragSelected?: (id: string, point: { x: number; z: number }) => void
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) => {
  const frame = getBrickWorldFrame(definition, brick.pose)
  const origin = poseToWorld(brick.pose)
  const rotation = (brick.pose.rotationQuarterTurns * Math.PI) / 2
  const verticalQuarterTurns = brick.pose.verticalQuarterTurns ?? 0
  const bodyY = frame.y
  const boundsFrame = getBrickWorldBoundsFrame(definition, brick.pose)
  const boundsBoxPosition: [number, number, number] = [
    boundsFrame.x - frame.x,
    boundsFrame.y - bodyY,
    boundsFrame.z - frame.z,
  ]
  const renderBoundsBox = (paddingX: number, paddingY: number, paddingZ: number, color: string) => (
    <BoundsOutline
      position={boundsBoxPosition}
      size={[boundsFrame.width + paddingX, boundsFrame.height + paddingY, boundsFrame.depth + paddingZ]}
      color={color}
    />
  )
  const rotateWithPose = (children: ReactNode) => (
    <BrickPoseRotation
      rotationQuarterTurns={brick.pose.rotationQuarterTurns}
      verticalQuarterTurns={verticalQuarterTurns}
      rollQuarterTurns={brick.pose.rollQuarterTurns ?? 0}
      orientationMatrix={brick.pose.orientationMatrix}
    >
      {children}
    </BrickPoseRotation>
  )
  const connectors = getBrickConnectors(definition, brick.pose)
  const rendersOwnStuds = brick.brickId === 'brick-round-2x2-axle'
    || brick.brickId === 'plate-round-2x2-axle'
    || brick.brickId === 'brick-round-2x2-axle-grille'
    || brick.brickId === 'curved-slope-1x2'
  const visibleStuds = connectors.filter((connector) => connector.kind === 'stud' && !rendersOwnStuds)
  const visiblePins = connectors.filter((connector) => connector.kind === 'pin' && connector.gender === 'male')
  const bodyColor = displayColor ?? colorHex[brick.color]
  const bodyOpacity = ghost ? 0.32 : displayColor ? 0.92 : colorOpacity[brick.color]
  const isEyeTile = brick.brickId === 'tile-eye-1x1' || brick.brickId === 'tile-eye-closed-1x1' || brick.brickId === 'tile-eye-offset-1x1' || brick.brickId === 'tile-eye-centered-1x1'
  const baseWidth = definition.footprint.widthStuds
  const baseDepth = definition.footprint.depthStuds
  const baseHeight = definition.footprint.heightStuds
  const ldrawGeometry = preferDetailedGeometry
    ? createLoadedLDrawBodyGeometry(definition.partNumber, definition.footprint)
    : undefined

  const activeHandlers = useBrickInteractionHandlers({
    resolveBrickId: () => brick.id,
    canBeginDrag: () => selected || highlighted,
    placementActive,
    onSelect,
    onSelectConnected,
    onBeginDragSelected,
    onConfirmPlacement,
    onCancelPlacement,
  })

  const interactionHandlers = inactive ? {} : activeHandlers

  const renderSelectedConnectorMarkers = () => selected && connectors.map((connector) => (
    <mesh
      key={connector.id}
      renderOrder={20}
      position={[
        connector.pose.xStud - frame.x,
        connector.pose.yStud - frame.y,
        connector.pose.zStud - frame.z,
      ]}
    >
      {connector.kind === 'axle' ? (
        <cylinderGeometry args={[connectorRadius * 0.8, connectorRadius * 0.8, 0.34, 12]} />
      ) : (
        <sphereGeometry args={[connectorRadius, 12, 12]} />
      )}
      <meshStandardMaterial
        color={connectorMarkerColor(connector)}
        roughness={0.35}
        metalness={0.1}
        transparent
        opacity={0.92}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  ))

  if (preferDetailedGeometry && ldrawGeometry) {
    return (
      <group position={[frame.x, bodyY, frame.z]} visible={!inactive} {...interactionHandlers}>
        {rotateWithPose(
          <>
            <mesh castShadow receiveShadow>
              <primitive object={ldrawGeometry} attach="geometry" />
              <BrickBodyMaterial
                color={bodyColor}
                opacity={bodyOpacity}
                isSlope={definition.kind === 'slope'}
                flatShading={false}
                edgeGeometry={ldrawGeometry}
                showEdges={showEdges || selected || highlighted || floating}
              />
            </mesh>
            {isEyeTile && <RoundEyeTilePrints variant={brick.brickId} height={baseHeight} />}
            {!batchedPrints && createLDrawPrintGeometries(definition.partNumber, definition.footprint).map((layer) => (
              <mesh key={layer.color} geometry={layer.geometry} renderOrder={1}>
                <meshStandardMaterial color={layer.color} roughness={0.4} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} transparent={ghost || Boolean(displayColor) || layer.opacity < 1} opacity={ghost ? 0.32 : displayColor ? 0.92 : layer.opacity} depthWrite={!ghost && !displayColor && layer.opacity >= 1} />
              </mesh>
            ))}
          </>,
        )}
        {renderSelectedConnectorMarkers()}
        {selected && renderBoundsBox(0.12, 0.16, 0.12, floating ? floatingWarningColor : '#38bdf8')}
        {highlighted && !selected && renderBoundsBox(0.16, 0.2, 0.16, '#f59e0b')}
        {floating && renderBoundsBox(0.14, 0.18, 0.14, floatingWarningColor)}
      </group>
    )
  }

  if (definition.kind === 'wheel') {
    return (
      <group position={[frame.x, origin.y + 0.14, frame.z]} rotation={[0, rotation, Math.PI / 2]} visible={!inactive} {...interactionHandlers}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.32, 32]} />
          <meshStandardMaterial color={bodyColor} roughness={0.72} metalness={0.05} />
          <Edges color={edgeColor} threshold={20} />
        </mesh>
        <mesh position={[0, 0, 0.17]}>
          <cylinderGeometry args={[0.2, 0.2, 0.035, 24]} />
          <meshStandardMaterial color="#d1d5db" roughness={0.5} />
          <Edges color={edgeColor} threshold={20} />
        </mesh>
        {selected && (
          <mesh>
            <cylinderGeometry args={[0.48, 0.48, 0.36, 32]} />
            <meshBasicMaterial color="#38bdf8" wireframe />
          </mesh>
        )}
        {floating && (
          <mesh>
            <cylinderGeometry args={[0.5, 0.5, 0.38, 32]} />
            <meshBasicMaterial color={floatingWarningColor} wireframe />
          </mesh>
        )}
      </group>
    )
  }

  if (definition.kind === 'axle') {
    return (
      <group position={[frame.x, origin.y + frame.height / 2, frame.z]} rotation={[0, rotation, Math.PI / 2]} visible={!inactive} {...interactionHandlers}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.09, 0.09, frame.width + 2, 16]} />
          <meshStandardMaterial color={bodyColor} roughness={0.54} metalness={0.05} />
          <Edges color={edgeColor} threshold={12} />
        </mesh>
        {selected && (
          <mesh>
            <cylinderGeometry args={[0.14, 0.14, frame.width + 2.08, 16]} />
            <meshBasicMaterial color="#38bdf8" wireframe />
          </mesh>
        )}
        {floating && (
          <mesh>
            <cylinderGeometry args={[0.16, 0.16, frame.width + 2.1, 16]} />
            <meshBasicMaterial color={floatingWarningColor} wireframe />
          </mesh>
        )}
      </group>
    )
  }

  if (definition.kind === 'propeller') {
    const bladeLength = Math.max(1.6, baseWidth * 0.36)
    const bladeWidth = Math.max(0.38, baseWidth * 0.11)
    const bladeThickness = Math.max(0.08, baseHeight * 0.34)
    const bladeOffset = baseWidth * 0.25

    return (
      <group position={[frame.x, bodyY, frame.z]} visible={!inactive} {...interactionHandlers}>
        {rotateWithPose(
          <>
            {Array.from({ length: 4 }).map((_, index) => {
              const angle = (index * Math.PI) / 2
              return (
                <mesh
                  key={`blade-${index}`}
                  castShadow
                  receiveShadow
                  position={[Math.cos(angle) * bladeOffset, 0, Math.sin(angle) * bladeOffset]}
                  rotation={[0, -angle, 0]}
                >
                  <boxGeometry args={[bladeLength, bladeThickness, bladeWidth]} />
                  <BrickBodyMaterial color={bodyColor} />
                </mesh>
              )
            })}
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[0.46, 0.46, baseHeight, 36]} />
              <BrickBodyMaterial color={bodyColor} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, baseHeight / 2 + 0.012, 0]}>
              <torusGeometry args={[0.24, 0.055, 12, 32]} />
              <meshStandardMaterial color={brick.brickId === 'propeller-4-blade-open' ? '#111827' : bodyColor} roughness={0.5} />
            </mesh>
          </>,
        )}
        {renderSelectedConnectorMarkers()}
        {selected && renderBoundsBox(0.12, 0.16, 0.12, '#38bdf8')}
        {highlighted && !selected && renderBoundsBox(0.16, 0.2, 0.16, '#f59e0b')}
        {floating && renderBoundsBox(0.14, 0.18, 0.14, floatingWarningColor)}
      </group>
    )
  }

  if (brick.brickId === 'plate-bar-end-1x2' || brick.brickId === 'plate-clip-open-1x1') {
    const renderSpecialBody = () => {
      if (brick.brickId === 'plate-bar-end-1x2') {
        return (
          <>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[baseWidth, baseHeight, baseDepth]} />
              <BrickBodyMaterial color={bodyColor} />
            </mesh>
            <mesh
              castShadow
              receiveShadow
              position={localBrickPosition(1.5, baseHeight / 2, -0.35, baseWidth, baseHeight, baseDepth)}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.1, 0.1, 0.72, 18]} />
              <BrickBodyMaterial color={bodyColor} />
            </mesh>
            <mesh
              castShadow
              receiveShadow
              position={localBrickPosition(1.22, baseHeight / 2, -0.18, baseWidth, baseHeight, baseDepth)}
            >
              <boxGeometry args={[0.35, 0.16, 0.34]} />
              <BrickBodyMaterial color={bodyColor} />
            </mesh>
          </>
        )
      }

      return (
        <>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[baseWidth, baseHeight, baseDepth]} />
            <BrickBodyMaterial color={bodyColor} />
          </mesh>
          {[-0.18, 0.18].map((xOffset) => (
            <mesh
              key={xOffset}
              castShadow
              receiveShadow
              position={localBrickPosition(0.5 + xOffset, baseHeight / 2, 1.05, baseWidth, baseHeight, baseDepth)}
            >
              <boxGeometry args={[0.18, 0.18, 0.52]} />
              <BrickBodyMaterial color={bodyColor} />
            </mesh>
          ))}
          <mesh
            castShadow
            receiveShadow
            position={localBrickPosition(0.5, baseHeight / 2, 1.22, baseWidth, baseHeight, baseDepth)}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.12, 0.12, 0.52, 18]} />
            <BrickBodyMaterial color={bodyColor} />
          </mesh>
        </>
      )
    }

    return (
      <group position={[frame.x, bodyY, frame.z]} visible={!inactive} {...interactionHandlers}>
        {rotateWithPose(renderSpecialBody())}
        {visibleStuds.map((connector) => {
          const direction = connectorDirection(connector)
          const studRotation = connectorRotation(connector)
          const renderedStudHeight = Math.abs(direction.y) > 0.5 ? studHeight : 0.2
          const studOffset = {
            x: direction.x * renderedStudHeight / 2,
            y: direction.y * renderedStudHeight / 2,
            z: direction.z * renderedStudHeight / 2,
          }

          return (
            <mesh
              key={connector.id}
              castShadow
              position={[
                connector.pose.xStud - frame.x + studOffset.x,
                connector.pose.yStud - frame.y + studOffset.y,
                connector.pose.zStud - frame.z + studOffset.z,
              ]}
              rotation={studRotation}
            >
              <cylinderGeometry args={[studRadius, studRadius, renderedStudHeight, 24]} />
              <meshStandardMaterial color={bodyColor} roughness={0.42} transparent={bodyOpacity < 1} opacity={bodyOpacity} depthWrite={bodyOpacity >= 1} />
              <Edges color={edgeColor} threshold={20} />
            </mesh>
          )
        })}
        {renderSelectedConnectorMarkers()}
        {selected && renderBoundsBox(0.12, 0.16, 0.12, floating ? floatingWarningColor : '#38bdf8')}
        {highlighted && !selected && renderBoundsBox(0.16, 0.2, 0.16, '#f59e0b')}
        {floating && renderBoundsBox(0.14, 0.18, 0.14, floatingWarningColor)}
      </group>
    )
  }

  return (
    <group position={[frame.x, bodyY, frame.z]} visible={!inactive} {...interactionHandlers}>
      {definition.voxelVisual && !displayColor ? (
        rotateWithPose(
          <VoxelBlockBody
            definition={definition}
            brick={brick}
            width={baseWidth}
            height={baseHeight}
            depth={baseDepth}
            opacity={ghost ? 0.44 : bodyOpacity}
            showEdges={showEdges || selected || highlighted || floating}
          />,
        )
      ) : isEyeTile ? (
        rotateWithPose(
          <RoundEyeTileBody variant={brick.brickId} height={baseHeight} />
        )
      ) : brick.brickId === 'tile-grille-1x2' ? (
        rotateWithPose(
          <GrilleTile1x2Body color={bodyColor} height={baseHeight} />
        )
      ) : brick.brickId === 'slope-1x2' ? (
        rotateWithPose(
        <mesh castShadow receiveShadow={false}>
          <primitive object={createSlope45Geometry(baseWidth, baseHeight, baseDepth)} attach="geometry" />
          <BrickBodyMaterial color={bodyColor} isSlope />
        </mesh>
        )
      ) : brick.brickId === 'slope-cheese-1x1' ? (
        rotateWithPose(
        <mesh castShadow receiveShadow={false}>
          <primitive object={createCheeseSlopeGeometry(baseWidth, baseHeight, baseDepth)} attach="geometry" />
          <BrickBodyMaterial color={bodyColor} isSlope />
        </mesh>
        )
      ) : brick.brickId === 'slope-curved-3x1' ? (
        rotateWithPose(
          <CurvedSlope3x1Body color={bodyColor} width={baseWidth} height={baseHeight} depth={baseDepth} />
        )
      ) : brick.brickId === 'headlight-brick-1x1' ? (
        rotateWithPose(
        <>
          <mesh castShadow receiveShadow position={[0, 0, baseDepth * 0.1]}>
            <boxGeometry args={[baseWidth, baseHeight, baseDepth * 0.8]} />
            <BrickBodyMaterial color={bodyColor} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, baseHeight * 0.4, baseDepth * -0.375]}>
            <boxGeometry args={[baseWidth, baseHeight * 0.2, baseDepth * 0.25]} />
            <BrickBodyMaterial color={bodyColor} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, baseHeight * -0.4, baseDepth * -0.375]}>
            <boxGeometry args={[baseWidth, baseHeight * 0.2, baseDepth * 0.25]} />
            <BrickBodyMaterial color={bodyColor} />
          </mesh>
          <mesh castShadow receiveShadow position={[baseWidth * -0.4, 0, baseDepth * -0.375]}>
            <boxGeometry args={[baseWidth * 0.2, baseHeight, baseDepth * 0.25]} />
            <BrickBodyMaterial color={bodyColor} />
          </mesh>
          <mesh castShadow receiveShadow position={[baseWidth * 0.4, 0, baseDepth * -0.375]}>
            <boxGeometry args={[baseWidth * 0.2, baseHeight, baseDepth * 0.25]} />
            <BrickBodyMaterial color={bodyColor} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, baseHeight * 0.08, baseDepth * -0.295]}>
            <boxGeometry args={[baseWidth * 0.62, baseHeight * 0.5, baseDepth * 0.05]} />
            <BrickBodyMaterial color={bodyColor} />
          </mesh>
        </>,
        )
      ) : brick.brickId === 'brick-round-2x2-axle' ? (
        rotateWithPose(
          <Round2x2AxleBody color={bodyColor} height={baseHeight} />
        )
      ) : brick.brickId === 'brick-round-2x2-axle-grille' ? (
        rotateWithPose(
          <Round2x2AxleBody color={bodyColor} height={baseHeight} grille />
        )
      ) : brick.brickId === 'plate-round-2x2-axle' ? (
        rotateWithPose(
          <Round2x2AxleBody color={bodyColor} height={baseHeight} />
        )
      ) : brick.brickId === 'cone-1x1-groove' ? (
        rotateWithPose(
          <GroovedCone1x1Body color={bodyColor} height={baseHeight} />
        )
      ) : (
        rotateWithPose(
        <mesh castShadow receiveShadow={definition.kind !== 'slope'}>
          {definition.kind === 'round' ? (
            <cylinderGeometry args={[Math.min(baseWidth, baseDepth) / 2, Math.min(baseWidth, baseDepth) / 2, baseHeight, 32]} />
          ) : definition.kind === 'cone' ? (
            <cylinderGeometry args={[Math.max(0.28, Math.min(baseWidth, baseDepth) * 0.17), Math.min(baseWidth, baseDepth) / 2, baseHeight, 36]} />
          ) : brick.brickId === 'inverted-slope-1x2' ? (
            <primitive object={createInvertedSlope45Geometry(baseWidth, baseHeight, baseDepth)} attach="geometry" />
          ) : brick.brickId === 'inverted-slope-2x2' ? (
            <primitive object={createInvertedSlope45Geometry(baseWidth, baseHeight, baseDepth)} attach="geometry" />
          ) : definition.kind === 'slope' ? (
            <primitive object={createSlopeGeometry(baseWidth, baseHeight, baseDepth, 0)} attach="geometry" />
          ) : (
            <boxGeometry args={[baseWidth, baseHeight, baseDepth]} />
          )}
          <BrickBodyMaterial color={bodyColor} opacity={bodyOpacity} isSlope={definition.kind === 'slope'} />
        </mesh>
        )
      )}
      {visibleStuds.map((connector) => {
        const direction = connectorDirection(connector)
        const studRotation = connectorRotation(connector)
        const renderedStudHeight = Math.abs(direction.y) > 0.5 ? studHeight : 0.2
        const studOffset = {
          x: direction.x * renderedStudHeight / 2,
          y: direction.y * renderedStudHeight / 2,
          z: direction.z * renderedStudHeight / 2,
        }

        return (
          <mesh
            key={connector.id}
            castShadow
            position={[
              connector.pose.xStud - frame.x + studOffset.x,
              connector.pose.yStud - frame.y + studOffset.y,
              connector.pose.zStud - frame.z + studOffset.z,
            ]}
            rotation={studRotation}
          >
            <cylinderGeometry args={[studRadius, studRadius, renderedStudHeight, 24]} />
            <meshStandardMaterial color={bodyColor} roughness={0.42} transparent={bodyOpacity < 1} opacity={bodyOpacity} depthWrite={bodyOpacity >= 1} />
            <Edges color={edgeColor} threshold={20} />
          </mesh>
        )
      })}
      {visiblePins.map((connector) => {
        const direction = connectorDirection(connector)
        const pinRotation = connectorRotation(connector)
        const pinLength = 0.42
        const pinOffset = {
          x: direction.x * pinLength / 2,
          y: direction.y * pinLength / 2,
          z: direction.z * pinLength / 2,
        }

        return (
          <mesh
            key={connector.id}
            castShadow
            receiveShadow
            position={[
              connector.pose.xStud - frame.x + pinOffset.x,
              connector.pose.yStud - frame.y + pinOffset.y,
              connector.pose.zStud - frame.z + pinOffset.z,
            ]}
            rotation={pinRotation}
          >
            <cylinderGeometry args={[0.14, 0.14, pinLength, 18]} />
            <meshStandardMaterial color={bodyColor} roughness={0.42} transparent={bodyOpacity < 1} opacity={bodyOpacity} depthWrite={bodyOpacity >= 1} />
            <Edges color={edgeColor} threshold={18} />
          </mesh>
        )
      })}
      {renderSelectedConnectorMarkers()}
      {selected && renderBoundsBox(0.12, 0.16, 0.12, floating ? floatingWarningColor : '#38bdf8')}
      {highlighted && !selected && renderBoundsBox(0.16, 0.2, 0.16, '#f59e0b')}
      {floating && renderBoundsBox(0.14, 0.18, 0.14, floatingWarningColor)}
    </group>
  )
}

type StructuralVoxelInstance = {
  brickId: string
  cell: WorldStructuralCellBox
}

type StructuralVoxelBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

type SimplifiedBrickInstance = {
  brick: PlacedBrick
  bounds: StructuralVoxelBounds
}

type SimplifiedBrickInstanceGroup = {
  color: string
  opacity: number
  instances: SimplifiedBrickInstance[]
}

const simplifiedBrickBoundsCache = new WeakMap<PlacedBrick, StructuralVoxelBounds | undefined>()

const getSimplifiedBrickBounds = (brick: PlacedBrick) => {
  if (simplifiedBrickBoundsCache.has(brick)) return simplifiedBrickBoundsCache.get(brick)

  const bounds = getBrickBounds(brick)
  simplifiedBrickBoundsCache.set(brick, bounds)
  return bounds
}

const getBoundsCenter = (bounds: StructuralVoxelBounds): [number, number, number] => [
  (bounds.minX + bounds.maxX) / 2,
  (bounds.minY + bounds.maxY) / 2,
  (bounds.minZ + bounds.maxZ) / 2,
]

const getBoundsSize = (bounds: StructuralVoxelBounds): [number, number, number] => [
  bounds.maxX - bounds.minX,
  bounds.maxY - bounds.minY,
  bounds.maxZ - bounds.minZ,
]

const StructuralVoxelInstances = ({ kind, instances, draggableIds, placementActive, onSelect, onSelectConnected, onBeginDragSelected, onConfirmPlacement, onCancelPlacement }: {
  kind: StructuralCellKind
  instances: StructuralVoxelInstance[]
  draggableIds: Set<string>
  placementActive: boolean
  onSelect: (id: string, options?: BrickSelectionOptions) => void
  onSelectConnected?: (id: string) => void
  onBeginDragSelected?: (id: string, point: { x: number; z: number }) => void
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) => {
  const fillRef = useRef<InstancedMesh>(null)
  const wireRef = useRef<InstancedMesh>(null)
  const matrixObject = useMemo(() => new Object3D(), [])
  const style = structuralVoxelStyle[kind]

  useLayoutEffect(() => {
    const writeInstanceMatrices = (mesh: InstancedMesh | null) => {
      if (!mesh) return

      instances.forEach((instance, index) => {
        const { cell } = instance
        const width = cell.maxX - cell.minX
        const height = cell.maxY - cell.minY
        const depth = cell.maxZ - cell.minZ
        matrixObject.position.set(
          cell.minX + width / 2,
          cell.minY + height / 2,
          cell.minZ + depth / 2,
        )
        matrixObject.scale.set(width, height, depth)
        matrixObject.updateMatrix()
        mesh.setMatrixAt(index, matrixObject.matrix)
      })

      mesh.count = instances.length
      mesh.instanceMatrix.needsUpdate = true
    }

    writeInstanceMatrices(fillRef.current)
    writeInstanceMatrices(wireRef.current)
  }, [instances, matrixObject])

  const getInstanceBrickId = (event: ThreeEvent<MouseEvent>) => {
    const instance = event.instanceId === undefined ? undefined : instances[event.instanceId]
    return instance?.brickId
  }
  const interactionHandlers = useBrickInteractionHandlers({
    resolveBrickId: getInstanceBrickId,
    canBeginDrag: (id) => draggableIds.has(id),
    placementActive,
    onSelect,
    onSelectConnected,
    onBeginDragSelected,
    onConfirmPlacement,
    onCancelPlacement,
  })

  if (instances.length === 0) return null

  return (
    <>
      <instancedMesh
        key={`${kind}-fill-${instances.length}`}
        ref={fillRef}
        args={[undefined, undefined, instances.length]}
        frustumCulled={false}
        renderOrder={kind === 'enterable' ? 1 : 2}
        {...interactionHandlers}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={style.color}
          transparent
          opacity={style.opacity}
          depthWrite={kind !== 'enterable'}
        />
      </instancedMesh>
      {kind !== 'enterable' && (
        <instancedMesh
          key={`${kind}-wire-${instances.length}`}
          ref={wireRef}
          args={[undefined, undefined, instances.length]}
          frustumCulled={false}
          renderOrder={3}
          {...interactionHandlers}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#111827" wireframe transparent opacity={0.18} depthWrite={false} />
        </instancedMesh>
      )}
    </>
  )
}

const StructuralVoxelSelectionBox = ({ bounds, selected }: {
  bounds: StructuralVoxelBounds
  selected: boolean
}) => (
  <BoundsOutline
    position={[(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2]}
    size={[bounds.maxX - bounds.minX + 0.04, bounds.maxY - bounds.minY + 0.04, bounds.maxZ - bounds.minZ + 0.04]}
    color={selected ? '#38bdf8' : '#f59e0b'}
  />
)

const StructuralVoxelScene = ({ bricks, selectedId, highlightedIdSet, boundsVersion, placementActive, onSelect, onSelectConnected, onBeginDragSelected, onConfirmPlacement, onCancelPlacement }: {
  bricks: PlacedBrick[]
  selectedId?: string
  highlightedIdSet: Set<string>
  boundsVersion: number
  placementActive: boolean
  onSelect: (id: string, options?: BrickSelectionOptions) => void
  onSelectConnected?: (id: string) => void
  onBeginDragSelected?: (id: string, point: { x: number; z: number }) => void
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) => {
  const { instancesByKind, boundsByBrickId } = useMemo(() => {
    void boundsVersion

    const nextInstancesByKind = Object.fromEntries(
      structuralVoxelRenderOrder.map((kind) => [kind, [] as StructuralVoxelInstance[]]),
    ) as Record<StructuralCellKind, StructuralVoxelInstance[]>
    const nextBoundsByBrickId = new Map<string, StructuralVoxelBounds>()

    for (const brick of bricks) {
      const cells = getBrickWorldRenderStructuralCellBoxes(brick)
      if (cells.length === 0) continue

      for (const cell of cells) {
        nextInstancesByKind[cell.kind].push({ brickId: brick.id, cell })
      }

      nextBoundsByBrickId.set(brick.id, {
        minX: Math.min(...cells.map((cell) => cell.minX)),
        maxX: Math.max(...cells.map((cell) => cell.maxX)),
        minY: Math.min(...cells.map((cell) => cell.minY)),
        maxY: Math.max(...cells.map((cell) => cell.maxY)),
        minZ: Math.min(...cells.map((cell) => cell.minZ)),
        maxZ: Math.max(...cells.map((cell) => cell.maxZ)),
      })
    }

    return { instancesByKind: nextInstancesByKind, boundsByBrickId: nextBoundsByBrickId }
  }, [bricks, boundsVersion])

  return (
    <>
      {structuralVoxelRenderOrder.map((kind) => (
        <StructuralVoxelInstances
        key={kind}
        kind={kind}
        instances={instancesByKind[kind]}
        draggableIds={new Set(selectedId ? [selectedId, ...highlightedIdSet] : highlightedIdSet)}
        placementActive={placementActive}
        onSelect={onSelect}
        onSelectConnected={onSelectConnected}
        onBeginDragSelected={onBeginDragSelected}
        onConfirmPlacement={onConfirmPlacement}
        onCancelPlacement={onCancelPlacement}
      />
      ))}
      {[...boundsByBrickId.entries()].map(([brickId, bounds]) => {
        const selected = brickId === selectedId
        if (!selected && !highlightedIdSet.has(brickId)) return null
        return <StructuralVoxelSelectionBox key={brickId} bounds={bounds} selected={selected} />
      })}
    </>
  )
}

const SimplifiedBrickInstances = memo(function SimplifiedBrickInstances({ group, showEdges, transformsByBrickId, draggableIds, placementActive, onSelect, onSelectConnected, onBeginDragSelected, onConfirmPlacement, onCancelPlacement }: {
  group: SimplifiedBrickInstanceGroup
  showEdges: boolean
  transformsByBrickId?: Map<string, BrickSceneTransform>
  draggableIds: Set<string>
  placementActive: boolean
  onSelect: (id: string, options?: BrickSelectionOptions) => void
  onSelectConnected?: (id: string) => void
  onBeginDragSelected?: (id: string, point: { x: number; z: number }) => void
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) {
  const fillRef = useRef<InstancedMesh>(null)
  const wireRef = useRef<InstancedMesh>(null)
  const previousInstancesRef = useRef<SimplifiedBrickInstance[]>()
  const previousTransformsRef = useRef<Map<string, BrickSceneTransform>>()
  const matrixObject = useMemo(() => new Object3D(), [])
  const transformAxis = useMemo(() => new Vector3(), [])
  const transformPivot = useMemo(() => new Vector3(), [])
  const transformTranslation = useMemo(() => new Vector3(), [])

  useLayoutEffect(() => {
    const previousInstances = previousInstancesRef.current
    const shouldRewriteAll = !previousInstances ||
      previousInstances.length !== group.instances.length ||
      previousTransformsRef.current !== transformsByBrickId

    const writeInstanceMatrices = (mesh: InstancedMesh | null, force: boolean) => {
      if (!mesh) return

      let hasMatrixUpdate = false
      group.instances.forEach((instance, index) => {
        if (!force && previousInstances?.[index]?.brick === instance.brick) return

        const [x, y, z] = getBoundsCenter(instance.bounds)
        const [width, height, depth] = getBoundsSize(instance.bounds)
        const transform = transformsByBrickId?.get(instance.brick.id)
        const rotation = transform?.rotation
        const translation = transform?.translation
        matrixObject.position.set(x, y, z)
        matrixObject.quaternion.identity()
        if (rotation) {
          transformAxis.set(rotation.axis.x, 0, rotation.axis.z).normalize()
          transformPivot.set(rotation.pivot.x, rotation.pivot.y, rotation.pivot.z)
          matrixObject.position
            .sub(transformPivot)
            .applyAxisAngle(transformAxis, rotation.angle)
            .add(transformPivot)
          matrixObject.quaternion.setFromAxisAngle(transformAxis, rotation.angle)
        }
        if (translation) {
          transformTranslation.set(translation.x, translation.y, translation.z)
          matrixObject.position.add(transformTranslation)
        }
        matrixObject.scale.set(width, height, depth)
        matrixObject.updateMatrix()
        mesh.setMatrixAt(index, matrixObject.matrix)
        hasMatrixUpdate = true
      })
      mesh.count = group.instances.length
      if (hasMatrixUpdate) mesh.instanceMatrix.needsUpdate = true
    }

    writeInstanceMatrices(fillRef.current, shouldRewriteAll)
    writeInstanceMatrices(wireRef.current, shouldRewriteAll)
    previousInstancesRef.current = group.instances
    previousTransformsRef.current = transformsByBrickId
  }, [group.instances, matrixObject, transformAxis, transformPivot, transformTranslation, transformsByBrickId])

  const getInstanceBrickId = (event: ThreeEvent<MouseEvent>) => {
    const instanceId = event.instanceId
    return typeof instanceId === 'number' ? group.instances[instanceId]?.brick.id : undefined
  }

  const interactionHandlers = useBrickInteractionHandlers({
    resolveBrickId: getInstanceBrickId,
    canBeginDrag: (id) => draggableIds.has(id),
    placementActive,
    onSelect,
    onSelectConnected,
    onBeginDragSelected,
    onConfirmPlacement,
    onCancelPlacement,
  })

  if (group.instances.length === 0) return null

  return (
    <>
      <instancedMesh
        ref={fillRef}
        args={[undefined, undefined, group.instances.length]}
        frustumCulled={false}
        {...interactionHandlers}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={group.color}
          roughness={0.52}
          metalness={0.02}
          transparent={group.opacity < 1}
          opacity={group.opacity}
        />
      </instancedMesh>
      {showEdges && (
        <instancedMesh
          ref={wireRef}
          args={[undefined, undefined, group.instances.length]}
          frustumCulled={false}
          renderOrder={2}
          {...interactionHandlers}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={edgeColor} wireframe transparent opacity={0.22} depthWrite={false} />
        </instancedMesh>
      )}
    </>
  )
})

const SimplifiedSelectionBox = ({ bounds, selected }: {
  bounds: StructuralVoxelBounds
  selected: boolean
}) => {
  const [width, height, depth] = getBoundsSize(bounds)
  return (
    <BoundsOutline
      position={getBoundsCenter(bounds)}
      size={[width + 0.12, height + 0.16, depth + 0.12]}
      color={selected ? '#38bdf8' : '#f59e0b'}
    />
  )
}

const SimplifiedBrickScene = ({ bricks, selectedId, highlightedIdSet, showEdges, displayColorByBrickId, transformsByBrickId, placementActive, onSelect, onSelectConnected, onBeginDragSelected, onConfirmPlacement, onCancelPlacement }: {
  bricks: PlacedBrick[]
  selectedId?: string
  highlightedIdSet: Set<string>
  showEdges: boolean
  displayColorByBrickId?: Map<string, string>
  transformsByBrickId?: Map<string, BrickSceneTransform>
  placementActive: boolean
  onSelect: (id: string, options?: BrickSelectionOptions) => void
  onSelectConnected?: (id: string) => void
  onBeginDragSelected?: (id: string, point: { x: number; z: number }) => void
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) => {
  const { groups, boundsByBrickId } = useMemo(() => {
    const nextGroups = new Map<string, SimplifiedBrickInstanceGroup>()
    const nextBoundsByBrickId = new Map<string, StructuralVoxelBounds>()

    for (const brick of bricks) {
      const bounds = getSimplifiedBrickBounds(brick)
      if (!bounds) continue

      nextBoundsByBrickId.set(brick.id, bounds)
      const displayColor = displayColorByBrickId?.get(brick.id)
      const groupKey = displayColor ?? brick.color
      const group = nextGroups.get(groupKey) ?? {
        color: displayColor ?? colorHex[brick.color],
        opacity: displayColor ? 0.9 : colorOpacity[brick.color],
        instances: [],
      }
      group.instances.push({ brick, bounds })
      nextGroups.set(groupKey, group)
    }

    return {
      groups: [...nextGroups.values()],
      boundsByBrickId: nextBoundsByBrickId,
    }
  }, [bricks, displayColorByBrickId])

  return (
    <>
      {groups.map((group) => (
        <SimplifiedBrickInstances
          key={`${group.color}-${group.opacity}`}
          group={group}
          showEdges={showEdges}
          transformsByBrickId={transformsByBrickId}
          draggableIds={new Set(selectedId ? [selectedId, ...highlightedIdSet] : highlightedIdSet)}
          placementActive={placementActive}
          onSelect={onSelect}
          onSelectConnected={onSelectConnected}
          onBeginDragSelected={onBeginDragSelected}
          onConfirmPlacement={onConfirmPlacement}
          onCancelPlacement={onCancelPlacement}
        />
      ))}
      {selectedId && boundsByBrickId.has(selectedId) && (
        <SimplifiedSelectionBox key={selectedId} bounds={boundsByBrickId.get(selectedId)!} selected />
      )}
      {[...highlightedIdSet].map((brickId) => {
        if (brickId === selectedId) return null
        const bounds = boundsByBrickId.get(brickId)
        return bounds ? <SimplifiedSelectionBox key={brickId} bounds={bounds} selected={false} /> : null
      })}
    </>
  )
}

type VoxelBoxInstance = {
  brick: PlacedBrick
  definition: BrickDefinition
}

type VoxelBoxInstanceGroup = {
  key: string
  definition: BrickDefinition
  instances: VoxelBoxInstance[]
}

const VoxelBoxInstances = memo(function VoxelBoxInstances({
  group,
  showEdges,
  draggableIds,
  placementActive,
  onSelect,
  onSelectConnected,
  onBeginDragSelected,
  onConfirmPlacement,
  onCancelPlacement,
}: {
  group: VoxelBoxInstanceGroup
  showEdges: boolean
  draggableIds: Set<string>
  placementActive: boolean
  onSelect: (id: string, options?: BrickSelectionOptions) => void
  onSelectConnected?: (id: string) => void
  onBeginDragSelected?: (id: string, point: { x: number; z: number }) => void
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) {
  const fillRef = useRef<InstancedMesh>(null)
  const wireRef = useRef<InstancedMesh>(null)
  const matrixObject = useMemo(() => new Object3D(), [])

  useLayoutEffect(() => {
    const writeMatrices = (mesh: InstancedMesh | null) => {
      if (!mesh) return
      group.instances.forEach(({ brick, definition }, index) => {
        const frame = getBrickWorldFrame(definition, brick.pose)
        matrixObject.position.set(frame.x, frame.y, frame.z)
        matrixObject.rotation.set(
          getVerticalRotationRadians(brick.pose.verticalQuarterTurns ?? 0),
          getHorizontalRotationRadians(brick.pose.rotationQuarterTurns),
          (brick.pose.rollQuarterTurns ?? 0) * Math.PI / 2,
          'YXZ',
        )
        matrixObject.scale.set(
          definition.footprint.widthStuds,
          definition.footprint.heightStuds,
          definition.footprint.depthStuds,
        )
        matrixObject.updateMatrix()
        if (brick.pose.orientationMatrix) {
          const scale = new Matrix4().makeScale(definition.footprint.widthStuds, definition.footprint.heightStuds, definition.footprint.depthStuds)
          matrixObject.scale.set(1, 1, 1)
          matrixObject.updateMatrix()
          matrixObject.matrix.multiply(exactOrientationMatrix4(brick.pose.orientationMatrix)).multiply(scale)
        }
        mesh.setMatrixAt(index, matrixObject.matrix)
      })
      mesh.count = group.instances.length
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingBox()
      mesh.computeBoundingSphere()
    }
    writeMatrices(fillRef.current)
    writeMatrices(wireRef.current)
  }, [group.instances, matrixObject])

  const getInstanceBrickId = (event: ThreeEvent<MouseEvent>) => {
    const instanceId = event.instanceId
    return typeof instanceId === 'number' ? group.instances[instanceId]?.brick.id : undefined
  }
  const interactionHandlers = useBrickInteractionHandlers({
    resolveBrickId: getInstanceBrickId,
    canBeginDrag: (id) => draggableIds.has(id),
    placementActive,
    onSelect,
    onSelectConnected,
    onBeginDragSelected,
    onConfirmPlacement,
    onCancelPlacement,
  })
  const visual = group.definition.voxelVisual
  if (!visual || group.instances.length === 0) return null

  return (
    <>
      <instancedMesh
        ref={fillRef}
        args={[undefined, undefined, group.instances.length]}
        castShadow={visual.renderLayer !== 'translucent'}
        material={[...getVoxelBlockMaterials(visual)]}
        receiveShadow={visual.renderLayer === 'opaque'}
        frustumCulled
        {...interactionHandlers}
      >
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      {showEdges && (
        <instancedMesh
          ref={wireRef}
          args={[undefined, undefined, group.instances.length]}
          frustumCulled
          renderOrder={2}
          {...interactionHandlers}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={edgeColor} wireframe transparent opacity={0.2} depthWrite={false} />
        </instancedMesh>
      )}
    </>
  )
})


const VoxelOptimizedScene = memo(function VoxelOptimizedScene({
  bricks,
  selectedId,
  highlightedIdSet,
  supportedByBrickId,
  preferDetailedGeometry,
  showEdges,
  displayColorByBrickId,
  transformsByBrickId,
  hiddenBrickIdSet,
  placementActive,
  onSelect,
  onSelectConnected,
  onBeginDragSelected,
  onConfirmPlacement,
  onCancelPlacement,
}: {
  bricks: PlacedBrick[]
  selectedId?: string
  highlightedIdSet: Set<string>
  supportedByBrickId: Map<string, boolean>
  preferDetailedGeometry: boolean
  showEdges: boolean
  displayColorByBrickId?: Map<string, string>
  transformsByBrickId?: Map<string, BrickSceneTransform>
  hiddenBrickIdSet: Set<string>
  placementActive: boolean
  onSelect: (id: string, options?: BrickSelectionOptions) => void
  onSelectConnected?: (id: string) => void
  onBeginDragSelected?: (id: string, point: { x: number; z: number }) => void
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) {
  const groupCacheRef = useRef(new Map<string, VoxelBoxInstanceGroup>())
  const ldrawBatchCache = useRef<LDrawSceneBatches>()
  const placementBatchCache = useRef<LDrawSceneBatches>()
  const transientBatches = placementActive || Boolean(transformsByBrickId?.size)
  const transformIdsKey = [...(transformsByBrickId?.keys() ?? [])].sort().join('|')
  const batchExcludedIds = useMemo(() => new Set([...hiddenBrickIdSet, ...(transformIdsKey ? transformIdsKey.split('|') : [])]), [hiddenBrickIdSet, transformIdsKey])
  const ldrawBatches = useMemo(() => {
    const result = buildLDrawSceneBatches(preferDetailedGeometry ? bricks : [], {
      selectedId, highlightedIds: highlightedIdSet, supportedByBrickId, displayColorByBrickId, showEdges,
      excludedIds: batchExcludedIds,
    }, transientBatches ? placementBatchCache.current ?? ldrawBatchCache.current : ldrawBatchCache.current)
    if (transientBatches) placementBatchCache.current = result
    else { ldrawBatchCache.current = result; placementBatchCache.current = undefined }
    return result
  }, [bricks, preferDetailedGeometry, selectedId, highlightedIdSet, supportedByBrickId, displayColorByBrickId, showEdges, batchExcludedIds, transientBatches])
  const batchedPrintIds = useMemo(() => new Set(ldrawBatches.printSources.flatMap(batch => batch.instances.map(instance => instance.brick.id))), [ldrawBatches])
  const batchResources = useLDrawBatchResources(ldrawBatches, ldrawBatchCache.current, placementBatchCache.current)
  const remainingBricks = preferDetailedGeometry ? ldrawBatches.individualBricks : bricks.filter(brick => brickById.get(brick.brickId)?.pack !== 'lego')
  const { groups, individualBricks } = useMemo(() => {
    const candidates = new Map<string, VoxelBoxInstanceGroup>()
    const individual: PlacedBrick[] = []

    for (const brick of remainingBricks) {
      const definition = brickById.get(brick.brickId)
      const visual = definition?.voxelVisual
      const canInstance = Boolean(
        definition && visual &&
        (visual.shape === 'cube' || visual.shape === 'slab') &&
        brick.id !== selectedId &&
        !highlightedIdSet.has(brick.id) &&
        supportedByBrickId.get(brick.id) !== false &&
        !displayColorByBrickId?.has(brick.id) &&
        !hiddenBrickIdSet.has(brick.id) &&
        !transformsByBrickId?.has(brick.id),
      )
      if (!canInstance || !definition || !visual) {
        individual.push(brick)
        continue
      }

      const key = getVoxelVisualKey(visual)
      const group = candidates.get(key) ?? { key, definition, instances: [] }
      group.instances.push({ brick, definition })
      candidates.set(key, group)
    }

    const nextGroups: VoxelBoxInstanceGroup[] = []
    for (const group of candidates.values()) {
      if (!shouldInstanceVoxelGroup(group.instances.length)) {
        individual.push(...group.instances.map((instance) => instance.brick))
        continue
      }
      const chunks = partitionVoxelItemsByChunk(
        group.instances,
        (instance) => ({ x: instance.brick.pose.xStud, z: instance.brick.pose.zStud }),
      )
      for (const [chunkKey, instances] of chunks) {
        const key = `${group.key}:${chunkKey}`
        const cached = groupCacheRef.current.get(key)
        const unchanged = cached?.instances.length === instances.length && instances.every(
          (instance, index) => cached.instances[index].brick === instance.brick,
        )
        nextGroups.push(unchanged ? cached : { key, definition: group.definition, instances })
      }
    }
    groupCacheRef.current = new Map(nextGroups.map((group) => [group.key, group]))
    return { groups: nextGroups, individualBricks: individual }
  }, [remainingBricks, displayColorByBrickId, hiddenBrickIdSet, highlightedIdSet, selectedId, supportedByBrickId, transformsByBrickId])
  const draggableIds = useMemo(
    () => new Set(selectedId ? [selectedId, ...highlightedIdSet] : highlightedIdSet),
    [highlightedIdSet, selectedId],
  )
  // Preserve the settled individual meshes while the placement preview hides
  // them. Cancel restores visibility rather than remounting hundreds of parts.
  const settledIndividuals = useRef<PlacedBrick[]>([])
  if (!placementActive) settledIndividuals.current = individualBricks
  const currentIndividualIds = new Set(individualBricks.map(brick => brick.id))
  const retainedIds = new Set(settledIndividuals.current.map(brick => brick.id))
  const renderedIndividuals = placementActive
    ? [...settledIndividuals.current, ...individualBricks.filter(brick => !retainedIds.has(brick.id))]
    : individualBricks

  return (
    <>
      {ldrawBatches.meshBatches.map(batch => <LDrawBatch key={batch.key} batch={batch} mesh={batchResources.bodies.get(batch)!} selectedId={selectedId} highlightedIdSet={highlightedIdSet} placementActive={placementActive} onSelect={onSelect} onSelectConnected={onSelectConnected} onBeginDragSelected={onBeginDragSelected} onConfirmPlacement={onConfirmPlacement} onCancelPlacement={onCancelPlacement} />)}
      {ldrawBatches.printBatches.map(batch => <LDrawPrints key={batch.key} batch={batch} mesh={batchResources.prints.get(batch)!} selectedId={selectedId} highlightedIdSet={highlightedIdSet} placementActive={placementActive} onSelect={onSelect} onSelectConnected={onSelectConnected} onBeginDragSelected={onBeginDragSelected} onConfirmPlacement={onConfirmPlacement} onCancelPlacement={onCancelPlacement} />)}
      {ldrawBatches.lineBatches.map(batch => <LDrawBatchLines key={batch.key} batch={batch} geometry={batchResources.lines.get(batch)!} />)}
      {groups.map((group) => (
        <VoxelBoxInstances
          key={group.key}
          group={group}
          showEdges={showEdges}
          draggableIds={draggableIds}
          placementActive={placementActive}
          onSelect={onSelect}
          onSelectConnected={onSelectConnected}
          onBeginDragSelected={onBeginDragSelected}
          onConfirmPlacement={onConfirmPlacement}
          onCancelPlacement={onCancelPlacement}
        />
      ))}
      {renderedIndividuals.map((brick) => (
        <TransformedBrick key={brick.id} transform={transformsByBrickId?.get(brick.id)}>
          <BrickMesh
            brick={brick}
            inactive={!currentIndividualIds.has(brick.id)}
            selected={brick.id === selectedId}
            highlighted={highlightedIdSet.has(brick.id)}
            floating={supportedByBrickId.get(brick.id) === false}
            preferDetailedGeometry={preferDetailedGeometry}
            showEdges={showEdges}
            displayColor={displayColorByBrickId?.get(brick.id)}
            batchedPrints={batchedPrintIds.has(brick.id)}
            ghost={hiddenBrickIdSet.has(brick.id)}
            placementActive={placementActive}
            onSelect={onSelect}
            onSelectConnected={onSelectConnected}
            onBeginDragSelected={onBeginDragSelected}
            onConfirmPlacement={onConfirmPlacement}
            onCancelPlacement={onCancelPlacement}
          />
        </TransformedBrick>
      ))}
    </>
  )
})

const WorldEntityMaterial = ({ color, ghost }: { color: string; ghost: boolean }) => (
  <meshStandardMaterial
    color={ghost ? '#22d3ee' : color}
    roughness={0.48}
    metalness={0.03}
    transparent={ghost}
    opacity={ghost ? 0.38 : 1}
    depthWrite={!ghost}
  />
)

const HumanWorldEntityMesh = ({ entity, ghost }: { entity: WorldEntity; ghost: boolean }) => {
  const isArcher = entity.definitionId === 'archer'
  const isPriest = entity.definitionId === 'priest'
  const factionColor = entity.factionId === 'red'
    ? '#dc2626'
    : entity.factionId === 'blue' ? '#2563eb' : '#64748b'
  const tunicColor = isPriest
    ? entity.factionId === 'red' ? '#fca5a5' : entity.factionId === 'blue' ? '#bfdbfe' : '#f8fafc'
    : entity.factionId === 'neutral' && isArcher ? '#15803d' : factionColor
  return (
    <group>
      {[-0.32, 0.32].map((x) => (
        <mesh key={x} position={[x, 0.7, 0]} castShadow={!ghost}>
          <boxGeometry args={[0.48, 1.4, 0.68]} />
          <WorldEntityMaterial color="#334155" ghost={ghost} />
        </mesh>
      ))}
      <mesh position={[0, 2.1, 0]} castShadow={!ghost}>
        <boxGeometry args={[1.55, 1.45, 0.82]} />
        <WorldEntityMaterial color={tunicColor} ghost={ghost} />
      </mesh>
      <mesh position={[0, 3.35, 0]} castShadow={!ghost}>
        <cylinderGeometry args={[0.53, 0.53, 0.9, 16]} />
        <WorldEntityMaterial color="#f1c27d" ghost={ghost} />
      </mesh>
      <mesh position={[0, 3.92, 0]} castShadow={!ghost}>
        <cylinderGeometry args={[0.62, 0.52, 0.34, 16]} />
        <WorldEntityMaterial color={isArcher ? '#166534' : isPriest ? '#7e22ce' : '#94a3b8'} ghost={ghost} />
      </mesh>
      {isArcher ? (
        <group position={[0.95, 2.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <torusGeometry args={[0.72, 0.055, 8, 20, Math.PI * 1.5]} />
            <WorldEntityMaterial color="#92400e" ghost={ghost} />
          </mesh>
          <mesh position={[-0.18, 0, 0]} rotation={[0, 0, -0.55]}>
            <cylinderGeometry args={[0.025, 0.025, 1.25, 6]} />
            <WorldEntityMaterial color="#e2e8f0" ghost={ghost} />
          </mesh>
        </group>
      ) : isPriest ? (
        <>
          <group position={[0.95, 2.25, 0]}>
            <mesh>
              <cylinderGeometry args={[0.065, 0.065, 2.8, 8]} />
              <WorldEntityMaterial color="#92400e" ghost={ghost} />
            </mesh>
            <mesh position={[0, 1.18, 0]}>
              <boxGeometry args={[0.72, 0.12, 0.12]} />
              <WorldEntityMaterial color="#fbbf24" ghost={ghost} />
            </mesh>
            <mesh position={[0, 1.18, 0]}>
              <boxGeometry args={[0.12, 0.72, 0.12]} />
              <WorldEntityMaterial color="#fbbf24" ghost={ghost} />
            </mesh>
          </group>
          <mesh position={[0, 4.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.62, 0.055, 8, 24]} />
            <WorldEntityMaterial color="#fde68a" ghost={ghost} />
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[1.02, 2.15, 0]} rotation={[0, 0, -0.18]}>
            <boxGeometry args={[0.12, 1.75, 0.18]} />
            <WorldEntityMaterial color="#cbd5e1" ghost={ghost} />
          </mesh>
          <mesh position={[-0.98, 2.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.58, 0.58, 0.14, 20]} />
            <WorldEntityMaterial color="#64748b" ghost={ghost} />
          </mesh>
        </>
      )}
    </group>
  )
}

const CatapultWorldEntityMesh = ({ entity, ghost }: { entity: WorldEntity; ghost: boolean }) => (
  <group>
    {[-1.45, 1.45].flatMap((x) => [-1.7, 1.7].map((z) => (
      <mesh key={`${x}:${z}`} position={[x, 0.82, z]} rotation={[0, 0, Math.PI / 2]} castShadow={!ghost}>
        <cylinderGeometry args={[0.72, 0.72, 0.42, 16]} />
        <WorldEntityMaterial color="#334155" ghost={ghost} />
      </mesh>
    )))}
    <mesh position={[0, 1.15, 0]} castShadow={!ghost}>
      <boxGeometry args={[3.2, 0.72, 4.7]} />
      <WorldEntityMaterial color={entity.factionId === 'red' ? '#b91c1c' : entity.factionId === 'blue' ? '#1d4ed8' : '#92400e'} ghost={ghost} />
    </mesh>
    <mesh position={[0, 2.25, -0.2]} rotation={[-0.7, 0, 0]} castShadow={!ghost}>
      <boxGeometry args={[0.42, 0.42, 4.3]} />
      <WorldEntityMaterial color="#78350f" ghost={ghost} />
    </mesh>
    <mesh position={[0, 3.5, 1.25]} castShadow={!ghost}>
      <sphereGeometry args={[0.58, 14, 14]} />
      <WorldEntityMaterial color="#64748b" ghost={ghost} />
    </mesh>
  </group>
)

const WorldEntityMesh = ({ entity, ghost = false, selected = false, placementActive = false, paused = false, elapsedSeconds = 0, onSelect }: {
  entity: WorldEntity
  ghost?: boolean
  selected?: boolean
  placementActive?: boolean
  paused?: boolean
  elapsedSeconds?: number
  onSelect?: (id: string) => void
}) => {
  const definition = worldEntityDefinitionById.get(entity.definitionId)
  const groupRef = useRef<Group>(null)
  const animationTimeRef = useRef(0)
  const initialVisualStateRef = useRef({ transform: entity.transform, health: entity.health })
  useLayoutEffect(() => {
    if (!groupRef.current || ghost) return
    const initial = initialVisualStateRef.current
    groupRef.current.position.set(initial.transform.x, initial.transform.y, initial.transform.z)
    groupRef.current.rotation.set(0, initial.transform.rotationRadians, initial.health <= 0 ? Math.PI / 2 : 0)
  }, [entity.id, ghost])
  useFrame((_state, deltaSeconds) => {
    if (!groupRef.current || ghost) return
    if (!paused) animationTimeRef.current += Math.min(deltaSeconds, 0.05)
    const interpolation = 1 - Math.exp(-Math.min(deltaSeconds, 0.05) * 18)
    groupRef.current.position.x += (entity.transform.x - groupRef.current.position.x) * interpolation
    groupRef.current.position.z += (entity.transform.z - groupRef.current.position.z) * interpolation
    const yawDelta = Math.atan2(
      Math.sin(entity.transform.rotationRadians - groupRef.current.rotation.y),
      Math.cos(entity.transform.rotationRadians - groupRef.current.rotation.y),
    )
    groupRef.current.rotation.y += yawDelta * interpolation
    groupRef.current.rotation.z += ((entity.health <= 0 ? Math.PI / 2 : 0) - groupRef.current.rotation.z) * interpolation
    const movingBob = entity.behaviorState === 'moving' ? Math.abs(Math.sin(animationTimeRef.current * 9)) * 0.09 : 0
    const combatPhase = getWorldCombatPresentationPhase(entity, definition, elapsedSeconds)
    const attackBob = entity.behaviorState === 'attacking'
      ? combatPhase === 'windup'
        ? -Math.abs(Math.sin(animationTimeRef.current * 8)) * 0.04
        : Math.max(0, Math.sin(animationTimeRef.current * 18)) * 0.12
      : entity.behaviorState === 'reviving' ? Math.sin(animationTimeRef.current * 7) * 0.1 : 0
    const hitRecoil = combatPhase === 'hurt' ? Math.sin(animationTimeRef.current * 28) * 0.08 : 0
    groupRef.current.position.y = entity.transform.y + movingBob + attackBob
    groupRef.current.position.x += hitRecoil * Math.cos(groupRef.current.rotation.y)
    groupRef.current.position.z -= hitRecoil * Math.sin(groupRef.current.rotation.y)
  })
  if (!definition) return null
  const healthRatio = Math.max(0, Math.min(1, entity.health / Math.max(1, entity.maxHealth)))
  const healthColor = healthRatio > 0.6 ? '#4ade80' : healthRatio > 0.3 ? '#facc15' : '#ff3b30'
  const showDamage = !ghost
    && Boolean(entity.combat.lastDamageAmount)
    && (entity.combat.damageIndicatorExpiresAtSeconds ?? 0) > elapsedSeconds
  return (
    <group
      ref={groupRef}
      position={ghost ? [entity.transform.x, entity.transform.y, entity.transform.z] : undefined}
      rotation={ghost ? [0, entity.transform.rotationRadians, 0] : undefined}
      userData={ghost ? { placementGhost: true } : undefined}
      onClick={ghost || !onSelect ? undefined : (event) => {
        if (placementActive) return
        event.stopPropagation()
        onSelect(entity.id)
      }}
    >
      {entity.definitionId === 'catapult'
        ? <CatapultWorldEntityMesh entity={entity} ghost={ghost} />
        : <HumanWorldEntityMesh entity={entity} ghost={ghost} />}
      {!ghost && (
        <Billboard position={[0, definition.visual.heightStuds + 0.65, 0]} follow>
          <Text position={[0, 0.25, 0]} fontSize={0.3} color="#0f172a" anchorY="bottom">
            {entity.name}
          </Text>
          <mesh position={[0, 0, 0]} renderOrder={10}>
            <planeGeometry args={[1.65, 0.16]} />
            <meshBasicMaterial color="#020617" transparent opacity={0.92} depthTest={false} depthWrite={false} />
          </mesh>
          <mesh position={[-0.8 + healthRatio * 0.8, 0, 0.006]} renderOrder={11}>
            <planeGeometry args={[1.55 * healthRatio, 0.1]} />
            <meshBasicMaterial color={healthColor} transparent opacity={1} depthTest={false} depthWrite={false} />
          </mesh>
        </Billboard>
      )}
      {showDamage && (
        <Html position={[0, definition.visual.heightStuds + 0.7, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="world-entity-damage-number">-{entity.combat.lastDamageAmount}</div>
        </Html>
      )}
      {selected && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.9, 1.08, 28]} />
          <meshBasicMaterial color="#0ea5e9" transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

const speechBubbleStyle = {
  pointerEvents: 'none',
  visibility: 'hidden',
  '--speech-tail-x': '0px',
} as CSSProperties

const speechLayoutIntervalSeconds = 1 / 20
const calculateSpeechOverlayPosition = (
  _object: Object3D,
  _camera: unknown,
  size: { width: number; height: number },
) => [size.width / 2, size.height / 2] as [number, number]

const WorldEntitySpeechLayer = ({ entities, selectedId }: { entities: WorldEntity[]; selectedId?: string }) => {
  const { t } = useI18n()
  const bubbleRefs = useRef(new Map<string, HTMLDivElement>())
  const bubbleSizeRefs = useRef(new Map<string, { width: number; height: number }>())
  const displayPositionsRef = useRef(new Map<string, { x: number; y: number; z: number }>())
  const layoutOffsetsRef = useRef(new Map<string, { offsetX: number; offsetY: number; tailOffsetX: number; tailSide: 'top' | 'bottom' }>())
  const targetLayoutOffsetsRef = useRef(new Map<string, { offsetX: number; offsetY: number; tailOffsetX: number; tailSide: 'top' | 'bottom' }>())
  const bubbleRefCallbacksRef = useRef(new Map<string, RefCallback<HTMLDivElement>>())
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const layoutElapsedRef = useRef(speechLayoutIntervalSeconds)
  const layoutDirtyRef = useRef(true)
  const lastStylesRef = useRef(new Map<string, { transform: string; visibility: string; tailOffsetX: string; tailSide: string }>())
  const projectedPoint = useMemo(() => new Vector3(), [])
  const speakingEntities = useMemo(
    () => selectWorldSpeechEntities(entities, selectedId),
    [entities, selectedId],
  )
  const getBubbleRef = useCallback((entityId: string) => {
    const existing = bubbleRefCallbacksRef.current.get(entityId)
    if (existing) return existing
    const callback: RefCallback<HTMLDivElement> = (node) => {
      const previousNode = bubbleRefs.current.get(entityId)
      if (previousNode && previousNode !== node) resizeObserverRef.current?.unobserve(previousNode)
      if (node) {
        bubbleRefs.current.set(entityId, node)
        resizeObserverRef.current?.observe(node)
        layoutDirtyRef.current = true
        return
      }
      bubbleRefs.current.delete(entityId)
      bubbleSizeRefs.current.delete(entityId)
      displayPositionsRef.current.delete(entityId)
      layoutOffsetsRef.current.delete(entityId)
      targetLayoutOffsetsRef.current.delete(entityId)
      lastStylesRef.current.delete(entityId)
      bubbleRefCallbacksRef.current.delete(entityId)
    }
    bubbleRefCallbacksRef.current.set(entityId, callback)
    return callback
  }, [])

  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.entityId
        if (!id) continue
        bubbleSizeRefs.current.set(id, {
          width: entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width,
          height: entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height,
        })
      }
      layoutDirtyRef.current = true
      layoutElapsedRef.current = speechLayoutIntervalSeconds
    })
    resizeObserverRef.current = observer
    for (const bubble of bubbleRefs.current.values()) observer.observe(bubble)
    return () => {
      observer.disconnect()
      resizeObserverRef.current = null
    }
  }, [])

  useFrame(({ camera, size }, deltaSeconds) => {
    layoutElapsedRef.current += Math.min(deltaSeconds, 0.05)
    const shouldLayout = layoutDirtyRef.current || layoutElapsedRef.current >= speechLayoutIntervalSeconds
    const inputs = speakingEntities.flatMap((entity) => {
      const bubble = bubbleRefs.current.get(entity.id)
      const definition = worldEntityDefinitionById.get(entity.definitionId)
      if (!bubble || !definition) return []
      const position = displayPositionsRef.current.get(entity.id) ?? {
        x: entity.transform.x,
        y: entity.transform.y,
        z: entity.transform.z,
      }
      displayPositionsRef.current.set(entity.id, position)
      const interpolation = 1 - Math.exp(-Math.min(deltaSeconds, 0.05) * 18)
      position.x += (entity.transform.x - position.x) * interpolation
      position.y += (entity.transform.y - position.y) * interpolation
      position.z += (entity.transform.z - position.z) * interpolation
      projectedPoint.set(
        position.x,
        position.y + definition.visual.heightStuds + 0.85,
        position.z,
      ).project(camera)
      const anchorX = (projectedPoint.x + 1) * size.width / 2
      const anchorY = (1 - projectedPoint.y) * size.height / 2
      const visible = projectedPoint.z >= -1 && projectedPoint.z <= 1
        && anchorX >= -120 && anchorX <= size.width + 120
        && anchorY >= -120 && anchorY <= size.height + 120
      const existingTargetOffset = targetLayoutOffsetsRef.current.get(entity.id)
      const visibility = visible && existingTargetOffset ? 'visible' : 'hidden'
      const targetOffset = existingTargetOffset ?? {
        offsetX: 0,
        offsetY: -42,
        tailOffsetX: 0,
        tailSide: 'bottom' as const,
      }
      const offset = layoutOffsetsRef.current.get(entity.id) ?? { ...targetOffset }
      layoutOffsetsRef.current.set(entity.id, offset)
      const layoutInterpolation = 1 - Math.exp(-Math.min(deltaSeconds, 0.05) * 14)
      offset.offsetX += (targetOffset.offsetX - offset.offsetX) * layoutInterpolation
      offset.offsetY += (targetOffset.offsetY - offset.offsetY) * layoutInterpolation
      offset.tailOffsetX += (targetOffset.tailOffsetX - offset.tailOffsetX) * layoutInterpolation
      offset.tailSide = targetOffset.tailSide
      const transform = `translate3d(${(anchorX + offset.offsetX).toFixed(1)}px, ${(anchorY + offset.offsetY).toFixed(1)}px, 0) translate(-50%, -50%)`
      const tailOffsetX = `${offset.tailOffsetX.toFixed(1)}px`
      const previousStyle = lastStylesRef.current.get(entity.id)
      if (previousStyle?.transform !== transform) bubble.style.transform = transform
      if (previousStyle?.visibility !== visibility) bubble.style.visibility = visibility
      if (previousStyle?.tailOffsetX !== tailOffsetX) bubble.style.setProperty('--speech-tail-x', tailOffsetX)
      if (previousStyle?.tailSide !== offset.tailSide) bubble.dataset.tailSide = offset.tailSide
      lastStylesRef.current.set(entity.id, {
        transform,
        visibility,
        tailOffsetX,
        tailSide: offset.tailSide,
      })
      if (!shouldLayout || !visible) return []
      const sizeCache = bubbleSizeRefs.current.get(entity.id)
      return [{
        id: entity.id,
        anchorX,
        anchorY,
        width: sizeCache?.width || 180,
        height: sizeCache?.height || 58,
      }]
    })
    if (!shouldLayout) return
    layoutElapsedRef.current = 0
    layoutDirtyRef.current = false
    const activeIds = new Set(speakingEntities.map((entity) => entity.id))
    for (const id of displayPositionsRef.current.keys()) {
      if (!activeIds.has(id)) displayPositionsRef.current.delete(id)
    }
    const layout = layoutWorldSpeechBubbles(inputs, size, targetLayoutOffsetsRef.current)
    for (const item of layout) {
      targetLayoutOffsetsRef.current.set(item.id, item)
    }
  })

  return (
    <Html
      fullscreen
      calculatePosition={calculateSpeechOverlayPosition}
      zIndexRange={[10, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div className="world-entity-speech-overlay" aria-live="polite">
        {speakingEntities.map((entity) => {
          if (!entity.speech) return null
          const speechText = entity.speech.text
            ?? t(`worldEntity.speech.${entity.speech.message}`, { target: entity.speech.targetName ?? entity.name })
          return (
            <div
              key={entity.id}
              ref={getBubbleRef(entity.id)}
              className="world-entity-speech-bubble"
              data-entity-id={entity.id}
              data-faction={entity.factionId}
              data-tail-side="bottom"
              role="status"
              aria-label={`${entity.name}: ${speechText}`}
              style={speechBubbleStyle}
            >
              <strong className="world-entity-speech-speaker">{entity.name}</strong>
              <span>{speechText}</span>
            </div>
          )
        })}
      </div>
    </Html>
  )
}

const WorldProjectileMesh = ({ projectile, elapsedSeconds, paused }: {
  projectile: WorldProjectileVisual
  elapsedSeconds: number
  paused: boolean
}) => {
  const groupRef = useRef<Group>(null)
  const visualTimeRef = useRef(Math.max(projectile.createdAtSeconds, elapsedSeconds))
  useEffect(() => {
    visualTimeRef.current = Math.max(visualTimeRef.current, elapsedSeconds)
  }, [elapsedSeconds])
  useFrame((_state, delta) => {
    if (!groupRef.current) return
    if (!paused) visualTimeRef.current += Math.min(delta, 0.05)
    const position = sampleWorldProjectilePosition(projectile, visualTimeRef.current)
    groupRef.current.position.set(position.x, position.y, position.z)
    groupRef.current.lookAt(projectile.end.x, projectile.end.y, projectile.end.z)
    groupRef.current.visible = position.progress < 1
  })
  return (
    <group ref={groupRef}>
      {projectile.kind === 'arrow' ? (
        <group rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[0.035, 0.035, 0.65, 8]} />
            <meshStandardMaterial color="#713f12" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.37, 0]}>
            <coneGeometry args={[0.09, 0.18, 8]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.35} roughness={0.45} />
          </mesh>
        </group>
      ) : (
        <mesh castShadow>
          <sphereGeometry args={[0.28, 14, 10]} />
          <meshStandardMaterial color="#57534e" roughness={0.95} />
        </mesh>
      )}
    </group>
  )
}

const WorldEntityScene = ({ entities, events, elapsedSeconds, paused, preview, selectedId, placementActive, hiddenEntityIdSet, showHiddenObjects, onSelect }: {
  entities: WorldEntity[]
  events: WorldEvent[]
  elapsedSeconds: number
  paused: boolean
  preview?: WorldEntity
  selectedId?: string
  placementActive: boolean
  hiddenEntityIdSet: Set<string>
  showHiddenObjects: boolean
  onSelect?: (id: string) => void
}) => {
  const renderedEntities = useMemo(
    () => entities.filter((entity) => showHiddenObjects || !hiddenEntityIdSet.has(entity.id)),
    [entities, hiddenEntityIdSet, showHiddenObjects],
  )
  const projectiles = useMemo(
    () => getWorldProjectileVisuals(events, renderedEntities, elapsedSeconds),
    [elapsedSeconds, events, renderedEntities],
  )
  return (
    <group>
    {renderedEntities.map((entity) => (
      <WorldEntityMesh
        key={entity.id}
        entity={entity}
        paused={paused}
        elapsedSeconds={elapsedSeconds}
        selected={entity.id === selectedId}
        placementActive={placementActive}
        ghost={hiddenEntityIdSet.has(entity.id)}
        onSelect={onSelect}
      />
    ))}
    <WorldEntitySpeechLayer selectedId={selectedId} entities={renderedEntities.filter((entity) => !hiddenEntityIdSet.has(entity.id))} />
    {preview && <WorldEntityMesh entity={preview} ghost />}
    {projectiles.map((projectile) => (
      <WorldProjectileMesh
        key={projectile.id}
        projectile={projectile}
        elapsedSeconds={elapsedSeconds}
        paused={paused}
      />
    ))}
    </group>
  )
}


const PlacementGhosts = ({ bricks, onConfirmPlacement, onCancelPlacement }: {
  bricks: PlacedBrick[]
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) => {
  if (bricks.length > 48) return <LargePlacementGhosts bricks={bricks} />

  return (
    <group renderOrder={30} userData={{ placementGhost: true }}>
      {bricks.map((brick) => (
        <BrickMesh
          key={brick.id}
          brick={brick}
          selected={false}
          highlighted={false}
          floating={false}
          preferDetailedGeometry
          showEdges
          displayColor="#22d3ee"
          ghost
          placementActive
          onSelect={() => {}}
          onConfirmPlacement={onConfirmPlacement}
          onCancelPlacement={onCancelPlacement}
        />
      ))}
    </group>
  )
}

const StabilityOverlay = ({ analysis }: { analysis: StabilityAnalysis }) => {
  if (analysis.totalMass <= 0) return null
  const center = analysis.centerOfMass
  const stable = analysis.tippingMargin >= 0
  const markerColor = stable ? '#2563eb' : '#dc2626'
  const hullPoints = analysis.supportHull.length >= 2
    ? [...analysis.supportHull, analysis.supportHull[0]].map((point) => [point.x, 0.035, point.z] as [number, number, number])
    : []

  return (
    <group renderOrder={30}>
      {hullPoints.length > 0 && (
        <Line points={hullPoints} color={stable ? '#16a34a' : '#dc2626'} lineWidth={3} depthTest={false} />
      )}
      <mesh position={[center.x, center.y, center.z]} renderOrder={31}>
        <sphereGeometry args={[0.2, 20, 20]} />
        <meshBasicMaterial color={markerColor} depthTest={false} />
      </mesh>
      {center.y > 0.1 && (
        <mesh position={[center.x, center.y / 2, center.z]} renderOrder={30}>
          <cylinderGeometry args={[0.025, 0.025, center.y, 10]} />
          <meshBasicMaterial color={markerColor} transparent opacity={0.68} depthTest={false} />
        </mesh>
      )}
      <Text
        position={[center.x, center.y + 0.34, center.z]}
        fontSize={0.2}
        color={markerColor}
        anchorX="center"
        anchorY="bottom"
      >
        COM
      </Text>
    </group>
  )
}

export const BrickScene = ({
  bricks,
  selectedId,
  highlightedIds = [],
  cameraFrameKey,
  analysisPaused = false,
  cameraFollowStepKey,
  cameraFocusBrickIds,
  preserveDrawingBuffer = false,
  initialCameraAzimuthDegrees,
  viewMode = 'border',
  stabilityAnalysis,
  displayColorByBrickId,
  transformsByBrickId,
  worldEntities = [],
  worldEvents = [],
  worldElapsedSeconds = 0,
  worldPaused = false,
  hiddenBrickIds = [],
  hiddenWorldEntityIds = [],
  showHiddenObjects = false,
  worldEntityPlacementPreview,
  selectedWorldEntityId,
  placementPreviewBricks = [],
  placementSourceBrickIds = [],
  placementActive = false,
  keyboardEnabled = true,
  onCameraAzimuthChange,
  onSelect,
  onSelectConnected,
  onSelectWorldEntity,
  onPlacementPointChange,
  onConfirmPlacement,
  onCancelPlacement,
  onBeginDragSelected,
  onNudgeSelected,
  onEndNudge,
  onRotateSelected,
  onDeleteSelected,
}: BrickSceneProps) => {
  const sceneCallbacks = useSceneCallbacks({ onSelect, onSelectConnected, onSelectWorldEntity, onPlacementPointChange, onConfirmPlacement, onCancelPlacement, onBeginDragSelected, onNudgeSelected, onEndNudge, onRotateSelected, onDeleteSelected, onCameraAzimuthChange })
  const { t } = useI18n()
  const { handlers: canvasGestureHandlers, canClearSelection, canConfirmPlacement } = useSceneCanvasGesture(placementActive)
  const { onSelect: selectSceneBrick, onConfirmPlacement: confirmPlacement } = sceneCallbacks
  const clearBackgroundSelection = useCallback(() => {
    if (placementActive || !canClearSelection()) return false
    selectSceneBrick('')
    return true
  }, [canClearSelection, placementActive, selectSceneBrick])
  const confirmScenePlacement = useCallback(() => {
    if (canConfirmPlacement()) confirmPlacement?.()
  }, [canConfirmPlacement, confirmPlacement])
  const structuralDebug = viewMode === 'voxel'
  const xrayDebug = viewMode === 'xray'
  const showBrickEdges = viewMode === 'border' || xrayDebug
  const highlightedIdSet = useMemo(() => new Set(highlightedIds), [highlightedIds])
  const hiddenBrickIdSet = useMemo(() => new Set(hiddenBrickIds), [hiddenBrickIds])
  const hiddenWorldEntityIdSet = useMemo(() => new Set(hiddenWorldEntityIds), [hiddenWorldEntityIds])
  const settledVisibleBricks = useMemo(
    () => bricks.filter(brick => showHiddenObjects || !hiddenBrickIdSet.has(brick.id)),
    [bricks, hiddenBrickIdSet, showHiddenObjects],
  )
  const visibleBricks = useMemo(
    () => getVisibleBricksDuringPlacement(settledVisibleBricks, placementSourceBrickIds),
    [settledVisibleBricks, placementSourceBrickIds],
  )
  const cameraFrameBricks = useMemo(
    () => {
      const focusIds = cameraFocusBrickIds?.length ? new Set(cameraFocusBrickIds) : undefined
      return bricks.filter((brick) => (showHiddenObjects || !hiddenBrickIdSet.has(brick.id)) && (!focusIds || focusIds.has(brick.id)))
    },
    [bricks, cameraFocusBrickIds, hiddenBrickIdSet, showHiddenObjects],
  )
  const [loadingPercent, setLoadingPercent] = useState(0)
  const [ldrawBoundsVersion, setLDrawBoundsVersion] = useState(0)
  const [preparedDefinitionIds, setPreparedDefinitionIds] = useState(() => new Set<string>())
  const visibleBricksRef = useRef(visibleBricks)
  visibleBricksRef.current = visibleBricks
  // Placement hides source meshes and shows ghosts instead. Camera framing
  // must keep using the stable source plan, otherwise a long press can look
  // like a model-bounds change and reset the user's view.
  const deferredFrameBricks = useDeferredValue(cameraFrameBricks)
  const deferredCameraFrameKey = useDeferredValue(cameraFrameKey)
  const frameBricks = deferredFrameBricks
  const renderLDrawDefinitionIdsKey = useMemo(() => Array.from(new Set(visibleBricks.flatMap((brick) => {
    const definition = brickById.get(brick.brickId)
    return definition?.pack === 'lego' ? [definition.id] : []
  }))).sort().join('|'), [visibleBricks])
  const performanceSettings = getScenePerformanceSettings(visibleBricks.length, viewMode)
  const worldAnimationFps = getWorldAnimationFps(bricks.length, worldEntities.length)
  const enableRealtimeShadows = performanceSettings.enableRealtimeShadows
  const preferDetailedGeometry = ldrawBoundsVersion > 0 && (visibleBricks.length < 800 || renderLDrawDefinitionIdsKey.split('|').every(id => preparedDefinitionIds.has(id)))
  const useSimplifiedInteractionView = performanceSettings.useSimplifiedView && !showHiddenObjects && !visibleBricks.every(brick => brickById.get(brick.brickId)?.pack === 'lego')
  const resolvedCameraFrameKey = useMemo(
    () => getSceneCameraFrameRequestKey(deferredCameraFrameKey, frameBricks.map((brick) => brick.id)),
    [deferredCameraFrameKey, frameBricks],
  )
  // Detailed LDraw bounds may finish loading after the scene is already
  // interactive. They should refresh geometry and bounds calculations, but
  // must not turn an ordinary edit (delete, duplicate, undo, visibility)
  // into a camera reset. Callers change cameraFrameKey only for intentional
  // reframing operations such as loading/importing a plan or changing a
  // manual step.
  const cameraFrameRequestKey = resolvedCameraFrameKey
  const orbitTargetRef = useRef<[number, number, number]>([0, 1, 0])
  const orbitTargetKeyRef = useRef('')

  useEffect(() => {
    if (renderLDrawDefinitionIdsKey.split('|').every(id => preparedDefinitionIds.has(id))) return
    let cancelled = false
    setLoadingPercent(0)
    const report = (fraction: number) => {
      if (!cancelled) setLoadingPercent(previous => Math.max(previous, Math.min(99, Math.floor(fraction * 100))))
    }
    prepareBrickDefinitionsGeometry(renderLDrawDefinitionIdsKey ? renderLDrawDefinitionIdsKey.split('|').map(id => brickById.get(id)!) : [], fraction => report(fraction * .7)).then(async () => {
      if (!cancelled) await prepareLDrawSceneBatches(visibleBricksRef.current, fraction => report(.7 + .3 * fraction))
      if (!cancelled) { setPreparedDefinitionIds(previous => new Set([...previous, ...renderLDrawDefinitionIdsKey.split('|')])); setLDrawBoundsVersion((version) => version + 1) }
    })

    return () => {
      cancelled = true
    }
  }, [renderLDrawDefinitionIdsKey, preparedDefinitionIds])

  const followBounds = useMemo(() => {
    void ldrawBoundsVersion
    const bounds = new Box3()
    if (cameraFollowStepKey) for (const brick of bricks) {
      if (!highlightedIdSet.has(brick.id)) continue
      const box = getBrickBounds(brick)
      if (box) { bounds.expandByPoint(new Vector3(box.minX, box.minY, box.minZ)); bounds.expandByPoint(new Vector3(box.maxX, box.maxY, box.maxZ)) }
    }
    return bounds
  }, [bricks, cameraFollowStepKey, highlightedIdSet, ldrawBoundsVersion])
  const sceneGridFade = useMemo(() => {
    void ldrawBoundsVersion
    let minX = -defaultGridExtent, maxX = defaultGridExtent, minZ = -defaultGridExtent, maxZ = defaultGridExtent
    for (const brick of settledVisibleBricks) {
      const bounds = getBrickBounds(brick)
      if (!bounds) continue
      minX = Math.min(minX, bounds.minX - gridPadding); maxX = Math.max(maxX, bounds.maxX + gridPadding)
      minZ = Math.min(minZ, bounds.minZ - gridPadding); maxZ = Math.max(maxZ, bounds.maxZ + gridPadding)
    }
    return getSceneGridFade({ minX, maxX, minZ, maxZ })
  }, [settledVisibleBricks, ldrawBoundsVersion])
  const gridFrame = useMemo(() => {
    void ldrawBoundsVersion

    const brickBounds = frameBricks.map(getBrickBounds).filter((bounds) => Boolean(bounds))
    const modelMinX = Math.min(0, ...brickBounds.map((bounds) => bounds.minX))
    const modelMaxX = Math.max(0, ...brickBounds.map((bounds) => bounds.maxX))
    const modelMinY = Math.min(0, ...brickBounds.map((bounds) => bounds.minY))
    const modelMaxY = Math.max(0, ...brickBounds.map((bounds) => bounds.maxY))
    const modelMinZ = Math.min(0, ...brickBounds.map((bounds) => bounds.minZ))
    const modelMaxZ = Math.max(0, ...brickBounds.map((bounds) => bounds.maxZ))
    const minX = Math.min(defaultGridExtent * -1, modelMinX - gridPadding)
    const maxX = Math.max(defaultGridExtent, modelMaxX + gridPadding)
    const minZ = Math.min(defaultGridExtent * -1, modelMinZ - gridPadding)
    const maxZ = Math.max(defaultGridExtent, modelMaxZ + gridPadding)
    const size = Math.ceil(Math.max(maxX - minX, maxZ - minZ))
    const modelHeight = modelMaxY - modelMinY
    const cameraSize = Math.max(
      8,
      Math.max(modelMaxX - modelMinX, modelMaxZ - modelMinZ) + gridPadding * 2,
      modelHeight * 1.4 + gridPadding * 2,
    )

    return {
      size,
      cameraSize,
      gridFade: getSceneGridFade({ minX, maxX, minZ, maxZ }),
      centerX: (minX + maxX) / 2,
      modelCenterX: (modelMinX + modelMaxX) / 2,
      centerY: Math.max(1, (modelMinY + modelMaxY) / 2),
      centerZ: (minZ + maxZ) / 2,
      modelCenterZ: (modelMinZ + modelMaxZ) / 2,
    }
  }, [frameBricks, ldrawBoundsVersion])
  const deferredSupportBricks = useDeferredValue(bricks)
  const [backgroundStability, setBackgroundStability] = useState<{ bricks: PlacedBrick[]; analysis: StabilityAnalysis }>()
  useEffect(() => {
    if (analysisPaused || !xrayDebug || stabilityAnalysis || deferredSupportBricks.length < backgroundAnalysisThreshold) return
    let canceled = false
    const timer = window.setTimeout(() => { void getEditorStability(deferredSupportBricks).then(analysis => {
      if (!canceled) setBackgroundStability({ bricks: deferredSupportBricks, analysis })
    }).catch(() => { /* Keep the last committed view if background analysis fails. */ }) }, 300)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [deferredSupportBricks, stabilityAnalysis, xrayDebug, analysisPaused])
  const resolvedStabilityAnalysis = useMemo(() => {
    if (stabilityAnalysis) return stabilityAnalysis
    if (!xrayDebug) return undefined
    return deferredSupportBricks.length >= backgroundAnalysisThreshold
      ? backgroundStability?.bricks === deferredSupportBricks ? backgroundStability.analysis : undefined
      : analyzeBuildStability(deferredSupportBricks)
  }, [backgroundStability, deferredSupportBricks, stabilityAnalysis, xrayDebug])
  const xrayColorByBrickId = useMemo(() => {
    if (!xrayDebug || !resolvedStabilityAnalysis) return undefined
    return new Map([...resolvedStabilityAnalysis.riskByBrickId].map(([brickId, item]) => [
      brickId,
      getStabilityRiskColor(item.risk, item.grounded),
    ]))
  }, [resolvedStabilityAnalysis, xrayDebug])
  const resolvedDisplayColorByBrickId = xrayColorByBrickId ?? displayColorByBrickId
  const [backgroundSupport, setBackgroundSupport] = useState<{ bricks: PlacedBrick[]; supported: Map<string, boolean> }>()
  useEffect(() => {
    if (analysisPaused || deferredSupportBricks.length < backgroundAnalysisThreshold || resolvedStabilityAnalysis) return
    let canceled = false
    const timer = window.setTimeout(() => { void getEditorSupport(deferredSupportBricks).then(supported => {
      if (!canceled) setBackgroundSupport({ bricks: deferredSupportBricks, supported })
    }).catch(() => { /* Validation UI reports analysis failures; keep pending colours neutral. */ }) }, 300)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [deferredSupportBricks, resolvedStabilityAnalysis, analysisPaused])
  const supportedByBrickId = useMemo(() => {
    void ldrawBoundsVersion

    if (resolvedStabilityAnalysis) {
      return new Map([...resolvedStabilityAnalysis.riskByBrickId].map(([brickId, item]) => [brickId, item.grounded]))
    }

    if (deferredSupportBricks.length >= backgroundAnalysisThreshold) {
      return backgroundSupport?.bricks === deferredSupportBricks ? backgroundSupport.supported : new Map<string, boolean>()
    }
    const buildGraph = createBuildGraph(deferredSupportBricks)
    return new Map(deferredSupportBricks.map((brick) => [
      brick.id,
      buildGraph.groundedIds.has(brick.id) && isVoxelPlantSupported(brick, deferredSupportBricks),
    ]))
  }, [backgroundSupport, deferredSupportBricks, ldrawBoundsVersion, resolvedStabilityAnalysis])

  if (orbitTargetKeyRef.current !== cameraFrameRequestKey) {
    orbitTargetKeyRef.current = cameraFrameRequestKey
    orbitTargetRef.current = [gridFrame.modelCenterX, gridFrame.centerY, gridFrame.modelCenterZ]
  }

  return (
    <Canvas
      data-geometry-ready={preferDetailedGeometry ? 'true' : 'false'}
      shadows={enableRealtimeShadows}
      frameloop="demand"
      dpr={[1, performanceSettings.maxDevicePixelRatio]}
      gl={{ preserveDrawingBuffer }}
      camera={{ position: [8, 7, 9], fov: 42 }}
      {...canvasGestureHandlers}
      onPointerMissed={clearBackgroundSelection}
    >
      {!preferDetailedGeometry && visibleBricks.some(brick => brickById.get(brick.brickId)?.pack === 'lego') && <Html fullscreen calculatePosition={(_object, _camera, size) => [size.width / 2, size.height / 2]} style={{ pointerEvents: 'none' }}><div className="scene-loading-progress" role="progressbar" aria-label={t('scene.loading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={loadingPercent}>
        <div className="scene-loading-progress-label"><span>{t('scene.loading')}</span><span>{loadingPercent}%</span></div>
        <div className="scene-loading-progress-track"><div style={{ width: `${loadingPercent}%` }} /></div>
      </div></Html>}
      <color attach="background" args={['#eef2f5']} />
      <SceneLighting
        centerX={gridFrame.centerX}
        centerY={gridFrame.centerY}
        centerZ={gridFrame.centerZ}
        size={gridFrame.size}
        enableShadows={enableRealtimeShadows}
      />
      <group
        onPointerMove={placementActive ? (event) => {
          if (!placementActive) return
          const surfacePoint = getFirstPlacementSurfacePoint(event)
          sceneCallbacks.onPlacementPointChange?.(surfacePoint)
        } : undefined}
        onClick={placementActive ? (event) => {
          if (!placementActive) return
          event.stopPropagation()
          confirmScenePlacement()
        } : undefined}
        onContextMenu={placementActive ? (event) => {
          if (!placementActive) return
          event.stopPropagation()
          event.nativeEvent.preventDefault()
          sceneCallbacks.onCancelPlacement?.()
        } : undefined}
      >
        <SceneGround fade={sceneGridFade} receiveShadow={enableRealtimeShadows} onBackgroundClick={clearBackgroundSelection} />
        {structuralDebug ? (
          <StructuralVoxelScene
            bricks={visibleBricks}
            selectedId={selectedId}
            highlightedIdSet={highlightedIdSet}
            boundsVersion={ldrawBoundsVersion}
            placementActive={placementActive}
            onSelect={sceneCallbacks.onSelect}
            onSelectConnected={sceneCallbacks.onSelectConnected}
            onBeginDragSelected={sceneCallbacks.onBeginDragSelected}
            onConfirmPlacement={confirmScenePlacement}
            onCancelPlacement={sceneCallbacks.onCancelPlacement}
          />
        ) : useSimplifiedInteractionView ? (
          <SimplifiedBrickScene
            bricks={visibleBricks}
            selectedId={selectedId}
            highlightedIdSet={highlightedIdSet}
            showEdges={showBrickEdges}
            displayColorByBrickId={resolvedDisplayColorByBrickId}
            transformsByBrickId={transformsByBrickId}
            placementActive={placementActive}
            onSelect={sceneCallbacks.onSelect}
            onSelectConnected={sceneCallbacks.onSelectConnected}
            onBeginDragSelected={sceneCallbacks.onBeginDragSelected}
            onConfirmPlacement={confirmScenePlacement}
            onCancelPlacement={sceneCallbacks.onCancelPlacement}
          />
        ) : (
          <VoxelOptimizedScene
            bricks={visibleBricks}
            selectedId={selectedId}
            highlightedIdSet={highlightedIdSet}
            supportedByBrickId={supportedByBrickId}
            preferDetailedGeometry={preferDetailedGeometry}
            showEdges={showBrickEdges}
            displayColorByBrickId={resolvedDisplayColorByBrickId}
            transformsByBrickId={transformsByBrickId}
            hiddenBrickIdSet={hiddenBrickIdSet}
            placementActive={placementActive}
            onSelect={sceneCallbacks.onSelect}
            onSelectConnected={sceneCallbacks.onSelectConnected}
            onBeginDragSelected={sceneCallbacks.onBeginDragSelected}
            onConfirmPlacement={confirmScenePlacement}
            onCancelPlacement={sceneCallbacks.onCancelPlacement}
          />
        )}
        {placementActive && (
          <PlacementGhosts
            bricks={placementPreviewBricks}
            onConfirmPlacement={confirmScenePlacement}
            onCancelPlacement={sceneCallbacks.onCancelPlacement}
          />
        )}
        <WorldEntityScene
          entities={worldEntities}
          events={worldEvents}
          elapsedSeconds={worldElapsedSeconds}
          paused={worldPaused}
          preview={worldEntityPlacementPreview}
          selectedId={selectedWorldEntityId}
          placementActive={placementActive}
          hiddenEntityIdSet={hiddenWorldEntityIdSet}
          showHiddenObjects={showHiddenObjects}
          onSelect={sceneCallbacks.onSelectWorldEntity}
        />
        {xrayDebug && resolvedStabilityAnalysis && <StabilityOverlay analysis={resolvedStabilityAnalysis} />}
        {bricks.length === 0 && (
          <Text position={[0, 1.2, 0]} fontSize={0.35} color="#475569">
            {t('scene.empty')}
          </Text>
        )}
      </group>
      {!placementActive && keyboardEnabled && (
        <KeyboardShortcuts
          selectedId={selectedId}
          onEndNudge={sceneCallbacks.onEndNudge}
          onNudgeSelected={sceneCallbacks.onNudgeSelected}
          onRotateSelected={sceneCallbacks.onRotateSelected}
          onDeleteSelected={sceneCallbacks.onDeleteSelected}
        />
      )}
      {keyboardEnabled && !placementActive && <CameraKeyboardNavigation enabled={!selectedId && !selectedWorldEntityId} />}
      <CameraFrame
        centerX={gridFrame.modelCenterX}
        centerY={gridFrame.centerY}
        centerZ={gridFrame.modelCenterZ}
        size={gridFrame.cameraSize}
        frameKey={cameraFrameRequestKey}
        azimuthDegrees={initialCameraAzimuthDegrees}
      />
      <ManualCameraFollow bounds={followBounds} stepKey={cameraFollowStepKey} frameKey={cameraFrameRequestKey} />
      <CameraAzimuthObserver onChange={sceneCallbacks.onCameraAzimuthChange} />
      <SceneAnimationDriver
        active={worldEntities.length > 0 && !worldPaused}
        targetFps={worldAnimationFps}
      />
      <OrbitControls target={orbitTargetRef.current} makeDefault enabled={!placementActive} />
    </Canvas>
  )
}
