export const toggleBrickSelection = (
  selectedId: string,
  selectedGroupIds: string[],
  brickId: string,
) => {
  const selectedIds = selectedGroupIds.includes(selectedId) && selectedGroupIds.length > 1
    ? selectedGroupIds
    : selectedId ? [selectedId] : []
  const alreadySelected = selectedIds.includes(brickId)
  const nextIds = alreadySelected
    ? selectedIds.filter((selectedBrickId) => selectedBrickId !== brickId)
    : [...selectedIds, brickId]
  const nextSelectedId = alreadySelected && selectedId === brickId
    ? nextIds.at(-1) ?? ''
    : alreadySelected ? selectedId : brickId

  return {
    selectedId: nextSelectedId,
    selectedGroupIds: nextIds.length > 1 ? nextIds : [],
  }
}
