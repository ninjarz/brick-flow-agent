import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useState } from 'react'
import { Box3, Group, Mesh, PerspectiveCamera, Sphere, Vector3 } from 'three'
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js'
import { disposeOwnedObjectResources } from '../lib/objectResources'
import replicas from '../data/legoReplicaManifest.json'
import './LegoReplicaGallery.css'

type Replica = (typeof replicas)[number]
type LoadedModel = { group: Group; radius: number; steps: number }

const base = `${import.meta.env.BASE_URL}lego-replicas/`
let fileMapPromise: Promise<Record<string, string>> | undefined

const loadFileMap = () => {
  fileMapPromise ??= fetch(`${base}fileMap.json`).then((response) => {
    if (!response.ok) throw new Error(`零件索引加载失败 (${response.status})`)
    return response.json() as Promise<Record<string, string>>
  }).catch((error: unknown) => { fileMapPromise = undefined; throw error })
  return fileMapPromise
}

const loadModel = async (replica: Replica): Promise<LoadedModel> => {
  const loader = new LDrawLoader()
  loader.setPartsLibraryPath(base)
  const fileMap = { ...(await loadFileMap()) }
  await loader.preloadMaterials(`${base}LDConfig.ldr`)
  const response = await fetch(`${base}models/${replica.number}-1.mpd`)
  if (!response.ok) throw new Error(`模型文件加载失败 (${response.status})`)
  // Three normalizes references but leaves embedded FILE names untouched.
  // Normalize those headers in memory so MPDs using Windows paths still resolve.
  const modelText = (await response.text()).replace(/^0 FILE (.+)$/gm, (_, name: string) => {
    const normalized = name.trim().replaceAll('\\', '/')
    fileMap[normalized] = normalized
    return `0 FILE ${normalized}`
  })
  loader.setFileMap(fileMap)
  const group = await new Promise<Group>((resolve, reject) => {
    loader.parse(modelText, resolve, reject)
  })
  group.rotation.x = Math.PI
  group.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(group)
  if (bounds.isEmpty()) { disposeOwnedObjectResources(group); throw new Error('模型没有可显示的几何体') }
  const center = bounds.getCenter(new Vector3())
  const sphere = bounds.getBoundingSphere(new Sphere())
  group.position.sub(center)
  group.updateMatrixWorld(true)
  return { group, radius: Math.max(100, sphere.radius), steps: group.userData.numBuildingSteps ?? 1 }
}

const applyStep = (group: Group, step: number) => {
  group.traverse((object) => {
    if (object !== group && object instanceof Group) {
      object.visible = (object.userData.buildingStep ?? 0) <= step
    }
  })
}

function ReplicaModel({ model, step, showEdges, focusToken }: { model: LoadedModel; step: number; showEdges: boolean; focusToken: number }) {
  const invalidate = useThree((state) => state.invalidate)
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as unknown as { target: Vector3; update: () => void } | null
  useEffect(() => {
    applyStep(model.group, step)
    model.group.traverse((object) => {
      if ('isLine' in object && object.isLine) object.visible = showEdges
    })
    invalidate()
  }, [model, step, showEdges, invalidate])
  useEffect(() => {
    if (!focusToken || !controls || !(camera instanceof PerspectiveCamera)) return
    const bounds = new Box3()
    model.group.updateMatrixWorld(true)
    model.group.traverseVisible((object) => {
      if (!(object instanceof Mesh)) return
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
      if (object.geometry.boundingBox) {
        bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld))
      }
    })
    if (bounds.isEmpty()) return
    const center = bounds.getCenter(new Vector3())
    const radius = bounds.getBoundingSphere(new Sphere()).radius
    const direction = camera.position.clone().sub(controls.target).normalize()
    controls.target.copy(center)
    camera.position.copy(center).addScaledVector(direction, Math.max(50, radius * 3.2))
    controls.update()
    invalidate()
  }, [model, focusToken, camera, controls, invalidate])
  return <primitive object={model.group} />
}

export function LegoReplicaGallery() {
  const [selected, setSelected] = useState<Replica>(replicas[1])
  const [loaded, setLoaded] = useState<LoadedModel | null>(null)
  const [error, setError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [step, setStep] = useState(0)
  const [play, setPlay] = useState(false)
  const [showEdges, setShowEdges] = useState(false)
  const [focusToken, setFocusToken] = useState(0)

  useEffect(() => {
    let active = true
    let owned: LoadedModel | undefined
    setLoaded(null)
    setError('')
    setPlay(false)
    setFocusToken(0)
    loadModel(selected).then((result) => {
      if (!active) { disposeOwnedObjectResources(result.group); return }
      owned = result
      setLoaded(result)
      setStep(result.steps - 1)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { active = false; if (owned) disposeOwnedObjectResources(owned.group) }
  }, [loadAttempt, selected])

  useEffect(() => {
    if (!play || !loaded) return
    const timer = window.setInterval(() => {
      setStep((current) => {
        if (current >= loaded.steps - 1) {
          setPlay(false)
          return current
        }
        return current + 1
      })
    }, 180)
    return () => window.clearInterval(timer)
  }, [loaded, play])

  return <div className="lego-replica-gallery">
    <div className="lego-replica-select" aria-label="复刻套装">
      {replicas.map((replica) => <button
        key={replica.number}
        className={selected.number === replica.number ? 'active' : ''}
        onClick={() => setSelected(replica)}
        type="button"
      >
        <strong>#{replica.number}</strong>
        <span>{replica.title}</span>
        <small>{replica.modelPieceCount.toLocaleString()} 个模型零件</small>
      </button>)}
    </div>
    <div className="lego-replica-detail">
      <header>
        <div>
          <h3>{selected.title}</h3>
          <p>LEGO #{selected.number} · 官方 {selected.officialPieceCount.toLocaleString()} 件 · 数字模型 {selected.modelPieceCount.toLocaleString()} 件</p>
        </div>
        <div className="lego-replica-links">
          <a href={selected.officialInstructionsUrl} target="_blank" rel="noreferrer">官方说明书 ↗</a>
          <a href={selected.modelSourceUrl} target="_blank" rel="noreferrer">LDraw 模型 ↗</a>
        </div>
      </header>
      <div className="lego-replica-canvas" data-testid="lego-replica-canvas">
        {!loaded && <div className="lego-replica-loading" role="status">{error || (selected.modelPieceCount > 2500 ? `正在组装 ${selected.modelPieceCount.toLocaleString()} 个零件的几何体，首次加载约需 30–60 秒…` : '正在加载模型和零件几何体…')}{error && <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>重试加载</button>}</div>}
        {loaded && <Canvas key={selected.number} frameloop="demand" camera={{ position: [loaded.radius * 1.55, loaded.radius * 1.05, loaded.radius * 1.55], fov: 40, near: 1, far: loaded.radius * 20 }}>
          <color attach="background" args={['#16243a']} />
          <ambientLight intensity={2.2} />
          <directionalLight position={[1, 2, 3]} intensity={2.5} />
          <ReplicaModel model={loaded} step={step} showEdges={showEdges} focusToken={focusToken} />
          <OrbitControls makeDefault minDistance={loaded.radius * .5} maxDistance={loaded.radius * 6} />
        </Canvas>}
      </div>
      {loaded && <div className="lego-replica-steps">
        <button type="button" onClick={() => { setStep(0); setPlay(false); setFocusToken((current) => current + 1) }}>起点</button>
        <button type="button" onClick={() => setPlay((current) => !current)}>{play ? '暂停' : '播放'}</button>
        <button type="button" aria-pressed={showEdges} onClick={() => setShowEdges((current) => !current)}>{showEdges ? '隐藏轮廓' : '显示轮廓'}</button>
        <button type="button" onClick={() => setFocusToken((current) => current + 1)}>聚焦当前</button>
        <input aria-label="搭建步骤" type="range" min="0" max={loaded.steps - 1} value={step} onChange={(event) => { setPlay(false); setStep(Number(event.target.value)) }} />
        <span>{step + 1} / {loaded.steps}</span>
        <button type="button" onClick={() => { setStep(loaded.steps - 1); setPlay(false); setFocusToken((current) => current + 1) }}>完成</button>
      </div>}
      <p className="lego-replica-note">数字模型由 {selected.modelAuthor} 绘制。回放依据 LDraw 子模型和步骤标记，步骤编号不对应官方 PDF 页码；官方件数与模型实例数分别列出。模型依照 CC BY 2.0、零件依照各文件标注的 CC BY 2.0 / 4.0 授权，详见 <a href={`${base}CAreadme.txt`} target="_blank" rel="noreferrer">授权说明</a>。</p>
    </div>
  </div>
}
