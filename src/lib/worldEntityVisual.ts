import { BufferAttribute, BufferGeometry, CircleGeometry, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3 } from 'three'
import { getMinifigurePrint } from './minifigurePrints'
import { loadLDrawPartGeometry } from './ldrawVisualGeometry'

const moulds = new Map<string, BufferGeometry>()
let loading: Promise<void> | undefined
const templates = new Map<string, Group>()
const parts = ['3626c', '973', '3815b', '3816c', '3817c', '3818', '3819', '3820', '21269', '64807', '95225', '50231c01']

export const loadMinifigureMoulds = () => {
  loading ??= Promise.all(parts.map(async part => {
    const geometry = await loadLDrawPartGeometry(part, { widthStuds: 0, heightStuds: 0, depthStuds: 0 })
    if (!geometry) throw new Error(`Missing minifigure mould ${part}`)
    // Own the centred copy. The shared LDraw geometry retains its original frame.
    const centered = geometry.clone()
    centered.computeBoundingBox()
    const center = centered.boundingBox!.getCenter(new Vector3())
    centered.translate(-center.x, -center.y, -center.z)
    moulds.set(part, centered)
  })).then(() => {}).catch(error => { loading = undefined; throw error })
  return loading
}

/** Shared mould geometry and materials, independent articulated groups per actor. */
export const createWorldEntityVisual = (definitionId: string, factionId = 'blue', ghost = false) => {
  if (definitionId !== 'catapult' && moulds.size !== parts.length) throw new Error('Minifigure moulds are not ready')
  const key = `${definitionId}:${factionId}:${ghost}`
  const cached = templates.get(key)
  if (cached) return cached.clone(true)
  const root = new Group()
  const materials = new Map<string, MeshStandardMaterial>()
  const material = (color: string) => {
    let value = materials.get(color)
    if (!value) {
      value = new MeshStandardMaterial({ color: ghost ? '#22d3ee' : color, roughness: .32, metalness: .02, transparent: ghost, opacity: ghost ? .38 : 1, depthWrite: !ghost })
      materials.set(color, value)
    }
    return value
  }
  const add = (parent: Group, geometry: BufferGeometry, color: string, x: number, y: number, z: number) => {
    const mesh = new Mesh(geometry, material(color))
    mesh.position.set(x, y, z)
    mesh.castShadow = !ghost
    parent.add(mesh)
    return mesh
  }
  if (definitionId === 'catapult') {
    for (const x of [-1.45, 1.45]) for (const z of [-1.7, 1.7]) {
      add(root, new CylinderGeometry(.72, .72, .42, 16), '#334155', x, .82, z).rotation.z = Math.PI / 2
    }
    const faction = factionId === 'red' ? '#b91c1c' : factionId === 'blue' ? '#1d4ed8' : '#92400e'
    add(root, new BoxGeometry(3.2, .72, 4.7), faction, 0, 1.15, 0)
    add(root, new BoxGeometry(.42, .42, 4.3), '#78350f', 0, 2.25, -.2).rotation.x = -.7
    add(root, new SphereGeometry(.58, 14, 14), '#64748b', 0, 3.5, 1.25)
    templates.set(key, root)
    return root.clone(true)
  }
  const native = (parent: Group, part: string, color: string, x: number, y: number, z = 0) => {
    const mesh = add(parent, moulds.get(part)!, color, x, y, z)
    mesh.rotation.y = Math.PI // LDraw minifigures face -Z; actors move toward +Z.
    return mesh
  }
  const archer = definitionId === 'archer'
  const priest = definitionId === 'priest'
  const faction = factionId === 'red' ? '#b52b24' : factionId === 'blue' ? '#245aa5' : '#536357'
  const shirt = priest ? '#e7ddc1' : archer ? '#345745' : '#6b2330'
  const trousers = archer ? '#55402d' : '#293443'
  for (const [side, x, part] of [['left', -.45, '3817c'], ['right', .45, '3816c']] as const) {
    const leg = new Group()
    leg.name = `${side}-leg`
    leg.position.set(x, 1.65, 0)
    root.add(leg)
    native(leg, part, trousers, 0, -1.65 + 1.8375 / 2)
  }
  native(root, '3815b', trousers, 0, 2.15)
  native(root, '973', shirt, 0, 2.9)
  native(root, '3626c', '#efc59c', 0, 4.1)
  if (!ghost) {
    const torso = new BufferGeometry()
    torso.setAttribute('position', new BufferAttribute(new Float32Array([
      -.95, 1.8, .507, .95, 1.8, .507, .7, 3.4, .507,
      -.95, 1.8, .507, .7, 3.4, .507, -.7, 3.4, .507,
    ]), 3))
    torso.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2))
    torso.computeVertexNormals()
    for (const [surface, geometry, y] of [
      ['torso', torso, 0],
      ['face', new CylinderGeometry(.652, .652, .91, 40, 1, true, -.95, 1.9), 4.12],
    ] as const) {
      const map = getMinifigurePrint(definitionId, surface, faction)
      if (!map) continue
      const print = new Mesh(geometry, new MeshStandardMaterial({ map, transparent: true, alphaTest: .02, roughness: .42, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))
      print.position.y = y
      root.add(print)
    }
  }
  const hair = archer ? '64807' : priest ? '95225' : '21269'
  const hairGeometry = moulds.get(hair)!
  hairGeometry.computeBoundingBox()
  const hairHeight = hairGeometry.boundingBox!.max.y - hairGeometry.boundingBox!.min.y
  native(root, hair, archer ? '#83472b' : priest ? '#d1ccc0' : '#47332b', 0, 5.08 - hairHeight / 2, -.025)
  const capeGeometry = moulds.get('50231c01')!
  capeGeometry.computeBoundingBox()
  const capeSize = capeGeometry.boundingBox!.getSize(new Vector3())
  const cape = native(root, '50231c01', priest ? '#243952' : archer ? '#344f42' : '#57212b', 0, 2.2, -.48)
  cape.scale.set(2.45 / capeSize.x, 2.55 / capeSize.y, 1)
  for (const [side, x, part] of [['left', -1.11, '3819'], ['right', 1.11, '3818']] as const) {
    const arm = new Group()
    arm.name = `${side}-arm`
    arm.position.set(x, 3.2, 0)
    root.add(arm)
    native(arm, part, shirt, 0, -.55)
    native(arm, '3820', '#efc59c', 0, -1.22, .25)
    if (side === 'right') {
      if (archer) {
        const bow = add(arm, new TorusGeometry(.68, .065, 6, 20, Math.PI), '#704325', .08, -1.1, .8)
        bow.rotation.y = Math.PI / 2
        add(arm, new CylinderGeometry(.014, .014, 1.36, 5), '#e6d6b0', .08, -1.1, .8)
      } else if (priest) {
        add(arm, new CylinderGeometry(.07, .07, 3.1, 8), '#6c4025', .04, -.8, .75)
        add(arm, new SphereGeometry(.24, 10, 8), '#70c7cf', .04, .8, .75)
        add(arm, new CylinderGeometry(.17, .17, .1, 10), '#d3ad54', .04, .6, .75)
      } else {
        add(arm, new BoxGeometry(.16, 1.35, .1), '#c9d1d6', .04, -.35, .8)
        add(arm, new BoxGeometry(.58, .12, .2), '#b9a06a', .04, -1.05, .8)
        add(arm, new CylinderGeometry(.09, .09, .4, 8), '#493628', .04, -1.3, .8)
      }
    } else if (!archer && !priest) {
      const shield = add(arm, new CylinderGeometry(.64, .64, .14, 32), '#b49657', -.12, -.8, .8)
      shield.rotation.x = Math.PI / 2
      if (!ghost) {
        const map = getMinifigurePrint(definitionId, 'shield', faction)
        if (map) {
          const crest = new Mesh(new CircleGeometry(.635, 40), new MeshStandardMaterial({ map, roughness: .4 }))
          crest.position.set(-.12, -.8, .877)
          arm.add(crest)
        }
      }
    }
  }
  if (archer) {
    const quiver = add(root, new CylinderGeometry(.23, .2, 1.3, 10), '#6c4025', .65, 2.8, -.78)
    quiver.rotation.z = -.2
    for (const x of [.55, .7, .85]) {
      add(root, new CylinderGeometry(.018, .018, .75, 5), '#c8b58a', x, 3.5, -.78)
      add(root, new BoxGeometry(.09, .23, .04), '#ddd0ad', x, 3.85, -.78)
    }
  }
  templates.set(key, root)
  return root.clone(true)
}
