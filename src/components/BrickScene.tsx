import { Edges, Line, OrbitControls, Text } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { memo, type ReactNode, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Object3D, Vector3, type DirectionalLight, type InstancedMesh } from 'three'
import { brickById, colorHex, colorOpacity } from '../data/basicBricks'
import { createRound2x2AxleBodyGeometry, createRound2x2AxleGrilleBodyGeometry } from '../lib/csgBrickGeometry'
import { getBrickWorldBoundsFrame } from '../lib/ldrawBounds'
import { loadLDrawGeneratedVisual } from '../lib/ldrawGeneratedVisualLoader'
import { createLoadedLDrawPartGeometry } from '../lib/ldrawVisualGeometry'
import { createBuildGraph, getBrickBounds } from '../lib/planUtils'
import { getScenePerformanceSettings } from '../lib/scenePerformance'
import { analyzeBuildStability, getStabilityRiskColor, type StabilityAnalysis } from '../lib/stabilityAnalysis'
import { getBrickWorldRenderStructuralCellBoxes, type StructuralCellKind, type WorldStructuralCellBox } from '../lib/structuralGrid'
import { WORLD_EDIT_STEP_STUDS, getBrickConnectors, getBrickWorldFrame, poseToWorld } from '../lib/brickUnits'
import { useI18n } from '../lib/i18n'
import {
  createCheeseSlopeGeometry,
  createCurvedSlope3x1Geometry,
  createCurvedSlope3x1OutlineGeometry,
  createInvertedSlope45Geometry,
  createSlope45Geometry,
} from '../lib/slopeGeometries'
import type { BrickDefinition, PlacedBrick } from '../types/bricks'

export type BrickSceneViewMode = 'border' | 'borderless' | 'xray' | 'voxel'

export type BrickSceneTransform = {
  translation?: { x: number; y: number; z: number }
  rotation?: {
    pivot: { x: number; y: number; z: number }
    axis: { x: number; z: number }
    angle: number
  }
}

type BrickSceneProps = {
  bricks: PlacedBrick[]
  selectedId?: string
  highlightedIds?: string[]
  cameraFrameKey?: string
  initialCameraAzimuthDegrees?: number
  viewMode?: BrickSceneViewMode
  stabilityAnalysis?: StabilityAnalysis
  displayColorByBrickId?: Map<string, string>
  transformsByBrickId?: Map<string, BrickSceneTransform>
  onCameraAzimuthChange?: (degrees: number) => void
  onSelect: (id: string) => void
  onSelectConnected?: (id: string) => void
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

const BoundsOutline = ({ position, size, color }: {
  position: [number, number, number]
  size: [number, number, number]
  color: string
}) => (
  <mesh position={position}>
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
}: {
  color: string
  opacity?: number
  isSlope?: boolean
  flatShading?: boolean
  showEdges?: boolean
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
    {showEdges && <Edges color={edgeColor} threshold={15} />}
  </>
)

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

const BrickPoseRotation = ({
  rotationQuarterTurns,
  verticalQuarterTurns,
  children,
}: {
  rotationQuarterTurns: number
  verticalQuarterTurns: number
  children: ReactNode
}) => (
  <group rotation={[0, getHorizontalRotationRadians(rotationQuarterTurns), 0]}>
    <group rotation={[getVerticalRotationRadians(verticalQuarterTurns), 0, 0]}>
      {children}
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
  onRotateSelected,
  onDeleteSelected,
}: Pick<BrickSceneProps, 'selectedId' | 'onNudgeSelected' | 'onRotateSelected' | 'onDeleteSelected'>) => {
  const { camera } = useThree()
  const selectedIdRef = useRef(selectedId)
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
    onNudgeSelectedRef.current = onNudgeSelected
    onRotateSelectedRef.current = onRotateSelected
    onDeleteSelectedRef.current = onDeleteSelected
  }, [onDeleteSelected, onNudgeSelected, onRotateSelected, selectedId])

  useEffect(() => {
    const clearHeldNudge = () => {
      const held = heldNudgeRef.current
      if (held?.delayId !== undefined) window.clearTimeout(held.delayId)
      if (held?.intervalId !== undefined) window.clearInterval(held.intervalId)
      heldNudgeRef.current = undefined
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
      if (delta && selectedIdRef.current) onNudgeSelectedRef.current(delta)
    }

    const startHeldNudge = (key: string) => {
      clearHeldNudge()
      triggerNudge(key)

      const delayId = window.setTimeout(() => {
        const held = heldNudgeRef.current
        if (!held || held.key !== key) return
        held.intervalId = window.setInterval(() => triggerNudge(key), nudgeRepeatIntervalMs)
      }, nudgeRepeatDelayMs)

      heldNudgeRef.current = { key, delayId }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedIdRef.current || isTypingTarget(event.target)) return

      const key = event.key.toLowerCase()
      const isNudgeKey = ['w', 'a', 's', 'd', 'r', 'f'].includes(key)

      if (isNudgeKey) {
        event.preventDefault()
        if (event.repeat || heldNudgeRef.current?.key === key) return
        startHeldNudge(key)
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
      if (heldNudgeRef.current?.key === event.key.toLowerCase()) {
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

const BrickMesh = memo(function BrickMesh({ brick, selected, highlighted, floating, preferDetailedGeometry, showEdges, displayColor, onSelect, onSelectConnected }: {
  brick: PlacedBrick
  selected: boolean
  highlighted: boolean
  floating: boolean
  preferDetailedGeometry: boolean
  showEdges: boolean
  displayColor?: string
  onSelect: (id: string) => void
  onSelectConnected?: (id: string) => void
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
      onSelect={onSelect}
      onSelectConnected={onSelectConnected}
    />
  )
})

const BrickMeshBody = ({ brick, definition, selected, highlighted, floating, preferDetailedGeometry, showEdges, displayColor, onSelect, onSelectConnected }: {
  brick: PlacedBrick
  definition: BrickDefinition
  selected: boolean
  highlighted: boolean
  floating: boolean
  preferDetailedGeometry: boolean
  showEdges: boolean
  displayColor?: string
  onSelect: (id: string) => void
  onSelectConnected?: (id: string) => void
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
  const bodyOpacity = displayColor ? 0.92 : colorOpacity[brick.color]
  const isEyeTile = brick.brickId === 'tile-eye-1x1' || brick.brickId === 'tile-eye-closed-1x1' || brick.brickId === 'tile-eye-offset-1x1' || brick.brickId === 'tile-eye-centered-1x1'
  const baseWidth = definition.footprint.widthStuds
  const baseDepth = definition.footprint.depthStuds
  const baseHeight = definition.footprint.heightStuds
  const ldrawGeometry = preferDetailedGeometry
    ? createLoadedLDrawPartGeometry(definition.partNumber, definition.footprint)
    : undefined

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onSelect(brick.id)
  }

  const handleDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onSelectConnected?.(brick.id)
  }

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
      <group position={[frame.x, bodyY, frame.z]} onClick={handleClick} onDoubleClick={handleDoubleClick}>
        {rotateWithPose(
          <>
            <mesh castShadow receiveShadow>
              <primitive object={ldrawGeometry} attach="geometry" />
              <BrickBodyMaterial
                color={bodyColor}
                opacity={bodyOpacity}
                isSlope={definition.kind === 'slope'}
                flatShading={false}
                showEdges={showEdges || selected || highlighted || floating}
              />
            </mesh>
            {isEyeTile && <RoundEyeTilePrints variant={brick.brickId} height={baseHeight} />}
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
      <group position={[frame.x, origin.y + 0.14, frame.z]} rotation={[0, rotation, Math.PI / 2]} onClick={handleClick} onDoubleClick={handleDoubleClick}>
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
      <group position={[frame.x, origin.y + frame.height / 2, frame.z]} rotation={[0, rotation, Math.PI / 2]} onClick={handleClick} onDoubleClick={handleDoubleClick}>
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
      <group position={[frame.x, bodyY, frame.z]} onClick={handleClick} onDoubleClick={handleDoubleClick}>
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
      <group position={[frame.x, bodyY, frame.z]} onClick={handleClick} onDoubleClick={handleDoubleClick}>
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
              <meshStandardMaterial color={bodyColor} roughness={0.42} />
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
    <group position={[frame.x, bodyY, frame.z]} onClick={handleClick} onDoubleClick={handleDoubleClick}>
      {isEyeTile ? (
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
          <BrickBodyMaterial color={bodyColor} isSlope={definition.kind === 'slope'} />
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
            <meshStandardMaterial color={bodyColor} roughness={0.42} />
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
            <meshStandardMaterial color={bodyColor} roughness={0.42} />
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

const StructuralVoxelInstances = ({ kind, instances, onSelect, onSelectConnected }: {
  kind: StructuralCellKind
  instances: StructuralVoxelInstance[]
  onSelect: (id: string) => void
  onSelectConnected?: (id: string) => void
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

  if (instances.length === 0) return null

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    const instance = event.instanceId === undefined ? undefined : instances[event.instanceId]
    if (!instance) return
    event.stopPropagation()
    onSelect(instance.brickId)
  }

  const handleDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    const instance = event.instanceId === undefined ? undefined : instances[event.instanceId]
    if (!instance) return
    event.stopPropagation()
    onSelectConnected?.(instance.brickId)
  }

  return (
    <>
      <instancedMesh
        key={`${kind}-fill-${instances.length}`}
        ref={fillRef}
        args={[undefined, undefined, instances.length]}
        frustumCulled={false}
        renderOrder={kind === 'enterable' ? 1 : 2}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
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
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
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

const StructuralVoxelScene = ({ bricks, selectedId, highlightedIdSet, boundsVersion, onSelect, onSelectConnected }: {
  bricks: PlacedBrick[]
  selectedId?: string
  highlightedIdSet: Set<string>
  boundsVersion: number
  onSelect: (id: string) => void
  onSelectConnected?: (id: string) => void
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
        onSelect={onSelect}
        onSelectConnected={onSelectConnected}
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

const SimplifiedBrickInstances = memo(function SimplifiedBrickInstances({ group, showEdges, transformsByBrickId, onSelect, onSelectConnected }: {
  group: SimplifiedBrickInstanceGroup
  showEdges: boolean
  transformsByBrickId?: Map<string, BrickSceneTransform>
  onSelect: (id: string) => void
  onSelectConnected?: (id: string) => void
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

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const brickId = getInstanceBrickId(event)
    if (brickId) onSelect(brickId)
  }

  const handleDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const brickId = getInstanceBrickId(event)
    if (brickId) onSelectConnected?.(brickId)
  }

  if (group.instances.length === 0) return null

  return (
    <>
      <instancedMesh
        ref={fillRef}
        args={[undefined, undefined, group.instances.length]}
        frustumCulled={false}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
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
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
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

const SimplifiedBrickScene = ({ bricks, selectedId, highlightedIdSet, showEdges, displayColorByBrickId, transformsByBrickId, onSelect, onSelectConnected }: {
  bricks: PlacedBrick[]
  selectedId?: string
  highlightedIdSet: Set<string>
  showEdges: boolean
  displayColorByBrickId?: Map<string, string>
  transformsByBrickId?: Map<string, BrickSceneTransform>
  onSelect: (id: string) => void
  onSelectConnected?: (id: string) => void
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
          onSelect={onSelect}
          onSelectConnected={onSelectConnected}
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
  initialCameraAzimuthDegrees,
  viewMode = 'border',
  stabilityAnalysis,
  displayColorByBrickId,
  transformsByBrickId,
  onCameraAzimuthChange,
  onSelect,
  onSelectConnected,
  onNudgeSelected,
  onRotateSelected,
  onDeleteSelected,
}: BrickSceneProps) => {
  const { t } = useI18n()
  const structuralDebug = viewMode === 'voxel'
  const xrayDebug = viewMode === 'xray'
  const showBrickEdges = viewMode === 'border' || xrayDebug
  const highlightedIdSet = useMemo(() => new Set(highlightedIds), [highlightedIds])
  const [ldrawBoundsVersion, setLDrawBoundsVersion] = useState(0)
  const deferredFrameBricks = useDeferredValue(bricks)
  const deferredCameraFrameKey = useDeferredValue(cameraFrameKey)
  const frameBricks = deferredFrameBricks
  const performanceSettings = getScenePerformanceSettings(bricks.length, viewMode)
  const enableRealtimeShadows = performanceSettings.enableRealtimeShadows
  const preferDetailedGeometry = ldrawBoundsVersion > 0
  const useSimplifiedInteractionView = performanceSettings.useSimplifiedView
  const resolvedCameraFrameKey = useMemo(
    () => deferredCameraFrameKey ?? frameBricks.map((brick) => brick.id).join('|'),
    [deferredCameraFrameKey, frameBricks],
  )
  const boundsCameraFrameKey = `${resolvedCameraFrameKey}:ldraw-bounds-${ldrawBoundsVersion}`
  const orbitTargetRef = useRef<[number, number, number]>([0, 1, 0])
  const orbitTargetKeyRef = useRef('')

  useEffect(() => {
    let cancelled = false
    loadLDrawGeneratedVisual().then(() => {
      if (!cancelled) setLDrawBoundsVersion((version) => version + 1)
    })

    return () => {
      cancelled = true
    }
  }, [])

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
      centerX: (minX + maxX) / 2,
      modelCenterX: (modelMinX + modelMaxX) / 2,
      centerY: Math.max(1, (modelMinY + modelMaxY) / 2),
      centerZ: (minZ + maxZ) / 2,
      modelCenterZ: (modelMinZ + modelMaxZ) / 2,
    }
  }, [frameBricks, ldrawBoundsVersion])
  const deferredSupportBricks = useDeferredValue(bricks)
  const resolvedStabilityAnalysis = useMemo(
    () => stabilityAnalysis ?? (xrayDebug ? analyzeBuildStability(deferredSupportBricks) : undefined),
    [deferredSupportBricks, stabilityAnalysis, xrayDebug],
  )
  const xrayColorByBrickId = useMemo(() => {
    if (!xrayDebug || !resolvedStabilityAnalysis) return undefined
    return new Map([...resolvedStabilityAnalysis.riskByBrickId].map(([brickId, item]) => [
      brickId,
      getStabilityRiskColor(item.risk, item.grounded),
    ]))
  }, [resolvedStabilityAnalysis, xrayDebug])
  const resolvedDisplayColorByBrickId = xrayColorByBrickId ?? displayColorByBrickId
  const supportedByBrickId = useMemo(() => {
    void ldrawBoundsVersion

    if (resolvedStabilityAnalysis) {
      return new Map([...resolvedStabilityAnalysis.riskByBrickId].map(([brickId, item]) => [brickId, item.grounded]))
    }

    const buildGraph = createBuildGraph(deferredSupportBricks)
    return new Map(deferredSupportBricks.map((brick) => [
      brick.id,
      buildGraph.groundedIds.has(brick.id),
    ]))
  }, [deferredSupportBricks, ldrawBoundsVersion, resolvedStabilityAnalysis])

  if (orbitTargetKeyRef.current !== boundsCameraFrameKey) {
    orbitTargetKeyRef.current = boundsCameraFrameKey
    orbitTargetRef.current = [gridFrame.modelCenterX, gridFrame.centerY, gridFrame.modelCenterZ]
  }

  return (
    <Canvas
      shadows={enableRealtimeShadows}
      frameloop="demand"
      dpr={[1, performanceSettings.maxDevicePixelRatio]}
      camera={{ position: [8, 7, 9], fov: 42 }}
      onPointerMissed={() => onSelect('')}
    >
      <color attach="background" args={['#eef2f5']} />
      <SceneLighting
        centerX={gridFrame.centerX}
        centerY={gridFrame.centerY}
        centerZ={gridFrame.centerZ}
        size={gridFrame.size}
        enableShadows={enableRealtimeShadows}
      />
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[gridFrame.centerX, -0.02, gridFrame.centerZ]} receiveShadow={enableRealtimeShadows}>
          <planeGeometry args={[gridFrame.size, gridFrame.size]} />
          <meshStandardMaterial color="#d7dee6" side={DoubleSide} />
        </mesh>
        <gridHelper args={[gridFrame.size, gridFrame.size, '#93a4b7', '#c4ced8']} position={[gridFrame.centerX, 0, gridFrame.centerZ]} />
        {structuralDebug ? (
          <StructuralVoxelScene
            bricks={bricks}
            selectedId={selectedId}
            highlightedIdSet={highlightedIdSet}
            boundsVersion={ldrawBoundsVersion}
            onSelect={onSelect}
            onSelectConnected={onSelectConnected}
          />
        ) : useSimplifiedInteractionView ? (
          <SimplifiedBrickScene
            bricks={bricks}
            selectedId={selectedId}
            highlightedIdSet={highlightedIdSet}
            showEdges={showBrickEdges}
            displayColorByBrickId={resolvedDisplayColorByBrickId}
            transformsByBrickId={transformsByBrickId}
            onSelect={onSelect}
            onSelectConnected={onSelectConnected}
          />
        ) : bricks.map((brick) => (
          <TransformedBrick key={brick.id} transform={transformsByBrickId?.get(brick.id)}>
            <BrickMesh
              brick={brick}
              selected={brick.id === selectedId}
              highlighted={highlightedIdSet.has(brick.id)}
              floating={supportedByBrickId.get(brick.id) === false}
              preferDetailedGeometry={preferDetailedGeometry}
              showEdges={showBrickEdges}
              displayColor={resolvedDisplayColorByBrickId?.get(brick.id)}
              onSelect={onSelect}
              onSelectConnected={onSelectConnected}
            />
          </TransformedBrick>
        ))}
        {xrayDebug && resolvedStabilityAnalysis && <StabilityOverlay analysis={resolvedStabilityAnalysis} />}
        {bricks.length === 0 && (
          <Text position={[0, 1.2, 0]} fontSize={0.35} color="#475569">
            {t('scene.empty')}
          </Text>
        )}
      </group>
      <KeyboardShortcuts
        selectedId={selectedId}
        onNudgeSelected={onNudgeSelected}
        onRotateSelected={onRotateSelected}
        onDeleteSelected={onDeleteSelected}
      />
      <CameraFrame
        centerX={gridFrame.modelCenterX}
        centerY={gridFrame.centerY}
        centerZ={gridFrame.modelCenterZ}
        size={gridFrame.cameraSize}
        frameKey={boundsCameraFrameKey}
        azimuthDegrees={initialCameraAzimuthDegrees}
      />
      <CameraAzimuthObserver onChange={onCameraAzimuthChange} />
      <OrbitControls target={orbitTargetRef.current} makeDefault />
    </Canvas>
  )
}
