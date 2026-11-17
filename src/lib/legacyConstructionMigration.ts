import { Vector3 } from 'three'
import { brickById } from '../data/basicBricks'
import type { BuildPlan, BuildStep, PlacedBrick } from '../types/bricks'
import { getBrickSourceAnchor, getRigidBrickMatrix, normalizeRigidBrickPose, brickPoseFromRigidMatrix } from './rigidBrickTransform'
import { remapConstructionStep } from './constructionPlan'
import { loadVerifiedConstructionSource } from './constructionValidationCache'
import { getBrickLocalBounds, getBrickWorldBounds, transformBrickLocalBounds } from './ldrawBounds'
import { getBrickWorldSupportBounds } from './structuralGrid'

export type LegacyConstructionSource = {
  bricks: PlacedBrick[]
  steps: Pick<BuildStep, 'brickIds' | 'instructionStep'>[]
  components: string[][]
}

const normalizedBrick = (brick: PlacedBrick): PlacedBrick => {
  const definition = brickById.get(brick.brickId)!
  return { ...brick, pose: normalizeRigidBrickPose(definition, brick.pose, getBrickSourceAnchor(definition)) }
}

/** Recognize an old introduction block and verify every rigid component before changing it. */
export const migrateLegacyConstructionInstances = (plan: BuildPlan, reference: BuildPlan, legacy: LegacyConstructionSource): BuildPlan => {
  if (!legacy.steps.length || !reference.constructionAssemblies) return plan
  const rawById = new Map(legacy.bricks.map(brick => [brick.id, brick]))
  const oldById = new Map(legacy.bricks.map(brick => [brick.id, normalizedBrick(brick)]))
  const newById = new Map(reference.bricks.map(brick => [brick.id, brick]))
  const currentById = new Map(plan.bricks.map(brick => [brick.id, brick]))
  const usedIds = new Set([...plan.steps.map(step => step.id), ...Object.keys(plan.constructionAssemblies ?? {})])
  const unique = (base: string) => {
    let id = base, suffix = 1
    while (usedIds.has(id)) id = `${base}-${suffix++}`
    usedIds.add(id)
    return id
  }
  const replacements = new Map<string, PlacedBrick>()
  const assemblies = { ...plan.constructionAssemblies }
  const steps: BuildStep[] = []
  for (let offset = 0; offset < plan.steps.length;) {
    const block = plan.steps.slice(offset, offset + legacy.steps.length)
    const idMap = new Map<string, string>(), instanceIds = new Set<string>()
    let matches = block.length === legacy.steps.length
    for (let index = 0; matches && index < block.length; index++) {
      const source = legacy.steps[index], current = block[index]
      if (current.construction || current.instructionStep !== source.instructionStep || current.brickIds.length !== source.brickIds.length) { matches = false; break }
      for (let piece = 0; piece < source.brickIds.length; piece++) {
        const sourceId = source.brickIds[piece], instanceId = current.brickIds[piece]
        const old = oldById.get(sourceId), actual = currentById.get(instanceId), target = newById.get(sourceId)
        if (!old || !actual || !target || !brickById.has(actual.brickId) || actual.brickId !== old.brickId || actual.color !== old.color
          || target.brickId !== old.brickId || target.color !== old.color || idMap.has(sourceId) || instanceIds.has(instanceId)) { matches = false; break }
        idMap.set(sourceId, instanceId)
        instanceIds.add(instanceId)
      }
    }
    const moved = new Map<string, PlacedBrick>()
    if (matches && idMap.size === legacy.bricks.length) {
      try {
        for (const component of legacy.components) {
          const anchor = oldById.get(component[0])!, actualAnchor = normalizedBrick(currentById.get(idMap.get(component[0])!)!)
          const definition = brickById.get(anchor.brickId)!
          const delta = getRigidBrickMatrix(definition, actualAnchor.pose).multiply(getRigidBrickMatrix(definition, anchor.pose).invert())
          if (delta.determinant() < 0) { matches = false; break }
          const calibrated: PlacedBrick[] = [], currentNormalized: PlacedBrick[] = []
          let historicalMinimum = Infinity, storageError = 3e-6
          for (const sourceId of component) {
            const source = oldById.get(sourceId)!, current = currentById.get(idMap.get(sourceId)!)!
            const normalized = normalizedBrick(current), mould = brickById.get(source.brickId)!
            const expected = getRigidBrickMatrix(mould, source.pose).premultiply(delta).elements
            const actual = getRigidBrickMatrix(mould, normalized.pose).elements
            const magnitude = Math.max(1, ...actual.map(Math.abs))
            // Historical rigid edits rounded translations to six decimal places.
            const translationError = 3e-6 + 256 * Number.EPSILON * magnitude
            storageError = Math.max(storageError, translationError)
            if (!actual.every(Number.isFinite)
              || [0,1,2,4,5,6,8,9,10].some(index => Math.abs(actual[index] - expected[index]) > 1e-8)
              || [12,13,14].some(index => Math.abs(actual[index] - expected[index]) > translationError)) { matches = false; break }
            const target = newById.get(sourceId)!
            const matrix = getRigidBrickMatrix(mould, target.pose).premultiply(delta)
            calibrated.push({ ...current, pose: brickPoseFromRigidMatrix(mould, matrix, current.pose) })
            currentNormalized.push(normalized)
            const raw = rawById.get(sourceId)!
            const historical = { ...raw, pose: brickPoseFromRigidMatrix(mould, getRigidBrickMatrix(mould, raw.pose).premultiply(delta)) }
            historicalMinimum = Math.min(historicalMinimum,
              transformBrickLocalBounds(mould, historical.pose, getBrickLocalBounds(mould)).minY,
              getBrickWorldSupportBounds(historical)?.minY ?? Infinity,
              historical.pose.yStud)
          }
          if (!matches) break
          const localAnchor = getBrickSourceAnchor(definition)
          const beforeAnchor = localAnchor.clone().applyMatrix4(getRigidBrickMatrix(definition, actualAnchor.pose))
          const afterAnchor = localAnchor.clone().applyMatrix4(getRigidBrickMatrix(definition, calibrated[0].pose))
          const offset = new Vector3().subVectors(beforeAnchor, afterAnchor)
          const surface = Math.min(...currentNormalized.map(brick => getBrickWorldBounds(brickById.get(brick.brickId)!, brick.pose).minY))
          const targetSurface = Math.abs(historicalMinimum) <= storageError ? 0 : surface
          const calibratedSurface = Math.min(...calibrated.map(brick => getBrickWorldBounds(brickById.get(brick.brickId)!, brick.pose).minY)) + offset.y
          offset.y += targetSurface - calibratedSurface
          for (const brick of calibrated) moved.set(brick.id, { ...brick, pose: { ...brick.pose,
            xStud: brick.pose.xStud + offset.x, yStud: brick.pose.yStud + offset.y, zStud: brick.pose.zStud + offset.z } })
        }
      } catch { matches = false }
    } else matches = false
    if (!matches || moved.size !== legacy.bricks.length) { steps.push(plan.steps[offset++]); continue }
    const prefix = block[0].id
    const assemblyIds = new Map(Object.keys(reference.constructionAssemblies).map(id => [id, unique(`${prefix}:official:${id}`)]))
    for (const [id, assembly] of Object.entries(reference.constructionAssemblies)) assemblies[assemblyIds.get(id)!] = { brickIds: assembly.brickIds.map(brickId => idMap.get(brickId)!) }
    for (const step of reference.steps) steps.push({ ...step, id: unique(`${prefix}:official:${step.id}`), brickIds: step.brickIds.map(id => idMap.get(id)!), construction: remapConstructionStep(step.construction, idMap, assemblyIds) })
    for (const [id, brick] of moved) replacements.set(id, brick)
    offset += legacy.steps.length
  }
  return replacements.size ? { ...plan, bricks: plan.bricks.map(brick => replacements.get(brick.id) ?? brick), steps, constructionAssemblies: assemblies } : plan
}

export const upgradeLegacyHogwartsConstruction = async (plan: BuildPlan) => {
  if (!plan.steps.some(step => step.instructionStep === 819 && !step.construction)) return plan
  const source = await loadVerifiedConstructionSource()
  return source?.cache.legacy ? migrateLegacyConstructionInstances(plan, source.plan, source.cache.legacy) : plan
}
