import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'
import { createWorldEntityVisual, loadMinifigureMoulds } from '../../lib/worldEntityVisual'
import type { WorldEntity } from '../../types/world'

export const WorldEntityModel = ({ entity, ghost, paused }: { entity: WorldEntity; ghost: boolean; paused: boolean }) => {
  const [ready, setReady] = useState(false)
  const { invalidate } = useThree()
  const time = useRef(0)
  useEffect(() => {
    if (entity.definitionId === 'catapult') return
    let canceled = false
    void loadMinifigureMoulds().then(() => {
      if (!canceled) { setReady(true); invalidate() }
    }).catch(() => { /* Keep the placement silhouette if local mould loading fails. */ })
    return () => { canceled = true }
  }, [invalidate, entity.definitionId])
  const model = useMemo(() => ready || entity.definitionId === 'catapult' ? createWorldEntityVisual(entity.definitionId, entity.factionId, ghost) : undefined, [ready, entity.definitionId, entity.factionId, ghost])
  const joints = useMemo(() => model ? ['left-leg', 'right-leg', 'left-arm', 'right-arm'].map(name => model.getObjectByName(name) as Group) : [], [model])
  useFrame((_state, delta) => {
    if (!model || entity.definitionId === 'catapult' || paused || ghost) return
    time.current += Math.min(delta, .05)
    const walking = entity.health > 0 && entity.behaviorState === 'moving'
    const swing = walking ? Math.sin(time.current * 9) * .38 : 0
    joints[0].rotation.x = swing
    joints[1].rotation.x = -swing
    joints[2].rotation.x = -swing * .65
    joints[3].rotation.x = swing * .65
    if (entity.health > 0 && (entity.behaviorState === 'attacking' || entity.behaviorState === 'reviving')) joints[3].rotation.x = -.85 + Math.sin(time.current * 8) * .2
  })
  if (model) return <primitive object={model} dispose={null} />
  return <group>
    <mesh position={[0, 2.7, 0]}><boxGeometry args={[1.9, 1.8, 1]} /><meshStandardMaterial color={ghost ? '#22d3ee' : '#64748b'} transparent={ghost} opacity={ghost ? .38 : 1} depthWrite={!ghost} /></mesh>
    <mesh position={[0, 4.1, 0]}><cylinderGeometry args={[.65, .65, 1.4, 16]} /><meshStandardMaterial color={ghost ? '#22d3ee' : '#ffcd42'} transparent={ghost} opacity={ghost ? .38 : 1} depthWrite={!ghost} /></mesh>
  </group>
}
