import { Edges, Grid } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { DoubleSide, type Group, Vector3 } from 'three'

export type GuideDemoMode =
  | 'orbit'
  | 'pan'
  | 'zoom'
  | 'fly'
  | 'select'
  | 'multiselect'
  | 'connected'
  | 'nudge'
  | 'lift'
  | 'rotate90'
  | 'rotate15'
  | 'angledSnap'
  | 'collision'
  | 'undo'

const STUD_RADIUS = 0.28
const STUD_HEIGHT = 0.18

const MiniLegoBrick = ({
  width = 2,
  depth = 1,
  height = 0.8,
  color = '#2563eb',
  position = [0, 0, 0],
  rotationY = 0,
  obbColor,
  visible = true,
}: {
  width?: number
  depth?: number
  height?: number
  color?: string
  position?: [number, number, number]
  rotationY?: number
  obbColor?: string
  visible?: boolean
}) => {
  if (!visible) return null
  const studs: [number, number][] = []
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      studs.push([x - (width - 1) / 2, z - (depth - 1) / 2])
    }
  }
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={color} roughness={0.36} metalness={0.04} />
        <Edges color="#0f172a" threshold={15} side={DoubleSide} />
      </mesh>
      {studs.map(([sx, sz]) => (
        <mesh key={`${sx}:${sz}`} position={[sx, height + STUD_HEIGHT / 2, sz]} castShadow>
          <cylinderGeometry args={[STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 20]} />
          <meshStandardMaterial color={color} roughness={0.36} metalness={0.04} />
          <Edges color="#0f172a" threshold={25} side={DoubleSide} />
        </mesh>
      ))}
      {obbColor && (
        <mesh position={[0, (height + STUD_HEIGHT) / 2, 0]}>
          <boxGeometry args={[width + 0.14, height + STUD_HEIGHT + 0.14, depth + 0.14]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          <Edges color={obbColor} threshold={15} side={DoubleSide} />
        </mesh>
      )}
    </group>
  )
}

const DemoStageContent = ({ mode }: { mode: GuideDemoMode }) => {
  const { camera } = useThree()
  const primaryRef = useRef<Group>(null)
  const secondaryRef = useRef<Group>(null)
  const obbPrimaryRef = useRef<Group>(null)
  const obbSecondaryRef = useRef<Group>(null)
  const obbBlockerRef = useRef<Group>(null)
  const elapsedRef = useRef(0)
  const lookTarget = useRef(new Vector3(0, 0.45, 0))

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    elapsedRef.current += delta
    const t = elapsedRef.current

    // Default close-up camera framing so the brick is large and crisp
    let camX = 3.2
    let camY = 2.45
    let camZ = 3.4
    lookTarget.current.set(0, 0.45, 0)

    if (mode === 'orbit') {
      // Smooth full 360-degree orbit around the single big brick
      const angle = t * 1.15
      const r = 4.2
      camX = Math.cos(angle) * r
      camY = 2.35 + Math.sin(angle * 0.5) * 0.35
      camZ = Math.sin(angle) * r
    } else if (mode === 'pan') {
      const shift = Math.sin(t * 1.6) * 1.15
      camX = 3.2 + shift
      camY = 2.45
      camZ = 3.4 - shift * 0.35
      lookTarget.current.set(shift, 0.45, -shift * 0.35)
    } else if (mode === 'zoom') {
      const dist = 3.6 + Math.sin(t * 1.8) * 1.35
      camX = dist * 0.72
      camY = dist * 0.56
      camZ = dist * 0.76
    } else if (mode === 'fly') {
      const forward = Math.sin(t * 1.4) * 1.2
      const side = Math.cos(t * 1.4) * 0.9
      camX = 3.2 + side
      camY = 2.25
      camZ = 3.6 + forward
      lookTarget.current.set(side * 0.6, 0.45, forward * 0.6)
    }

    camera.position.set(camX, camY, camZ)
    camera.lookAt(lookTarget.current)

    const p = primaryRef.current
    const s = secondaryRef.current

    if (p) {
      p.position.set(0, 0, 0)
      p.rotation.set(0, 0, 0)
      p.visible = true
    }
    if (s) {
      s.position.set(0, 0, 0)
      s.rotation.set(0, 0, 0)
      s.visible = true
    }

    const cycle = (t % 3.6) / 3.6

    if (mode === 'select' && obbPrimaryRef.current) {
      obbPrimaryRef.current.visible = cycle > 0.25
    } else if (mode === 'multiselect' && obbPrimaryRef.current && obbSecondaryRef.current) {
      obbPrimaryRef.current.visible = cycle > 0.18
      obbSecondaryRef.current.visible = cycle > 0.52
    } else if (mode === 'connected' && obbPrimaryRef.current && obbSecondaryRef.current) {
      const active = cycle > 0.28
      obbPrimaryRef.current.visible = active
      obbSecondaryRef.current.visible = active
    } else if (mode === 'nudge' && p) {
      const step = Math.floor(cycle * 4)
      const offsets: [number, number][] = [[0, 0], [0.6, 0], [0.6, 0.6], [0, 0.6]]
      const [ox, oz] = offsets[step % 4]
      p.position.set(ox - 0.3, 0, oz - 0.3)
    } else if (mode === 'lift' && p) {
      const liftY = Math.max(0, Math.sin(cycle * Math.PI) * 1.2)
      p.position.set(0, liftY, 0)
    } else if (mode === 'rotate90' && p) {
      const step = Math.floor(cycle * 4)
      p.rotation.y = -(step * Math.PI) / 2
    } else if (mode === 'rotate15' && p) {
      const step = Math.floor(cycle * 8)
      p.rotation.y = -((step * 15) * Math.PI) / 180
    } else if (mode === 'angledSnap' && p) {
      // Approach angled 33.7-deg base plate, then auto-align and snap onto studs!
      const targetRad = -(33.7 * Math.PI) / 180
      if (cycle < 0.35) {
        const k = cycle / 0.35
        p.position.set(-1.8 * (1 - k), 0.72, 0.9 * (1 - k))
        p.rotation.y = 0
      } else if (cycle < 0.55) {
        const k = (cycle - 0.35) / 0.2
        p.position.set(0, 0.72 - 0.32 * k, 0)
        p.rotation.y = targetRad * k
      } else {
        p.position.set(0, 0.4, 0)
        p.rotation.y = targetRad
      }
    } else if (mode === 'collision' && p && obbBlockerRef.current) {
      // Try twisting 1x3 plate over 1x3 plate -> blocked & lower brick flashes red OBB
      const attempt = cycle > 0.25 && cycle < 0.72
      const bounce = attempt ? Math.sin(((cycle - 0.25) / 0.47) * Math.PI * 2) : 0
      p.position.set(0, 0.4, 0)
      p.rotation.y = -Math.max(0, bounce) * 0.22
      obbBlockerRef.current.visible = attempt && bounce > 0.25
    } else if (mode === 'undo' && p) {
      p.visible = cycle < 0.32 || cycle > 0.66
    }
  })

  return (
    <>
      <color attach="background" args={['#f4f7fb']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[5, 8, 5]} intensity={1.15} castShadow />
      <directionalLight position={[-4, 5, -3]} intensity={0.45} />
      <Grid
        args={[14, 14]}
        cellSize={1}
        cellThickness={0.7}
        cellColor="#cbd5e1"
        sectionSize={4}
        sectionThickness={1.1}
        sectionColor="#94a3b8"
        fadeDistance={14}
        position={[0, -0.002, 0]}
      />

      {/* Single-brick modes: orbit / pan / zoom / select / nudge / lift / rotate90 / undo */}
      {(mode === 'orbit' || mode === 'pan' || mode === 'zoom' || mode === 'fly') && (
        <group ref={primaryRef}>
          <MiniLegoBrick width={2} depth={1} height={0.96} color="#2563eb" />
        </group>
      )}

      {mode === 'select' && (
        <group ref={primaryRef}>
          <MiniLegoBrick width={2} depth={1} height={0.96} color="#2563eb" />
          <group ref={obbPrimaryRef} visible={false}>
            <mesh position={[0, (0.96 + STUD_HEIGHT) / 2, 0]}>
              <boxGeometry args={[2.16, 0.96 + STUD_HEIGHT + 0.16, 1.16]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              <Edges color="#38bdf8" threshold={15} side={DoubleSide} />
            </mesh>
          </group>
        </group>
      )}

      {(mode === 'multiselect' || mode === 'connected') && (
        <>
          <group ref={primaryRef}>
            <MiniLegoBrick width={2} depth={1} height={0.96} color="#2563eb" position={mode === 'connected' ? [0, 0, 0] : [-1.15, 0, 0]} />
            <group ref={obbPrimaryRef} visible={false}>
              <mesh position={[mode === 'connected' ? 0 : -1.15, (0.96 + STUD_HEIGHT) / 2, 0]}>
                <boxGeometry args={[2.16, 0.96 + STUD_HEIGHT + 0.16, 1.16]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                <Edges color={mode === 'connected' ? '#f59e0b' : '#38bdf8'} threshold={15} side={DoubleSide} />
              </mesh>
            </group>
          </group>
          <group ref={secondaryRef}>
            <MiniLegoBrick width={2} depth={1} height={0.96} color="#eab308" position={mode === 'connected' ? [0.5, 0.96, 0] : [1.15, 0, 0]} />
            <group ref={obbSecondaryRef} visible={false}>
              <mesh position={[mode === 'connected' ? 0.5 : 1.15, (mode === 'connected' ? 0.96 : 0) + (0.96 + STUD_HEIGHT) / 2, 0]}>
                <boxGeometry args={[2.16, 0.96 + STUD_HEIGHT + 0.16, 1.16]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                <Edges color="#f59e0b" threshold={15} side={DoubleSide} />
              </mesh>
            </group>
          </group>
        </>
      )}

      {(mode === 'nudge' || mode === 'lift' || mode === 'rotate90' || mode === 'undo') && (
        <group ref={primaryRef}>
          <MiniLegoBrick width={3} depth={1} height={0.8} color="#2563eb" obbColor="#38bdf8" />
        </group>
      )}

      {mode === 'rotate15' && (
        <>
          {/* 1x1 single-stud pivot base */}
          <MiniLegoBrick width={1} depth={1} height={0.4} color="#94a3b8" />
          <group ref={primaryRef} position={[0, 0.4, 0]}>
            <MiniLegoBrick width={3} depth={1} height={0.4} color="#2563eb" position={[0, 0.4, 0]} obbColor="#38bdf8" />
          </group>
        </>
      )}

      {mode === 'angledSnap' && (
        <>
          <MiniLegoBrick width={3} depth={1} height={0.4} color="#d6c5a3" rotationY={-(33.7 * Math.PI) / 180} />
          <group ref={primaryRef}>
            <MiniLegoBrick width={3} depth={1} height={0.4} color="#2563eb" obbColor="#38bdf8" />
          </group>
        </>
      )}

      {mode === 'collision' && (
        <>
          <MiniLegoBrick width={3} depth={1} height={0.4} color="#94a3b8" />
          <group ref={obbBlockerRef} visible={false}>
            <mesh position={[0, (0.4 + STUD_HEIGHT) / 2, 0]}>
              <boxGeometry args={[3.16, 0.4 + STUD_HEIGHT + 0.16, 1.16]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              <Edges color="#ef4444" threshold={15} side={DoubleSide} />
            </mesh>
          </group>
          <group ref={primaryRef}>
            <MiniLegoBrick width={3} depth={1} height={0.4} color="#2563eb" obbColor="#38bdf8" />
          </group>
        </>
      )}
    </>
  )
}

export const GuideDemoCanvas = ({
  mode,
  caption,
  badge,
  compact = false,
}: {
  mode: GuideDemoMode
  caption: string
  badge?: string
  compact?: boolean
}) => (
  <div className={`guide-canvas-demo ${compact ? 'compact' : ''}`}>
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [3.2, 2.45, 3.4], fov: 32 }}
      gl={{ antialias: true, alpha: false }}
    >
      <DemoStageContent mode={mode} />
    </Canvas>
    {(mode === 'orbit' || mode === 'pan' || mode === 'select' || mode === 'multiselect') && (
      <div className={`guide-mouse-cue mode-${mode}`} aria-hidden="true">
        <span className="mouse-body">
          <span className={`mouse-btn left ${mode === 'orbit' || mode === 'select' || mode === 'multiselect' ? 'active' : ''}`} />
          <span className={`mouse-btn right ${mode === 'pan' ? 'active' : ''}`} />
        </span>
      </div>
    )}
    {badge && <span className="guide-canvas-pill">{badge}</span>}
    <span className="guide-real-demo-badge">{caption}</span>
  </div>
)
