import { useMemo, useEffect, useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Color } from 'three'
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three-stdlib'
import { createLDrawBatchMesh, type LDrawMeshBatch, type LDrawLineBatch } from '../../lib/ldrawSceneBatches'
import { createLDrawPrintBatchMesh, type LDrawPrintBatch } from '../../lib/ldrawPrintBatches'
import { useBrickInteractionHandlers } from './useBrickInteractionHandlers'

type BrickInteractionCallbacks = Parameters<typeof useBrickInteractionHandlers>[0]

export const LDrawBatch = ({ batch, selectedId, highlightedIdSet, placementActive, onSelect, onSelectConnected, onBeginDragSelected, onConfirmPlacement, onCancelPlacement }: {
  batch: LDrawMeshBatch
  selectedId?: string
  highlightedIdSet: Set<string>
  placementActive: boolean
  onSelect: BrickInteractionCallbacks['onSelect']
  onSelectConnected?: BrickInteractionCallbacks['onSelectConnected']
  onBeginDragSelected?: BrickInteractionCallbacks['onBeginDragSelected']
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) => {
  const mesh = useMemo(() => createLDrawBatchMesh(batch), [batch])
  useEffect(() => () => { mesh.dispose(); mesh.material.dispose() }, [mesh])
  const handlers = useBrickInteractionHandlers({
    resolveBrickId: event => batch.instances[event.instanceId ?? -1]?.brick.id,
    canBeginDrag: id => id === selectedId || highlightedIdSet.has(id),
    placementActive, onSelect, onSelectConnected, onBeginDragSelected, onConfirmPlacement, onCancelPlacement,
  })
  return <primitive object={mesh} {...handlers} />
}

export const LDrawPrints = ({ batch, selectedId, highlightedIdSet, placementActive, onSelect, onSelectConnected, onBeginDragSelected, onConfirmPlacement, onCancelPlacement }: {
  batch: LDrawPrintBatch
  selectedId?: string
  highlightedIdSet: Set<string>
  placementActive: boolean
  onSelect: BrickInteractionCallbacks['onSelect']
  onSelectConnected?: BrickInteractionCallbacks['onSelectConnected']
  onBeginDragSelected?: BrickInteractionCallbacks['onBeginDragSelected']
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) => {
  const mesh = useMemo(() => createLDrawPrintBatchMesh(batch), [batch])
  useEffect(() => () => { mesh.material.dispose() }, [mesh])
  const handlers = useBrickInteractionHandlers({
    resolveBrickId: event => batch.brickIds[batch.triangleBrickIndices[event.faceIndex ?? -1]],
    canBeginDrag: id => id === selectedId || highlightedIdSet.has(id),
    placementActive, onSelect, onSelectConnected, onBeginDragSelected, onConfirmPlacement, onCancelPlacement,
  })
  return <primitive object={mesh} {...handlers} />
}

export const LDrawBatchLines = ({ batch, geometry }: { batch: LDrawLineBatch; geometry: LineSegmentsGeometry }) => {
  const size = useThree(state => state.size)
  const line = useMemo(() => {
    const material = new LineMaterial({ color: new Color(batch.color).getHex(), linewidth: 1 })
    const object = new LineSegments2(geometry, material)
    object.raycast = () => undefined
    return object
  }, [batch, geometry])
  useLayoutEffect(() => { line.material.resolution.set(size.width, size.height) }, [line, size.width, size.height])
  useEffect(() => () => { line.material.dispose() }, [line])
  return <primitive object={line} />
}
