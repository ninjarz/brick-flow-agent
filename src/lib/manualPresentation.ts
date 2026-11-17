import type { BuildManual, ManualLocale, ManualStepPage } from './manualSerializer'

/** Retain authored order while breaking large assembly additions into buildable-sized pages. */
export const createCumulativeManualView = (manual: BuildManual, locale: ManualLocale): BuildManual => {
  if (!manual.steps.some(step => step.construction || step.addPieces.length > 6)) return manual
  const summary = locale === 'zh-CN'
    ? '按步骤累计展示，零件位于最终装配位置'
    : 'Completed pieces shown step by step in their final assembly positions'
  const steps: ManualStepPage[] = []
  let completedPieceCount = 0
  for (const original of manual.steps) {
    const groups: ManualStepPage['addPieces'][] = []
    if (original.addPieces.length > 6) {
      const ordered = [...original.addPieces].sort((a, b) => a.pose.yStud - b.pose.yStud || a.pose.zStud - b.pose.zStud || a.pose.xStud - b.pose.xStud)
      for (const piece of ordered) {
        const group = groups.at(-1)
        if (group && group.length < 6 && Math.abs(group[0].pose.yStud - piece.pose.yStud) < 1e-6) group.push(piece)
        else groups.push([piece])
      }
    } else groups.push(original.addPieces)
    for (const [index, addPieces] of groups.entries()) {
      completedPieceCount += addPieces.length
      const split = groups.length > 1
      const constructionStep = original.constructionStep
      steps.push({
        ...original,
        stepNumber: steps.length + 1,
        title: split ? `${original.title} · ${index + 1}/${groups.length}` : original.title,
        addPieces,
        completedPieceCount,
        stepInventory: original.stepInventory.flatMap(item => {
          const quantity = addPieces.filter(piece => piece.brickId === item.brickId && piece.color === item.color).length
          return quantity ? [{ ...item, quantity }] : []
        }),
        construction: undefined,
        constructionStep: split && constructionStep ? { ...constructionStep, focusBrickIds: addPieces.map(piece => piece.instanceId) } : constructionStep,
        installationLabels: undefined,
        validation: original.construction || split ? { ...original.validation, checked: false, summary } : original.validation,
      })
    }
  }
  return { ...manual, steps, totalSteps: steps.length }
}
