import { useEffect, useState } from 'react'
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { BrickColor, BrickFootprint, BrickKind } from '../types/bricks'
import { brickById, colorHex } from '../data/basicBricks'
import { createRound2x2AxleBodyGeometry, createRound2x2AxleGrilleBodyGeometry } from '../lib/csgBrickGeometry'
import { createLoadedLDrawPartGeometry, loadLDrawPartGeometry } from '../lib/ldrawVisualGeometry'
import {
  createCheeseSlopeGeometry,
  createCurvedSlope1x2Geometry,
  createCurvedSlope1x2OutlineGeometry,
  createCurvedSlope3x1Geometry,
  createCurvedSlope3x1OutlineGeometry,
  createInvertedSlope45Geometry,
  createSlope45Geometry,
} from '../lib/slopeGeometries'

type BrickGlyphProps = {
  brickId?: string
  kind: BrickKind
  footprint: BrickFootprint
  color?: BrickColor
  className?: string
}

const studRadius = 0.16
const studHeight = 0.12
const previewColor = '#cbd5e1'
const edgeColor = '#475569'
const cameraPosition = new Vector3(4.8, 3.7, 5.4)
const cameraTarget = new Vector3(0, 0, 0)
const viewWidthPx = 64
const viewHeightPx = 44
const viewPaddingPx = 8
const modelRotationY = -Math.PI / 5
const imageCache = new Map<string, string>()

let sharedRenderer: WebGLRenderer | undefined

const getCacheKey = (
  kind: BrickKind,
  footprint: BrickFootprint,
  brickId?: string,
  bodyColor = previewColor,
  ldrawLoaded = false,
) =>
  `${brickId ?? kind}:${kind}:${footprint.widthStuds}x${footprint.depthStuds}x${footprint.heightStuds}:${bodyColor}:${ldrawLoaded ? 'ldraw' : 'fallback'}`

const getRenderer = () => {
  if (!sharedRenderer) {
    sharedRenderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    sharedRenderer.setClearColor(0x000000, 0)
    sharedRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    sharedRenderer.setSize(viewWidthPx, viewHeightPx, false)
  }
  return sharedRenderer
}

const getWorldCorners = (width: number, height: number, depth: number) =>
  [-width / 2, width / 2].flatMap((x) =>
    [-height / 2, height / 2].flatMap((y) =>
      [-depth / 2, depth / 2].map((z) => new Vector3(x, y, z)),
    ),
  )

const getProjectedSize = (width: number, height: number, depth: number) => {
  const forward = cameraTarget.clone().sub(cameraPosition).normalize()
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
  const up = new Vector3().crossVectors(right, forward).normalize()
  const modelRotation = new Matrix4().makeRotationY(modelRotationY)
  const projected = getWorldCorners(width, height, depth).map((corner) => {
    const rotated = corner.applyMatrix4(modelRotation)
    return {
      x: rotated.dot(right),
      y: rotated.dot(up),
    }
  })

  return {
    width: Math.max(...projected.map((point) => point.x)) - Math.min(...projected.map((point) => point.x)),
    height: Math.max(...projected.map((point) => point.y)) - Math.min(...projected.map((point) => point.y)),
  }
}

const getCameraZoom = (kind: BrickKind, footprint: BrickFootprint, brickId?: string) => {
  const width = kind === 'wheel' ? 1.2 : footprint.widthStuds + studRadius * 2
  const depth =
    brickId === 'plate-bar-end-1x2' || brickId === 'plate-clip-open-1x1'
      ? footprint.depthStuds + 0.8
      : kind === 'wheel'
        ? 1.2
        : footprint.depthStuds + studRadius * 2
  const height =
    kind === 'wheel'
      ? 1.2
      : footprint.heightStuds + (kind === 'tile' || kind === 'block' ? 0 : studHeight) + (kind === 'slope' ? 0.1 : 0)
  const projected = getProjectedSize(width, height, depth)
  const usableWidth = viewWidthPx - viewPaddingPx * 2
  const usableHeight = viewHeightPx - viewPaddingPx * 2

  return Math.min(usableWidth / projected.width, usableHeight / projected.height, 34)
}

const addEdges = (mesh: Mesh, threshold = 12) => {
  const edges = new LineSegments(
    new EdgesGeometry(mesh.geometry, threshold),
    new LineBasicMaterial({ color: edgeColor }),
  )
  mesh.add(edges)
}

const makeMesh = (
  geometry: BoxGeometry | CylinderGeometry | BufferGeometry | TorusGeometry,
  color = previewColor,
  threshold = 12,
  flatShading = false,
  showEdges = true,
) => {
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color, roughness: 0.54, flatShading }))
  if (showEdges) addEdges(mesh, threshold)
  return mesh
}

const addRound2x2AxleBody = (group: Group, color: string, height: number, grille = false) => {
  const body = new Mesh(grille ? createRound2x2AxleGrilleBodyGeometry(height) : createRound2x2AxleBodyGeometry(height), new MeshStandardMaterial({ color, roughness: 0.54 }))
  group.add(body)
  for (const x of [-0.5, 0.5]) {
    for (const z of [-0.5, 0.5]) {
      const stud = makeMesh(new CylinderGeometry(studRadius, studRadius, studHeight, 24), color, 18)
      stud.position.set(x, height / 2 + studHeight / 2, z)
      group.add(stud)
    }
  }
}

const addGroovedCone1x1Body = (group: Group, color: string, height: number) => {
  const body = makeMesh(new CylinderGeometry(0.28, 0.5, height, 40), color, 14)
  const groove = makeMesh(new TorusGeometry(0.25, 0.028, 10, 32), '#111827', 12)
  const topHole = makeMesh(new CylinderGeometry(0.16, 0.16, 0.018, 24), '#111827', 12)
  groove.rotation.x = Math.PI / 2
  groove.position.y = height / 2 - 0.12
  topHole.position.y = height / 2 + 0.006
  group.add(body, groove, topHole)
}

const addRoundEyeTileBody = (group: Group, brickId: string, height: number) => {
  const body = makeMesh(new CylinderGeometry(0.5, 0.5, height, 40), '#f8fafc', 18)
  body.position.set(0.5, height / 2, 0.5)
  group.add(body)

  if (brickId === 'tile-eye-closed-1x1') {
    const closedLine = makeMesh(new BoxGeometry(0.48, 0.018, 0.07), '#111827', 12)
    closedLine.position.set(0.5, height + 0.012, 0.52)
    group.add(closedLine)
    return
  }

  const pupilOffset = brickId === 'tile-eye-offset-1x1' || brickId === 'tile-eye-1x1' ? 0.08 : 0
  const iris = makeMesh(new CylinderGeometry(0.24, 0.24, 0.018, 28), '#1e40af', 18)
  const pupil = makeMesh(new CylinderGeometry(0.11, 0.11, 0.02, 24), '#111827', 18)
  iris.position.set(0.5 + pupilOffset, height + 0.012, 0.5)
  pupil.position.set(0.535 + pupilOffset, height + 0.026, 0.535)
  group.add(iris, pupil)
}

const addGrilleTile1x2Body = (group: Group, height: number, bodyColor: string) => {
  const body = makeMesh(new BoxGeometry(2, height, 1), bodyColor, 12)
  body.position.set(1, height / 2, 0.5)
  group.add(body)
  for (const x of [0.7, 1, 1.3]) {
    const grille = makeMesh(new BoxGeometry(0.08, 0.018, 0.74), '#64748b', 12)
    grille.position.set(x, height + 0.012, 0.5)
    group.add(grille)
  }
}

const makeSlopeGeometry = (width: number, height: number, depth: number) => {
  const geometry = new BufferGeometry()
  const x0 = width / -2
  const x1 = width / 2
  const y0 = height / -2
  const lowY = y0 + height / 3
  const y1 = height / 2
  const z0 = depth / -2
  const z1 = depth / 2
  const highFlatDepth = depth > 1 ? 1 : depth * 0.22
  const slopeZ1 = z1 - highFlatDepth
  const vertices = new Float32Array([
    x0, y0, z0, x1, y0, z1, x1, y0, z0,
    x0, y0, z0, x0, y0, z1, x1, y0, z1,
    x0, y0, z0, x1, y0, z0, x1, lowY, z0,
    x0, y0, z0, x1, lowY, z0, x0, lowY, z0,
    x0, y0, z1, x1, y1, z1, x1, y0, z1,
    x0, y0, z1, x0, y1, z1, x1, y1, z1,
    x0, y0, z0, x0, y0, z1, x0, y1, z1,
    x0, y0, z0, x0, y1, z1, x0, y1, slopeZ1,
    x0, y0, z0, x0, y1, slopeZ1, x0, lowY, z0,
    x1, y0, z0, x1, y1, z1, x1, y0, z1,
    x1, y0, z0, x1, y1, slopeZ1, x1, y1, z1,
    x1, y0, z0, x1, lowY, z0, x1, y1, slopeZ1,
    x0, lowY, z0, x1, lowY, z0, x1, y1, slopeZ1,
    x0, lowY, z0, x1, y1, slopeZ1, x0, y1, slopeZ1,
    x0, y1, slopeZ1, x1, y1, slopeZ1, x1, y1, z1,
    x0, y1, slopeZ1, x1, y1, z1, x0, y1, z1,
  ])

  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

const localBrickPosition = (
  xStud: number,
  yStud: number,
  zStud: number,
  widthStuds: number,
  heightStuds: number,
  depthStuds: number,
) => new Vector3(
  xStud - widthStuds / 2,
  yStud - heightStuds / 2,
  zStud - depthStuds / 2,
)

const buildPreviewGroup = (kind: BrickKind, footprint: BrickFootprint, brickId?: string, bodyColor = previewColor) => {
  const width = footprint.widthStuds
  const depth = footprint.depthStuds
  const height = footprint.heightStuds
  const group = new Group()
  group.rotation.y = modelRotationY

  if (kind === 'wheel') {
    const wheel = makeMesh(new CylinderGeometry(0.48, 0.48, 0.34, 36), bodyColor, 18)
    const hub = makeMesh(new CylinderGeometry(0.22, 0.22, 0.04, 28), '#eef2f7', 18)
    const wheelGroup = new Group()
    wheelGroup.rotation.z = Math.PI / 2
    hub.position.z = 0.18
    wheelGroup.add(wheel, hub)
    group.add(wheelGroup)
    return group
  }

  if (kind === 'axle') {
    const axle = makeMesh(new CylinderGeometry(0.09, 0.09, Math.max(width + 2, 3), 18), bodyColor, 12)
    axle.rotation.z = Math.PI / 2
    group.add(axle)
    return group
  }

  if (kind === 'propeller') {
    const bladeLength = Math.max(1.6, width * 0.36)
    const bladeWidth = Math.max(0.38, width * 0.11)
    const bladeThickness = Math.max(0.08, height * 0.34)
    const bladeOffset = width * 0.25

    for (let index = 0; index < 4; index += 1) {
      const angle = (index * Math.PI) / 2
      const blade = makeMesh(new BoxGeometry(bladeLength, bladeThickness, bladeWidth), bodyColor, 12)
      blade.position.set(Math.cos(angle) * bladeOffset, 0, Math.sin(angle) * bladeOffset)
      blade.rotation.y = -angle
      group.add(blade)
    }

    const hub = makeMesh(new CylinderGeometry(0.46, 0.46, height, 36), bodyColor, 18)
    const hole = makeMesh(new TorusGeometry(0.24, 0.055, 12, 32), '#64748b', 16)
    hole.rotation.x = Math.PI / 2
    hole.position.y = height / 2 + 0.012
    group.add(hub, hole)
    return group
  }

  if (brickId === 'plate-bar-end-1x2' || brickId === 'plate-clip-open-1x1') {
    const brickGroup = new Group()
    const body = makeMesh(new BoxGeometry(width, height, depth), bodyColor, 12)
    brickGroup.add(body)

    if (brickId === 'plate-bar-end-1x2') {
      const handle = makeMesh(new CylinderGeometry(0.1, 0.1, 0.72, 18), bodyColor, 14)
      handle.position.copy(localBrickPosition(1.5, height / 2, -0.35, width, height, depth))
      handle.rotation.z = Math.PI / 2
      const neck = makeMesh(new BoxGeometry(0.35, 0.16, 0.34), bodyColor, 12)
      neck.position.copy(localBrickPosition(1.22, height / 2, -0.18, width, height, depth))
      brickGroup.add(handle, neck)
    } else {
      for (const xOffset of [-0.18, 0.18]) {
        const jaw = makeMesh(new BoxGeometry(0.18, 0.18, 0.52), bodyColor, 12)
        jaw.position.copy(localBrickPosition(0.5 + xOffset, height / 2, 1.05, width, height, depth))
        brickGroup.add(jaw)
      }
      const bridge = makeMesh(new CylinderGeometry(0.12, 0.12, 0.52, 18), bodyColor, 14)
      bridge.position.copy(localBrickPosition(0.5, height / 2, 1.22, width, height, depth))
      bridge.rotation.z = Math.PI / 2
      brickGroup.add(bridge)
    }

    for (let studX = 0; studX < width; studX += 1) {
      for (let studZ = 0; studZ < depth; studZ += 1) {
        const stud = makeMesh(new CylinderGeometry(studRadius, studRadius, studHeight, 24), bodyColor, 18)
        stud.position.copy(localBrickPosition(studX + 0.5, height + studHeight / 2, studZ + 0.5, width, height, depth))
        brickGroup.add(stud)
      }
    }

    group.add(brickGroup)
    return group
  }

  if (brickId === 'brick-round-2x2-axle' || brickId === 'plate-round-2x2-axle' || brickId === 'brick-round-2x2-axle-grille' || brickId === 'cone-1x1-groove') {
    const brickGroup = new Group()
    if (brickId === 'brick-round-2x2-axle' || brickId === 'plate-round-2x2-axle' || brickId === 'brick-round-2x2-axle-grille') {
      addRound2x2AxleBody(brickGroup, bodyColor, height, brickId === 'brick-round-2x2-axle-grille')
    } else {
      addGroovedCone1x1Body(brickGroup, bodyColor, height)
    }

    group.add(brickGroup)
    return group
  }

  if (brickId === 'plate-jumper-2x2' || brickId === 'plate-jumper-1x2') {
    const brickGroup = new Group()
    brickGroup.position.set(-width / 2, -height / 2, -depth / 2)
    const body = makeMesh(new BoxGeometry(width, height, depth), bodyColor, 12)
    body.position.set(width / 2, height / 2, depth / 2)
    const stud = makeMesh(new CylinderGeometry(studRadius, studRadius, studHeight, 24), bodyColor, 18)
    stud.position.set(width / 2, height + studHeight / 2, depth / 2)
    brickGroup.add(body, stud)
    group.add(brickGroup)
    return group
  }

  if (brickId === 'tile-eye-1x1' || brickId === 'tile-eye-closed-1x1' || brickId === 'tile-eye-offset-1x1' || brickId === 'tile-eye-centered-1x1') {
    const brickGroup = new Group()
    brickGroup.position.set(-width / 2, -height / 2, -depth / 2)
    addRoundEyeTileBody(brickGroup, brickId, height)
    group.add(brickGroup)
    return group
  }

  if (brickId === 'tile-grille-1x2') {
    const brickGroup = new Group()
    brickGroup.position.set(-width / 2, -height / 2, -depth / 2)
    addGrilleTile1x2Body(brickGroup, height, bodyColor)
    group.add(brickGroup)
    return group
  }

  if (brickId === 'slope-1x2' || brickId === 'slope-cheese-1x1' || brickId === 'curved-slope-1x2' || brickId === 'slope-curved-3x1' || brickId === 'inverted-slope-1x2') {
    const brickGroup = new Group()
    brickGroup.position.set(-width / 2, -height / 2, -depth / 2)
    let geometry: BufferGeometry

    if (brickId === 'slope-cheese-1x1') {
      geometry = createCheeseSlopeGeometry(width, height, depth)
    } else if (brickId === 'curved-slope-1x2') {
      geometry = createCurvedSlope1x2Geometry(width, height, depth)
    } else if (brickId === 'slope-curved-3x1') {
      geometry = createCurvedSlope3x1Geometry(width, height, depth)
    } else if (brickId === 'inverted-slope-1x2') {
      geometry = createInvertedSlope45Geometry(width, height, depth)
    } else {
      geometry = createSlope45Geometry(width, height, depth)
    }

    const showEdges = brickId !== 'curved-slope-1x2' && brickId !== 'slope-curved-3x1'
    const body = makeMesh(geometry, bodyColor, 12, showEdges, showEdges)
    body.position.set(width / 2, height / 2, depth / 2)
    brickGroup.add(body)

    if (brickId === 'slope-1x2') {
      const stud = makeMesh(new CylinderGeometry(studRadius, studRadius, studHeight, 24), bodyColor, 18)
      stud.position.set(width - 0.5, height + studHeight / 2, depth / 2)
      brickGroup.add(stud)
    } else if (brickId === 'curved-slope-1x2') {
      const platformTopY = height - Math.min(0.4, height / 4)
      const outline = new LineSegments(
        createCurvedSlope1x2OutlineGeometry(width, height, depth),
        new LineBasicMaterial({ color: edgeColor }),
      )
      outline.position.set(width / 2, height / 2, depth / 2)
      const recess = new Mesh(
        new TorusGeometry(studRadius * 1.42, 0.011, 8, 40),
        new MeshStandardMaterial({ color: edgeColor, roughness: 0.5 }),
      )
      recess.rotation.x = Math.PI / 2
      recess.position.set(width - 0.5, platformTopY + 0.01, depth / 2)
      const stud = makeMesh(new CylinderGeometry(studRadius, studRadius, studHeight * 0.6, 24), bodyColor, 18)
      stud.position.set(width - 0.5, platformTopY + studHeight * 0.3, depth / 2)
      brickGroup.add(outline)
      brickGroup.add(recess)
      brickGroup.add(stud)
    } else if (brickId === 'slope-curved-3x1') {
      const outline = new LineSegments(
        createCurvedSlope3x1OutlineGeometry(width, height, depth),
        new LineBasicMaterial({ color: edgeColor }),
      )
      outline.position.set(width / 2, height / 2, depth / 2)
      brickGroup.add(outline)
    }

    group.add(brickGroup)
    return group
  }

  const brickGroup = new Group()
  brickGroup.position.set(-width / 2, -height / 2, -depth / 2)
  const body = makeMesh(
    kind === 'round'
      ? new CylinderGeometry(Math.min(width, depth) / 2, Math.min(width, depth) / 2, height, 32)
      : kind === 'cone'
        ? new CylinderGeometry(Math.max(0.28, Math.min(width, depth) * 0.17), Math.min(width, depth) / 2, height, 36)
      : kind === 'slope'
        ? makeSlopeGeometry(width, height, depth)
        : new BoxGeometry(width, height, depth),
    bodyColor,
    kind === 'round' ? 20 : 12,
    kind === 'slope',
  )
  body.position.set(width / 2, height / 2, depth / 2)
  brickGroup.add(body)

  if (kind === 'cone') {
    const stud = makeMesh(new CylinderGeometry(studRadius, studRadius, studHeight, 24), bodyColor, 18)
    stud.position.set(width / 2, height + studHeight / 2, depth / 2)
    brickGroup.add(stud)
  } else if (kind !== 'tile' && kind !== 'block') {
    for (let studX = 0; studX < width; studX += 1) {
      for (let studZ = 0; studZ < depth; studZ += 1) {
        if (kind === 'slope' && studZ !== depth - 1) continue
        const stud = makeMesh(new CylinderGeometry(studRadius, studRadius, studHeight, 24), bodyColor, 18)
        stud.position.set(studX + 0.5, height + studHeight / 2, studZ + 0.5)
        brickGroup.add(stud)
      }
    }
  }

  group.add(brickGroup)
  return group
}

const disposeScene = (scene: Scene) => {
  scene.traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) {
      object.geometry.dispose()
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose())
      } else {
        object.material.dispose()
      }
    }
  })
}

const renderGlyph = (
  kind: BrickKind,
  footprint: BrickFootprint,
  brickId?: string,
  bodyColor = previewColor,
  ldrawLoaded = false,
) => {
  const cacheKey = getCacheKey(kind, footprint, brickId, bodyColor, ldrawLoaded)
  const cached = imageCache.get(cacheKey)
  if (cached) return cached

  const scene = new Scene()
  const camera = new OrthographicCamera(
    viewWidthPx / -2,
    viewWidthPx / 2,
    viewHeightPx / 2,
    viewHeightPx / -2,
    0.1,
    100,
  )
  camera.position.copy(cameraPosition)
  camera.lookAt(cameraTarget)
  camera.zoom = getCameraZoom(kind, footprint, brickId)
  camera.updateProjectionMatrix()
  scene.add(new AmbientLight(0xffffff, 1.35))

  const light = new DirectionalLight(0xffffff, 2.2)
  light.position.set(3.5, 5, 4)
  scene.add(light)
  const ldrawDefinition = brickId ? brickById.get(brickId) : undefined
  const ldrawGeometry = ldrawDefinition
    ? createLoadedLDrawPartGeometry(ldrawDefinition.partNumber, ldrawDefinition.footprint)?.clone()
    : undefined

  if (ldrawLoaded && ldrawGeometry) {
    const group = new Group()
    group.rotation.y = modelRotationY
    group.add(makeMesh(ldrawGeometry, bodyColor, 12, false, true))
    scene.add(group)
  } else {
    scene.add(buildPreviewGroup(kind, footprint, brickId, bodyColor))
  }

  const renderer = getRenderer()
  renderer.clear()
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL('image/png')
  imageCache.set(cacheKey, url)
  disposeScene(scene)
  return url
}

export const BrickGlyph = ({ brickId, kind, footprint, color, className }: BrickGlyphProps) => {
  const bodyColor = color ? colorHex[color] : previewColor
  const [imageUrl, setImageUrl] = useState(() => imageCache.get(getCacheKey(kind, footprint, brickId, bodyColor)))

  useEffect(() => {
    let cancelled = false
    setImageUrl(renderGlyph(kind, footprint, brickId, bodyColor))
    const ldrawDefinition = brickId ? brickById.get(brickId) : undefined
    if (!ldrawDefinition) return () => {
      cancelled = true
    }

    loadLDrawPartGeometry(ldrawDefinition.partNumber, ldrawDefinition.footprint).then(() => {
      if (!cancelled) setImageUrl(renderGlyph(kind, footprint, brickId, bodyColor, true))
    })

    return () => {
      cancelled = true
    }
  }, [bodyColor, brickId, footprint, kind])

  return (
    <span className={className} aria-hidden="true">
      {imageUrl && <img src={imageUrl} alt="" />}
    </span>
  )
}
