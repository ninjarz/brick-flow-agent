import { memo, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { DoubleSide, Vector2, type Group } from 'three'

const vertexShader = `
  varying vec2 vWorldGridPosition;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldGridPosition = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`
const fragmentShader = `
  varying vec2 vWorldGridPosition;
  uniform vec2 uCenter;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  float gridLine(vec2 coordinate, float spacing) {
    vec2 scaled = coordinate / spacing;
    vec2 width = max(fwidth(scaled), vec2(0.0001));
    vec2 distanceToLine = abs(fract(scaled - 0.5) - 0.5) / width;
    return 1.0 - min(min(distanceToLine.x, distanceToLine.y), 1.0);
  }
  void main() {
    float distanceFromCenter = length(vWorldGridPosition - uCenter);
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, distanceFromCenter);
    if (fade <= 0.001) discard;
    float pixelSize = max(fwidth(vWorldGridPosition.x), fwidth(vWorldGridPosition.y));
    float minor = gridLine(vWorldGridPosition, 1.0) * (1.0 - smoothstep(0.5, 1.5, pixelSize));
    float major = gridLine(vWorldGridPosition, 5.0) * (1.0 - smoothstep(2.5, 7.5, pixelSize));
    vec3 color = mix(vec3(0.843,0.871,0.902), vec3(0.710,0.757,0.804), minor * 0.58);
    color = mix(color, vec3(0.514,0.588,0.663), major * 0.82);
    gl_FragColor = vec4(color, (0.72 + minor * 0.12 + major * 0.13) * fade);
  }
`

/** Two triangles keep background picking available across the visible ground.
 * The world-aligned grid fades only beyond the padded scene bounds. */
export const SceneGround = memo(function SceneGround({ receiveShadow, fade, onBackgroundClick }: {
  receiveShadow: boolean
  fade: { centerX: number; centerZ: number; start: number; end: number }
  onBackgroundClick: () => boolean
}) {
  const group = useRef<Group>(null)
  const uniforms = useMemo(() => ({
    uCenter: { value: new Vector2(fade.centerX, fade.centerZ) },
    uFadeStart: { value: fade.start },
    uFadeEnd: { value: fade.end },
  }), [fade])
  useFrame(({ camera }) => {
    if (!group.current) return
    group.current.position.set(camera.position.x, 0, camera.position.z)
    group.current.scale.set(camera.far * 2 + 2, 1, camera.far * 2 + 2)
  })
  const release = (event: ThreeEvent<PointerEvent>) => {
    // The plane is also behind every brick. Only a release whose nearest hit
    // is the ground is a background gesture, regardless of click synthesis.
    if (event.button === 0 && event.intersections[0]?.object === event.object && onBackgroundClick()) event.stopPropagation()
  }
  return <group ref={group}>
    {receiveShadow && <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.02,0]} receiveShadow raycast={() => null}>
      <planeGeometry args={[1,1]} /><shadowMaterial transparent opacity={.14} depthWrite={false} />
    </mesh>}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.01,0]} onPointerUp={release}>
      <planeGeometry args={[1,1]} />
      <shaderMaterial uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader} transparent depthWrite={false} side={DoubleSide} toneMapped={false} />
    </mesh>
  </group>
})
