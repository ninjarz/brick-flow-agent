import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Box, Boxes, Download, Eye, FileUp, Gauge, Github, Globe2, KeyRound, Link, Pause, Play, Plus, Redo2, RotateCcw, ScanLine, Settings2, Trash2, Undo2, Unlink2, X } from 'lucide-react'
import { LazyBrickGlyph } from './components/LazyBrickGlyph'
import { BrickEditorPanel } from './components/BrickEditorPanel'
import type { BrickSceneViewMode } from './components/BrickScene'
import { ControlPanel } from './components/ControlPanel'
import { brickById, brickDefinitions, getDefaultBrickColor } from './data/basicBricks'
import { findNearestOpenBrickGroupAround, rotationRepositionSearchRadiusStuds, type StationaryPlanSpatialData } from './lib/brickGroupPlacement'
import { generateBuildPlan } from './lib/localGenerator'
import { buildLlmUserPrompt, generateLlmBuildPlan, isLlmConfigComplete, llmSystemPrompt, testLlmConnection } from './lib/llmGenerator'
import { loadLlmConfig, saveLlmConfig } from './lib/llmConfig'
import { defaultFinishedAssets, hasIndexedDbFinishedAssets, isDefaultFinishedAsset, loadAllDefaultFinishedAssets, loadFinishedAssets, loadFinishedAssetsFromIndexedDb, mergeWithDefaultAssets, saveFinishedAssets } from './lib/finishedAssets'
import { formatBuildManualHtml, formatBuildManualMarkdown, serializeBuildManual } from './lib/manualSerializer'
import { getManualPageTabItems, getManualStepPage, manualStepPageSize } from './lib/manualPagination'
import { countBricks, createBrickCollisionIndex, createPlanSpatialState, duplicateBrick, findNearestOpenPoseAround, findSupportedOpenPose, getBlockingBuildPlanIssues, getBrickPlacementDiagnostics, getBrickRawOverlapScore, getConnectedBrickComponents, hasBrickCollision, isBrickAboveGround, makeBrick, repairBuildPlan, snapBrickToPlan, summarizeBuildPlanIssues, validateBuildPlan } from './lib/planUtils'
import { footprintToWorld, getBrickWorldFrame, normalizeHorizontalStud, normalizeQuarterTurns, normalizeVerticalQuarterTurns, normalizeYStud } from './lib/brickUnits'
import { useI18n } from './lib/i18n'
import type { ObjImportResult } from './lib/objImport'
import { parseImportedPlan, type ImportText } from './lib/planFileIO'
import { prepareReferenceImage } from './lib/referenceImage'
import { simplifiedBrickThreshold } from './lib/scenePerformance'
import { analyzeBuildStability } from './lib/stabilityAnalysis'
import { formatLDrawPlan, parseLDrawPlan } from './lib/ldrawPlan'
import { getEffectiveInventory, loadInventoryOverrides, saveInventoryOverrides } from './lib/userInventory'
import { clearWorkspaceDraft, hasIndexedDbWorkspaceDraft, loadWorkspaceDraft, loadWorkspaceDraftFromIndexedDb, saveWorkspaceDraft } from './lib/workspaceDraft'
import type { BuildPlan, FinishedAsset, LlmConfig, PlacedBrick } from './types/bricks'
import './App.css'

const BrickScene = lazy(() => import('./components/BrickScene').then((module) => ({ default: module.BrickScene })))
const ObjImportModal = lazy(() => import('./components/ObjImportModal').then((module) => ({ default: module.ObjImportModal })))
const StabilityLab = lazy(() => import('./components/StabilityLab').then((module) => ({ default: module.StabilityLab })))

const defaultFinishedAssetI18nKeys = new Map(
  defaultFinishedAssets
    .filter((asset) => asset.i18nKey)
    .map((asset) => [asset.id, asset.i18nKey!]),
)
const isInventoryLimited = (inventory: number) => Number.isFinite(inventory)
type LlmEngineStatus = 'incomplete' | 'untested' | 'testing' | 'connected' | 'failed'
type LocalizedFinishedAsset = {
  source: FinishedAsset
  displayTitle: string
  displayCategory: string
  displayDescription: string
  displayPrompt: string
  displayPlan: BuildPlan
}
const workspaceDraftSaveDebounceMs = 120
const sceneViewModeOrder: BrickSceneViewMode[] = ['border', 'borderless', 'xray', 'voxel']

const getNextSceneViewMode = (mode: BrickSceneViewMode) =>
  sceneViewModeOrder[(sceneViewModeOrder.indexOf(mode) + 1) % sceneViewModeOrder.length]

const localizeFinishedAsset = (
  asset: FinishedAsset,
  t: ReturnType<typeof useI18n>['t'],
): LocalizedFinishedAsset => {
  const i18nKey = asset.i18nKey ?? defaultFinishedAssetI18nKeys.get(asset.id)
  const title = i18nKey ? t(`${i18nKey}.title`) : asset.title
  const prompt = i18nKey ? t(`${i18nKey}.prompt`) : asset.plan.prompt
  return {
    source: asset,
    displayTitle: title,
    displayCategory: i18nKey ? t(`${i18nKey}.category`) : asset.category,
    displayDescription: i18nKey ? t(`${i18nKey}.description`) : asset.description,
    displayPrompt: prompt,
    displayPlan: {
      ...asset.plan,
      title,
      prompt,
    },
  }
}

const getLlmEngineStatusTone = (status: LlmEngineStatus) => {
  if (status === 'connected') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'testing') return 'pending'
  if (status === 'untested') return 'warning'
  return 'neutral'
}

const addBrickToManualStep = (
  plan: BuildPlan,
  brickId: string,
  manualStepTitle: string,
  manualStepDescription: string,
): BuildPlan => {
  const manualStep = plan.steps.find((step) => step.title === manualStepTitle)
  if (manualStep) {
    return {
      ...plan,
      steps: plan.steps.map((step) =>
        step.id === manualStep.id
          ? { ...step, brickIds: [...step.brickIds, brickId] }
          : step,
      ),
    }
  }

  return {
    ...plan,
    steps: [
      ...plan.steps,
      {
        id: `step-manual-${Date.now().toString(36)}`,
        title: manualStepTitle,
        description: manualStepDescription,
        brickIds: [brickId],
      },
    ],
  }
}

const isTypingElement = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function App() {
  const { locale, setLocale, t } = useI18n()
  const workspaceDraft = useMemo(() => loadWorkspaceDraft(), [])
  const defaultPrompt = t('prompt.default')
  const fallbackPrompt = t('prompt.fallback')
  const manualStepTitle = t('manual.manualStepTitle')
  const manualStepDescription = t('manual.manualStepDescription')
  const importText = useMemo<ImportText>(() => ({
    importedPlanTitle: t('manual.importedPlanTitle'),
    importedStepTitle: (stepNumber) => t('manual.importedStepTitle', { step: stepNumber }),
  }), [t])
  const initialPlan = useMemo(() => workspaceDraft?.plan ?? generateBuildPlan({ prompt: defaultPrompt }), [defaultPrompt, workspaceDraft?.plan])
  const [prompt, setPrompt] = useState(workspaceDraft?.prompt ?? defaultPrompt)
  const [imagePreview, setImagePreview] = useState<string>()
  const [imageName, setImageName] = useState<string>()
  const [plan, setPlanState] = useState<BuildPlan>(initialPlan)
  const [historyVersion, setHistoryVersion] = useState(0)
  const planRef = useRef<BuildPlan>(workspaceDraft?.plan ?? initialPlan)
  const planHistoryRef = useRef<{
    past: BuildPlan[]
    future: BuildPlan[]
  }>({ past: [], future: [] })
  const stationarySpatialStateCacheRef = useRef<StationaryPlanSpatialData>()
  const [selectedId, setSelectedId] = useState('')
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(() => loadLlmConfig())
  const [inventoryOverrides, setInventoryOverrides] = useState(() => loadInventoryOverrides())
  const [isTestingLlmConfig, setIsTestingLlmConfig] = useState(false)
  const [llmConfigFeedback, setLlmConfigFeedback] = useState<{
    tone: 'error' | 'warning' | 'success'
    text: string
  }>()
  const [isGenerating, setIsGenerating] = useState(false)
  const generationAbortRef = useRef<AbortController | undefined>(undefined)
  const [generationError, setGenerationError] = useState<string>()
  const [generationFeedbackTone, setGenerationFeedbackTone] = useState<'error' | 'warning'>('error')
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [isPromptPreviewOpen, setIsPromptPreviewOpen] = useState(false)
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false)
  const [isObjImportOpen, setIsObjImportOpen] = useState(false)
  const [isStabilityLabOpen, setIsStabilityLabOpen] = useState(false)
  const [isManualOpen, setIsManualOpen] = useState(false)
  const [manualPlan, setManualPlan] = useState<BuildPlan>()
  const [manualStepIndex, setManualStepIndex] = useState(0)
  const [isManualPlaying, setIsManualPlaying] = useState(false)
  const [isManualExploded, setIsManualExploded] = useState(true)
  const [manualPlaybackIntervalMs, setManualPlaybackIntervalMs] = useState(1200)
  const [manualCopyStatus, setManualCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [promptCopyStatus, setPromptCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [finishedAssets, setFinishedAssets] = useState<FinishedAsset[]>(() => loadFinishedAssets())
  const [isWorkspaceStorageHydrated, setIsWorkspaceStorageHydrated] = useState(() => !hasIndexedDbWorkspaceDraft())
  const [isAssetStorageHydrated, setIsAssetStorageHydrated] = useState(() => !hasIndexedDbFinishedAssets())
  const storageWarningShownRef = useRef(false)
  const [assetTitle, setAssetTitle] = useState('')
  const [assetCategory, setAssetCategory] = useState(() => t('asset.customCategory'))
  const [assetDescription, setAssetDescription] = useState('')
  const [assetQuery, setAssetQuery] = useState('')
  const [assetCategoryFilter, setAssetCategoryFilter] = useState('all')
  const [sceneViewMode, setSceneViewMode] = useState<BrickSceneViewMode>('border')
  const [isAutoSnapEnabled, setIsAutoSnapEnabled] = useState(false)
  const sceneStabilityAnalysis = useMemo(
    () => sceneViewMode === 'xray' ? analyzeBuildStability(plan.bricks) : undefined,
    [plan.bricks, sceneViewMode],
  )
  const defaultAssetCategoryLabels = useMemo(() => new Set(['自定义', 'Custom']), [])
  const llmConfigComplete = isLlmConfigComplete(llmConfig)
  const llmEngineStatus: LlmEngineStatus = !llmConfigComplete
    ? 'incomplete'
    : isTestingLlmConfig
      ? 'testing'
      : llmConfigFeedback?.tone === 'success'
        ? 'connected'
        : llmConfigFeedback?.tone === 'error'
          ? 'failed'
          : 'untested'
  const llmEngineStatusLabel = t(`config.status.${llmEngineStatus}`)
  const llmEngineStatusTone = getLlmEngineStatusTone(llmEngineStatus)

  const closeManual = useCallback(() => {
    setIsManualOpen(false)
    setManualPlan(undefined)
    setManualCopyStatus('idle')
    setIsManualPlaying(false)
  }, [])

  const clearGenerationFeedback = useCallback(() => {
    setGenerationError(undefined)
    setGenerationFeedbackTone('error')
  }, [])

  const setGenerationFailure = (message: string) => {
    setGenerationFeedbackTone('error')
    setGenerationError(message)
  }

  const setGenerationWarning = (message: string) => {
    setGenerationFeedbackTone('warning')
    setGenerationError(message)
  }

  useEffect(() => {
    if (!generationError) return

    const timeoutId = window.setTimeout(() => {
      clearGenerationFeedback()
    }, generationFeedbackTone === 'error' ? 5200 : 4200)

    return () => window.clearTimeout(timeoutId)
  }, [clearGenerationFeedback, generationError, generationFeedbackTone])

  const setPlan = useCallback((nextPlan: BuildPlan | ((current: BuildPlan) => BuildPlan)) => {
    const current = planRef.current
    const resolvedPlan = typeof nextPlan === 'function' ? nextPlan(current) : nextPlan
    if (resolvedPlan === current) return

    planHistoryRef.current.past = [...planHistoryRef.current.past.slice(-49), current]
    planHistoryRef.current.future = []
    planRef.current = resolvedPlan
    setPlanState(resolvedPlan)
    setHistoryVersion((version) => version + 1)
  }, [])

  const undoPlan = useCallback(() => {
    const current = planRef.current
    const previous = planHistoryRef.current.past.at(-1)
    if (!previous) return

    planHistoryRef.current.past = planHistoryRef.current.past.slice(0, -1)
    planHistoryRef.current.future = [current, ...planHistoryRef.current.future.slice(0, 49)]
    planRef.current = previous
    setSelectedId('')
    setSelectedGroupIds([])
    setPlanState(previous)
    setHistoryVersion((version) => version + 1)
  }, [])

  const redoPlan = useCallback(() => {
    const current = planRef.current
    const next = planHistoryRef.current.future[0]
    if (!next) return

    planHistoryRef.current.future = planHistoryRef.current.future.slice(1)
    planHistoryRef.current.past = [...planHistoryRef.current.past.slice(-49), current]
    planRef.current = next
    setSelectedId('')
    setSelectedGroupIds([])
    setPlanState(next)
    setHistoryVersion((version) => version + 1)
  }, [])

  const canUndo = historyVersion >= 0 && planHistoryRef.current.past.length > 0
  const canRedo = historyVersion >= 0 && planHistoryRef.current.future.length > 0

  const selectBrick = useCallback((id: string) => {
    setSelectedId(id)
    setSelectedGroupIds([])
  }, [])

  const selectConnectedGroup = useCallback((id: string) => {
    if (!id) {
      selectBrick('')
      return
    }

    const component = getConnectedBrickComponents(planRef.current.bricks).find((bricks) =>
      bricks.some((brick) => brick.id === id)
    )
    setSelectedId(id)
    setSelectedGroupIds(component?.map((brick) => brick.id) ?? [id])
  }, [selectBrick])

  const selectedBrick = useMemo(
    () => plan.bricks.find((brick) => brick.id === selectedId),
    [plan.bricks, selectedId],
  )
  const activeSelectedIds = useMemo(() => {
    if (!selectedId) return []
    const liveBrickIds = new Set(plan.bricks.map((brick) => brick.id))
    const groupIds = selectedGroupIds.includes(selectedId) ? selectedGroupIds : []
    const ids = groupIds.length > 1 ? groupIds : [selectedId]
    return ids.filter((id) => liveBrickIds.has(id))
  }, [plan.bricks, selectedGroupIds, selectedId])
  const selectedBatchCount = activeSelectedIds.length
  const getSelectedIdsForPlan = (bricks: PlacedBrick[]) => {
    if (!selectedId) return []
    const liveBrickIds = new Set(bricks.map((brick) => brick.id))
    const ids = selectedGroupIds.includes(selectedId) && selectedGroupIds.length > 1
      ? selectedGroupIds
      : [selectedId]
    return ids.filter((id) => liveBrickIds.has(id))
  }
  const brickCounts = useMemo(() => countBricks(plan), [plan])
  const usedBricks = useMemo(
    () => brickDefinitions.filter((brick) => brickCounts[brick.id]),
    [brickCounts],
  )
  const manualSourcePlan = isManualOpen ? manualPlan ?? plan : undefined
  const buildManual = useMemo(() => manualSourcePlan ? serializeBuildManual(manualSourcePlan, locale) : undefined, [locale, manualSourcePlan])
  const manualMarkdown = useMemo(() => buildManual ? formatBuildManualMarkdown(buildManual, locale) : '', [buildManual, locale])
  const manualIssues = useMemo(() => manualSourcePlan ? validateBuildPlan(manualSourcePlan) : [], [manualSourcePlan])
  const manualBlockingIssues = useMemo(() => getBlockingBuildPlanIssues(manualIssues), [manualIssues])
  const manualIssueSummary = useMemo(() => summarizeBuildPlanIssues(manualIssues, locale), [locale, manualIssues])
  const selectedManualStep = buildManual?.steps[Math.min(manualStepIndex, Math.max(0, buildManual.steps.length - 1))]
  const manualStepPage = getManualStepPage(buildManual?.steps.length ?? 0, manualStepIndex)
  const visibleManualSteps = buildManual?.steps.slice(manualStepPage.start, manualStepPage.end) ?? []
  const manualPageTabItems = getManualPageTabItems(buildManual?.steps.length ?? 0, manualStepIndex)
  const manualPreviewBricks = useMemo(() => {
    if (!manualSourcePlan || !buildManual || !selectedManualStep) return []
    const cumulativeIds = new Set(
      buildManual.steps
        .slice(0, manualStepIndex + 1)
        .flatMap((step) => step.addPieces.map((piece) => piece.instanceId)),
    )
    return manualSourcePlan.bricks.filter((brick) => cumulativeIds.has(brick.id))
  }, [buildManual, manualSourcePlan, manualStepIndex, selectedManualStep])
  const manualDisplayBricks = useMemo(() => {
    if (!isManualExploded || !selectedManualStep) return manualPreviewBricks
    const guideByBrickId = new Map(selectedManualStep.addPieces.map((piece) => [piece.instanceId, piece.assembly]))
    return manualPreviewBricks.map((brick) => {
      const guide = guideByBrickId.get(brick.id)
      if (!guide) return brick
      return {
        ...brick,
        pose: {
          ...brick.pose,
          xStud: brick.pose.xStud + guide.explodedOffset.xStud,
          yStud: brick.pose.yStud + guide.explodedOffset.yStud,
          zStud: brick.pose.zStud + guide.explodedOffset.zStud,
        },
      }
    })
  }, [isManualExploded, manualPreviewBricks, selectedManualStep])
  const localizedFinishedAssets = useMemo(
    () => finishedAssets.map((asset) => localizeFinishedAsset(asset, t)),
    [finishedAssets, t],
  )
  const assetCategories = useMemo(
    () => [
      { value: 'all', label: t('common.all') },
      ...Array.from(new Set(localizedFinishedAssets.map((asset) => asset.displayCategory))).sort().map((category) => ({
        value: category,
        label: category,
      })),
    ],
    [localizedFinishedAssets, t],
  )
  const visibleFinishedAssets = useMemo(() => {
    const query = assetQuery.trim().toLowerCase()

    return localizedFinishedAssets.filter((asset) => {
      const matchesCategory = assetCategoryFilter === 'all' || asset.displayCategory === assetCategoryFilter
      const matchesQuery = !query || [
        asset.displayTitle,
        asset.displayCategory,
        asset.displayDescription,
        asset.displayPrompt,
      ].some((value) => value.toLowerCase().includes(query))

      return matchesCategory && matchesQuery
    })
  }, [assetCategoryFilter, assetQuery, localizedFinishedAssets])
  const llmPromptPreview = useMemo(
    () => buildLlmUserPrompt({ prompt: prompt.trim() || fallbackPrompt, imageName, inventoryOverrides }),
    [fallbackPrompt, imageName, inventoryOverrides, prompt],
  )

  useEffect(() => {
    saveLlmConfig(llmConfig)
  }, [llmConfig])

  useEffect(() => {
    saveInventoryOverrides(inventoryOverrides)
  }, [inventoryOverrides])

  useEffect(() => {
    let isCanceled = false

    loadAllDefaultFinishedAssets().then((defaultAssets) => {
      if (isCanceled) return
      setFinishedAssets((current) => mergeWithDefaultAssets(current, defaultAssets))
    })

    return () => {
      isCanceled = true
    }
  }, [])

  useEffect(() => {
    if (isWorkspaceStorageHydrated) return
    let isCanceled = false

    loadWorkspaceDraftFromIndexedDb().then((storedDraft) => {
      if (isCanceled) return
      if (storedDraft && planRef.current === initialPlan && planHistoryRef.current.past.length === 0) {
        planRef.current = storedDraft.plan
        setPlanState(storedDraft.plan)
        setPrompt(storedDraft.prompt)
      }
      setIsWorkspaceStorageHydrated(true)
    })

    return () => {
      isCanceled = true
    }
  }, [initialPlan, isWorkspaceStorageHydrated])

  useEffect(() => {
    if (isAssetStorageHydrated) return
    let isCanceled = false

    loadFinishedAssetsFromIndexedDb().then((storedAssets) => {
      if (isCanceled) return
      if (storedAssets) setFinishedAssets((current) => mergeWithDefaultAssets(storedAssets, current.filter(isDefaultFinishedAsset)))
      setIsAssetStorageHydrated(true)
    })

    return () => {
      isCanceled = true
    }
  }, [isAssetStorageHydrated])

  useEffect(() => {
    setAssetCategory((current) => defaultAssetCategoryLabels.has(current) ? t('asset.customCategory') : current)
  }, [defaultAssetCategoryLabels, t])

  useEffect(() => {
    if (assetCategoryFilter === 'all') return
    if (assetCategories.some((category) => category.value === assetCategoryFilter)) return
    setAssetCategoryFilter('all')
  }, [assetCategories, assetCategoryFilter])

  useEffect(() => {
    planRef.current = plan
  }, [plan])

  useEffect(() => {
    if (!isWorkspaceStorageHydrated) return
    const timeoutId = window.setTimeout(
      () => {
        void saveWorkspaceDraft(plan, prompt).then((saved) => {
          if (saved || storageWarningShownRef.current) return
          storageWarningShownRef.current = true
          setGenerationWarning(t('error.storageUnavailable'))
        })
      },
      workspaceDraftSaveDebounceMs,
    )

    return () => window.clearTimeout(timeoutId)
  }, [isWorkspaceStorageHydrated, plan, prompt, t])

  useEffect(() => {
    setFinishedAssets((current) => {
      const validAssets = current.filter((asset) => (
        isDefaultFinishedAsset(asset) ||
        getBlockingBuildPlanIssues(validateBuildPlan(asset.plan)).length === 0
      ))

      if (validAssets.length === current.length) return current
      return validAssets
    })
  }, [])

  useEffect(() => {
    if (!isAssetStorageHydrated) return
    void saveFinishedAssets(finishedAssets).then((saved) => {
      if (saved || storageWarningShownRef.current) return
      storageWarningShownRef.current = true
      setGenerationWarning(t('error.storageUnavailable'))
    })
  }, [finishedAssets, isAssetStorageHydrated, t])

  useEffect(() => {
    if (!isManualOpen) return

    const handleManualKeyDown = (event: KeyboardEvent) => {
      if (isTypingElement(event.target)) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setIsManualPlaying(false)
        setManualStepIndex((current) => Math.max(0, current - 1))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setIsManualPlaying(false)
        setManualStepIndex((current) => Math.min((buildManual?.steps.length ?? 1) - 1, current + 1))
      }
    }

    window.addEventListener('keydown', handleManualKeyDown)
    return () => window.removeEventListener('keydown', handleManualKeyDown)
  }, [buildManual?.steps.length, isManualOpen])

  useEffect(() => {
    if (!isManualOpen || !isManualPlaying || !buildManual || buildManual.steps.length <= 1) return
    const timeoutId = window.setTimeout(() => {
      setManualStepIndex((current) => {
        if (current >= buildManual.steps.length - 1) {
          setIsManualPlaying(false)
          return current
        }
        return current + 1
      })
    }, manualPlaybackIntervalMs)
    return () => window.clearTimeout(timeoutId)
  }, [buildManual, isManualOpen, isManualPlaying, manualPlaybackIntervalMs, manualStepIndex])

  useEffect(() => {
    if (!isConfigOpen && !isPromptPreviewOpen && !isAssetLibraryOpen && !isObjImportOpen && !isManualOpen && !isStabilityLabOpen) return

    const handleModalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()

      if (isManualOpen) {
        closeManual()
      } else if (isStabilityLabOpen) {
        setIsStabilityLabOpen(false)
      } else if (isPromptPreviewOpen) {
        setIsPromptPreviewOpen(false)
        setPromptCopyStatus('idle')
      } else if (isAssetLibraryOpen) {
        setIsAssetLibraryOpen(false)
      } else if (isObjImportOpen) {
        setIsObjImportOpen(false)
      } else if (isConfigOpen) {
        setIsConfigOpen(false)
      }
    }

    window.addEventListener('keydown', handleModalEscape)
    return () => window.removeEventListener('keydown', handleModalEscape)
  }, [closeManual, isAssetLibraryOpen, isConfigOpen, isManualOpen, isObjImportOpen, isPromptPreviewOpen, isStabilityLabOpen])

  useEffect(() => {
    const handleHistoryKeyDown = (event: KeyboardEvent) => {
      if (isConfigOpen || isPromptPreviewOpen || isAssetLibraryOpen || isObjImportOpen || isManualOpen || isStabilityLabOpen) return
      if (isTypingElement(event.target)) return
      if (!event.metaKey && !event.ctrlKey) return

      const key = event.key.toLowerCase()
      if (key === 'z' && event.shiftKey) {
        event.preventDefault()
        redoPlan()
      } else if (key === 'z') {
        event.preventDefault()
        undoPlan()
      } else if (key === 'y') {
        event.preventDefault()
        redoPlan()
      }
    }

    window.addEventListener('keydown', handleHistoryKeyDown)
    return () => window.removeEventListener('keydown', handleHistoryKeyDown)
  }, [isAssetLibraryOpen, isConfigOpen, isManualOpen, isObjImportOpen, isPromptPreviewOpen, isStabilityLabOpen, redoPlan, undoPlan])



  const handleImage = async (file?: File) => {
    if (!file) {
      setImageName(undefined)
      setImagePreview(undefined)
      return
    }

    try {
      const prepared = await prepareReferenceImage(file)
      setImageName(prepared.name)
      setImagePreview(prepared.dataUrl)
      clearGenerationFeedback()
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setGenerationFailure(code === 'REFERENCE_IMAGE_SIZE'
        ? t('error.referenceImageSize')
        : code === 'REFERENCE_IMAGE_TYPE'
          ? t('error.referenceImageType')
          : t('error.referenceImageRead'))
    }
  }

  const handleImportPlan = (file?: File) => {
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const isLDrawFile = /\.(?:ldr|mpd)$/i.test(file.name)
      try {
        const text = String(reader.result)
        const ldrawResult = isLDrawFile
          ? parseLDrawPlan(text, file.name.replace(/\.(?:ldr|mpd)$/i, ''))
          : undefined
        const importedPlan = isLDrawFile
          ? ldrawResult?.plan
          : parseImportedPlan(JSON.parse(text) as unknown, importText)
        if (!importedPlan) {
          setGenerationFailure(t(isLDrawFile ? 'error.importLDrawInvalid' : 'error.importInvalid'))
          return
        }

        const issues = validateBuildPlan(importedPlan)
        const blockingIssues = getBlockingBuildPlanIssues(issues)
        if (blockingIssues.length > 0) {
          setGenerationFailure(t('error.importIssues', { summary: summarizeBuildPlanIssues(issues, locale) }))
          return
        }

        setPlan(importedPlan)
        setPrompt(importedPlan.prompt)
        selectBrick('')
        clearGenerationFeedback()
        const warnings = [
          issues.length > 0 ? summarizeBuildPlanIssues(issues, locale) : '',
          ldrawResult && ldrawResult.ignoredParts > 0
            ? t('error.importLDrawIgnored', {
                count: ldrawResult.ignoredParts,
                parts: ldrawResult.unknownPartNumbers.slice(0, 6).join(', ') || '-',
              })
            : '',
        ].filter(Boolean)
        if (warnings.length > 0) {
          setGenerationWarning(warnings.join('；'))
        }
      } catch {
        setGenerationFailure(t(isLDrawFile ? 'error.importLDrawInvalid' : 'error.importParse'))
      }
    }
    reader.readAsText(file)
  }

  const resetWorkspace = () => {
    if (!window.confirm(t('error.resetConfirm'))) return

    void clearWorkspaceDraft()
    setPlan(generateBuildPlan({ prompt: defaultPrompt }))
    setPrompt(defaultPrompt)
    selectBrick('')
    setImageName(undefined)
    setImagePreview(undefined)
    clearGenerationFeedback()
  }

  const handleGenerate = async () => {
    const input = {
      prompt: prompt.trim() || fallbackPrompt,
      imageName,
      imageDataUrl: imagePreview,
      inventoryOverrides,
    }

    clearGenerationFeedback()

    if (!llmConfigComplete) {
      setIsConfigOpen(true)
      setGenerationFailure(t('error.needLlmConfig'))
      return
    }

    setIsGenerating(true)
    const generationController = new AbortController()
    generationAbortRef.current = generationController

    try {
      const validateCandidate = (candidate: BuildPlan) => {
        const issues = validateBuildPlan(candidate)
        if (getBlockingBuildPlanIssues(issues).length === 0) {
          return { plan: candidate, issues, repairedLocally: false }
        }

        const repairedPlan = repairBuildPlan(candidate)
        const repairIssues = validateBuildPlan(repairedPlan)
        return {
          plan: repairedPlan.bricks.length > 0 && getBlockingBuildPlanIssues(repairIssues).length === 0
            ? repairedPlan
            : undefined,
          issues,
          repairedLocally: true,
        }
      }

      const initialPlan = await generateLlmBuildPlan({ ...input, config: llmConfig, signal: generationController.signal, locale })
      const initialResult = validateCandidate(initialPlan)
      if (initialResult.plan) {
        setPlan(initialResult.plan)
        selectBrick('')
        if (initialResult.repairedLocally) {
          setGenerationWarning(t('error.generationRepaired', { summary: summarizeBuildPlanIssues(initialResult.issues, locale) }))
        } else if (initialResult.issues.length > 0) {
          setGenerationWarning(summarizeBuildPlanIssues(initialResult.issues, locale))
        }
        return
      }

      const initialSummary = summarizeBuildPlanIssues(initialResult.issues, locale)
      if (!llmConfig.autoRepair) {
        setGenerationFailure(t('error.generationBlocked', { summary: initialSummary }))
        return
      }

      const retryPlan = await generateLlmBuildPlan({
        ...input,
        config: llmConfig,
        signal: generationController.signal,
        locale,
        repairFeedback: initialSummary,
        previousPlan: initialPlan,
      })
      const retryResult = validateCandidate(retryPlan)
      if (!retryResult.plan) {
        setGenerationFailure(t('error.generationBlocked', {
          summary: summarizeBuildPlanIssues(retryResult.issues, locale),
        }))
        return
      }

      setPlan(retryResult.plan)
      selectBrick('')
      setGenerationWarning(t('error.generationRetried', { summary: initialSummary }))
    } catch (error) {
      setGenerationFailure(error instanceof Error ? error.message : t('error.generationFailed'))
    } finally {
      if (generationAbortRef.current === generationController) {
        generationAbortRef.current = undefined
      }
      setIsGenerating(false)
    }
  }

  const cancelGenerate = () => {
    generationAbortRef.current?.abort()
  }

  const handleTestLlmConfig = async () => {
    setLlmConfigFeedback(undefined)

    if (!llmConfigComplete) {
      setLlmConfigFeedback({ tone: 'error', text: t('config.incomplete') })
      return
    }

    setIsTestingLlmConfig(true)

    try {
      await testLlmConnection(llmConfig, locale)
      setLlmConfigFeedback({ tone: 'success', text: t('config.success') })
    } catch (error) {
      setLlmConfigFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : t('config.failed'),
      })
    } finally {
      setIsTestingLlmConfig(false)
    }
  }

  const getStationarySpatialState = useCallback((bricks: PlacedBrick[], excludedIds: Set<string>) => {
    const excludedKey = [...excludedIds].sort().join('|')
    const cached = stationarySpatialStateCacheRef.current

    if (cached?.excludedKey === excludedKey) {
      let stationaryIndex = 0
      let matches = true

      for (const brick of bricks) {
        if (excludedIds.has(brick.id)) continue
        if (cached.stationaryBricks[stationaryIndex] !== brick) {
          matches = false
          break
        }
        stationaryIndex += 1
      }

      if (matches && stationaryIndex === cached.stationaryBricks.length) {
        return cached
      }
    }

    const stationaryBricks = bricks.filter((brick) => !excludedIds.has(brick.id))
    const nextCache = {
      excludedKey,
      stationaryBricks,
      spatialState: createPlanSpatialState(stationaryBricks),
    }
    stationarySpatialStateCacheRef.current = nextCache
    return nextCache
  }, [])

  const canAcceptBrickPose = (
    currentBrick: PlacedBrick,
    nextBrick: PlacedBrick,
    bricks: PlacedBrick[],
    context?: Record<string, unknown>,
    stationaryData?: StationaryPlanSpatialData,
  ) => {
    if (!isBrickAboveGround(nextBrick)) {
      if (import.meta.env.DEV) {
        console.warn('brick-flow-agent blocked below-ground move', {
          context,
          current: currentBrick,
          attempted: nextBrick,
          attemptedDiagnostics: getBrickPlacementDiagnostics(nextBrick, bricks),
        })
      }
      return false
    }

    const collisionData = stationaryData ?? getStationarySpatialState(bricks, new Set([currentBrick.id]))
    const currentOverlapScore = getBrickRawOverlapScore(currentBrick, collisionData.stationaryBricks, collisionData.spatialState.collisionIndex)
    const nextOverlapScore = getBrickRawOverlapScore(nextBrick, collisionData.stationaryBricks, collisionData.spatialState.collisionIndex)
    if (nextOverlapScore <= 0 || nextOverlapScore < currentOverlapScore - 0.000001) return true

    if (!hasBrickCollision(nextBrick, collisionData.stationaryBricks, collisionData.spatialState.collisionIndex)) return true

    if (import.meta.env.DEV) {
      console.warn('brick-flow-agent blocked move', {
        context,
        currentOverlapScore,
        nextOverlapScore,
        current: currentBrick,
        attempted: nextBrick,
        currentDiagnostics: getBrickPlacementDiagnostics(currentBrick, bricks),
        attemptedDiagnostics: getBrickPlacementDiagnostics(nextBrick, bricks),
      })
    }

    return false
  }

  const canAcceptBrickGroupPose = (
    nextBricks: PlacedBrick[],
    bricks: PlacedBrick[],
    context?: Record<string, unknown>,
    stationaryData?: StationaryPlanSpatialData,
  ) => {
    if (nextBricks.length === 0) return false

    const belowGroundBricks = nextBricks.filter((brick) => !isBrickAboveGround(brick))
    if (belowGroundBricks.length > 0) {
      if (import.meta.env.DEV) {
        console.warn('brick-flow-agent blocked below-ground group move', {
          context,
          attempted: nextBricks,
          belowGroundBricks,
        })
      }
      return false
    }

    const collisionData = stationaryData ?? getStationarySpatialState(bricks, new Set(nextBricks.map((brick) => brick.id)))
    const hasStationaryOverlap = nextBricks.some((brick) =>
      getBrickRawOverlapScore(brick, collisionData.stationaryBricks, collisionData.spatialState.collisionIndex) > 0
    )
    if (!hasStationaryOverlap) {
      const groupCollisionIndex = createBrickCollisionIndex(nextBricks)
      const hasGroupCollision = nextBricks.some((brick) => hasBrickCollision(brick, nextBricks, groupCollisionIndex))
      if (!hasGroupCollision) return true
    }

    const hasStationaryCollision = nextBricks.some((brick) =>
      hasBrickCollision(brick, collisionData.stationaryBricks, collisionData.spatialState.collisionIndex)
    )
    if (!hasStationaryCollision) {
      const groupCollisionIndex = createBrickCollisionIndex(nextBricks)
      const hasGroupCollision = nextBricks.some((brick) => hasBrickCollision(brick, nextBricks, groupCollisionIndex))
      if (!hasGroupCollision) return true
    }

    if (import.meta.env.DEV) {
      console.warn('brick-flow-agent blocked group move', {
        context,
        attempted: nextBricks,
      })
    }

    return false
  }

  const rotateBrickGroupHorizontally = (
    bricks: PlacedBrick[],
    pivotBrick: PlacedBrick,
    deltaQuarterTurns: number,
  ) => {
    const pivotDefinition = brickById.get(pivotBrick.brickId)
    if (!pivotDefinition) return bricks

    const pivot = getBrickWorldFrame(pivotDefinition, pivotBrick.pose)
    const turns = normalizeQuarterTurns(deltaQuarterTurns)

    return bricks.map((brick) => {
      const definition = brickById.get(brick.brickId)
      if (!definition) return brick

      const frame = getBrickWorldFrame(definition, brick.pose)
      const nextRotation = normalizeQuarterTurns(brick.pose.rotationQuarterTurns + turns)
      const nextFootprint = footprintToWorld(
        definition,
        nextRotation,
        brick.pose.verticalQuarterTurns ?? 0,
      )
      const offsetX = frame.x - pivot.x
      const offsetZ = frame.z - pivot.z
      const rotatedOffset = turns === 1
        ? { x: -offsetZ, z: offsetX }
        : turns === 2
          ? { x: -offsetX, z: -offsetZ }
          : turns === 3
            ? { x: offsetZ, z: -offsetX }
            : { x: offsetX, z: offsetZ }

      return {
        ...brick,
        pose: {
          ...brick.pose,
          xStud: normalizeHorizontalStud(pivot.x + rotatedOffset.x - nextFootprint.width / 2),
          zStud: normalizeHorizontalStud(pivot.z + rotatedOffset.z - nextFootprint.depth / 2),
          rotationQuarterTurns: nextRotation,
        },
      }
    })
  }

  const rotateBrickGroupVertically = (
    bricks: PlacedBrick[],
    pivotBrick: PlacedBrick,
    deltaQuarterTurns: number,
  ) => {
    const pivotDefinition = brickById.get(pivotBrick.brickId)
    if (!pivotDefinition) return bricks

    const pivot = getBrickWorldFrame(pivotDefinition, pivotBrick.pose)
    const turns = normalizeVerticalQuarterTurns(deltaQuarterTurns)

    return bricks.map((brick) => {
      const definition = brickById.get(brick.brickId)
      if (!definition) return brick

      const frame = getBrickWorldFrame(definition, brick.pose)
      const nextVerticalRotation = normalizeVerticalQuarterTurns(
        (brick.pose.verticalQuarterTurns ?? 0) + turns,
      )
      const nextFootprint = footprintToWorld(
        definition,
        brick.pose.rotationQuarterTurns,
        nextVerticalRotation,
      )
      const offsetY = frame.y - pivot.y
      const offsetZ = frame.z - pivot.z
      const rotatedOffset = turns === 1
        ? { y: offsetZ, z: -offsetY }
        : turns === 2
          ? { y: -offsetY, z: -offsetZ }
          : turns === 3
            ? { y: -offsetZ, z: offsetY }
            : { y: offsetY, z: offsetZ }

      return {
        ...brick,
        pose: {
          ...brick.pose,
          yStud: normalizeYStud(pivot.y + rotatedOffset.y - nextFootprint.height / 2),
          zStud: normalizeHorizontalStud(pivot.z + rotatedOffset.z - nextFootprint.depth / 2),
          verticalQuarterTurns: nextVerticalRotation,
        },
      }
    })
  }

  const updateBrick = (updated: PlacedBrick) => {
    setPlan((current) => {
      const currentBrick = current.bricks.find((brick) => brick.id === updated.id)
      if (!currentBrick) return current
      const selectionIds = getSelectedIdsForPlan(current.bricks)

      if (selectionIds.length > 1 && selectionIds.includes(updated.id)) {
        const selectionIdSet = new Set(selectionIds)
        const delta = {
          xStud: updated.pose.xStud - currentBrick.pose.xStud,
          yStud: updated.pose.yStud - currentBrick.pose.yStud,
          zStud: updated.pose.zStud - currentBrick.pose.zStud,
          rotationQuarterTurns: updated.pose.rotationQuarterTurns - currentBrick.pose.rotationQuarterTurns,
          verticalQuarterTurns: (updated.pose.verticalQuarterTurns ?? 0) - (currentBrick.pose.verticalQuarterTurns ?? 0),
        }
        const colorChanged = updated.color !== currentBrick.color
        const selectedBricks = current.bricks.filter((brick) => selectionIdSet.has(brick.id))
        const horizontallyRotatedBricks = delta.rotationQuarterTurns === 0
          ? selectedBricks
          : rotateBrickGroupHorizontally(selectedBricks, currentBrick, delta.rotationQuarterTurns)
        const verticallyRotatedBricks = delta.verticalQuarterTurns === 0
          ? horizontallyRotatedBricks
          : rotateBrickGroupVertically(horizontallyRotatedBricks, currentBrick, delta.verticalQuarterTurns)
        const nextBricks = verticallyRotatedBricks
          .map((brick) => ({
            ...brick,
            color: colorChanged && brickById.get(brick.brickId)?.colors.includes(updated.color)
              ? updated.color
              : brick.color,
            pose: {
              ...brick.pose,
              xStud: normalizeHorizontalStud(brick.pose.xStud + delta.xStud),
              yStud: normalizeYStud(brick.pose.yStud + delta.yStud),
              zStud: normalizeHorizontalStud(brick.pose.zStud + delta.zStud),
            },
          }))
        const stationaryData = getStationarySpatialState(current.bricks, selectionIdSet)
        if (!canAcceptBrickGroupPose(nextBricks, current.bricks, { action: 'updateBrickGroup' }, stationaryData)) return current
        const nextBrickById = new Map(nextBricks.map((brick) => [brick.id, brick]))

        return {
          ...current,
          bricks: current.bricks.map((brick) => nextBrickById.get(brick.id) ?? brick),
        }
      }

      const stationaryData = getStationarySpatialState(current.bricks, new Set([currentBrick.id]))
      const nextBrick = isAutoSnapEnabled
        ? snapBrickToPlan(updated, stationaryData.stationaryBricks, { previousBrick: currentBrick, spatialState: stationaryData.spatialState })
        : updated
      if (!canAcceptBrickPose(currentBrick, nextBrick, current.bricks, { action: 'updateBrick' }, stationaryData)) return current

      return {
        ...current,
        bricks: current.bricks.map((brick) => (brick.id === updated.id ? nextBrick : brick)),
      }
    })
  }

  const addBrick = (brickId: string) => {
    const definition = brickById.get(brickId)
    if (!definition) return
    const inventory = getEffectiveInventory(brickId, definition.inventory, inventoryOverrides)
    if (isInventoryLimited(inventory) && (brickCounts[brickId] ?? 0) >= inventory) {
      setGenerationFailure(t('error.inventoryLimit', { name: definition.name, inventory }))
      return
    }
    const nextBrick = makeBrick(brickId, getDefaultBrickColor(definition), 0, 0, 0)
    let placedBrick = nextBrick
    setPlan((current) => {
      const nextPlan = {
        ...current,
        bricks: [
          ...current.bricks,
          (placedBrick = findSupportedOpenPose(
            isAutoSnapEnabled ? snapBrickToPlan(nextBrick, current.bricks) : nextBrick,
            current.bricks,
            { allowGroundFallback: true, preferGroundFallback: true },
          )),
        ],
      }

      return addBrickToManualStep(nextPlan, placedBrick.id, manualStepTitle, manualStepDescription)
    })
    selectBrick(placedBrick.id)
  }

  const duplicateSelected = () => {
    if (!selectedBrick) return
    const definition = brickById.get(selectedBrick.brickId)
    const inventory = definition
      ? getEffectiveInventory(selectedBrick.brickId, definition.inventory, inventoryOverrides)
      : Number.POSITIVE_INFINITY
    if (definition && isInventoryLimited(inventory) && (brickCounts[selectedBrick.brickId] ?? 0) >= inventory) {
      setGenerationFailure(t('error.inventoryLimit', { name: definition.name, inventory }))
      return
    }
    const nextBrick = duplicateBrick(selectedBrick)
    let placedBrick = nextBrick
    setPlan((current) => {
      const nextPlan = {
        ...current,
        bricks: [
          ...current.bricks,
          (placedBrick = findSupportedOpenPose(
            isAutoSnapEnabled ? snapBrickToPlan(nextBrick, current.bricks) : nextBrick,
            current.bricks,
            { allowGroundFallback: true },
          )),
        ],
      }

      return addBrickToManualStep(nextPlan, placedBrick.id, manualStepTitle, manualStepDescription)
    })
    selectBrick(placedBrick.id)
  }

  const nudgeSelected = (delta: { xStud?: number; yStud?: number; zStud?: number }) => {
    if (!selectedId) return

    setPlan((current) => {
      const selectionIds = getSelectedIdsForPlan(current.bricks)
      const selectionIdSet = new Set(selectionIds)
      const selected = current.bricks.find((brick) => brick.id === selectedId)
      if (!selected) return current
      if (selectionIds.length > 1) {
        const nextBricks = current.bricks
          .filter((brick) => selectionIdSet.has(brick.id))
          .map((brick) => ({
            ...brick,
            pose: {
              ...brick.pose,
              xStud: normalizeHorizontalStud(brick.pose.xStud + (delta.xStud ?? 0)),
              yStud: normalizeYStud(brick.pose.yStud + (delta.yStud ?? 0)),
              zStud: normalizeHorizontalStud(brick.pose.zStud + (delta.zStud ?? 0)),
            },
          }))
        const stationaryData = getStationarySpatialState(current.bricks, selectionIdSet)
        if (!canAcceptBrickGroupPose(nextBricks, current.bricks, { action: 'nudgeSelectedGroup', delta }, stationaryData)) return current
        const nextBrickById = new Map(nextBricks.map((brick) => [brick.id, brick]))

        return {
          ...current,
          bricks: current.bricks.map((brick) => nextBrickById.get(brick.id) ?? brick),
        }
      }

      const movedBrick: PlacedBrick = {
        ...selected,
        pose: {
          ...selected.pose,
          xStud: normalizeHorizontalStud(selected.pose.xStud + (delta.xStud ?? 0)),
          yStud: normalizeYStud(selected.pose.yStud + (delta.yStud ?? 0)),
          zStud: normalizeHorizontalStud(selected.pose.zStud + (delta.zStud ?? 0)),
        },
      }
      const stationaryData = getStationarySpatialState(current.bricks, new Set([selected.id]))
      const nextBrick = isAutoSnapEnabled
        ? snapBrickToPlan(movedBrick, stationaryData.stationaryBricks, { previousBrick: selected, spatialState: stationaryData.spatialState })
        : movedBrick
      if (!canAcceptBrickPose(selected, nextBrick, current.bricks, { action: 'nudgeSelected', delta }, stationaryData)) return current

      return {
        ...current,
        bricks: current.bricks.map((brick) => (brick.id === selected.id ? nextBrick : brick)),
      }
    })
  }

  const rotateSelected = (axis: 'horizontal' | 'vertical', deltaQuarterTurns: -1 | 1) => {
    if (!selectedId) return

    setPlan((current) => {
      const selectionIds = getSelectedIdsForPlan(current.bricks)
      const selectionIdSet = new Set(selectionIds)
      const selected = current.bricks.find((brick) => brick.id === selectedId)
      if (!selected) return current
      if (selectionIds.length > 1) {
        const selectedBricks = current.bricks.filter((brick) => selectionIdSet.has(brick.id))
        const nextBricks = axis === 'horizontal'
          ? rotateBrickGroupHorizontally(selectedBricks, selected, deltaQuarterTurns)
          : rotateBrickGroupVertically(selectedBricks, selected, deltaQuarterTurns)
        const stationaryData = getStationarySpatialState(current.bricks, selectionIdSet)
        const acceptedBricks = canAcceptBrickGroupPose(nextBricks, current.bricks, { action: 'rotateSelectedGroup', axis, deltaQuarterTurns }, stationaryData)
          ? nextBricks
          : findNearestOpenBrickGroupAround(nextBricks, current.bricks, selectionIdSet, stationaryData)
        if (!acceptedBricks) return current
        const nextBrickById = new Map(acceptedBricks.map((brick) => [brick.id, brick]))

        return {
          ...current,
          bricks: current.bricks.map((brick) => nextBrickById.get(brick.id) ?? brick),
        }
      }

      const rotatedBrick: PlacedBrick = {
        ...selected,
        pose: {
          ...selected.pose,
          ...(axis === 'horizontal'
            ? {
                rotationQuarterTurns: normalizeQuarterTurns(
                  selected.pose.rotationQuarterTurns + deltaQuarterTurns,
                ),
              }
            : {
                verticalQuarterTurns: normalizeVerticalQuarterTurns(
                  (selected.pose.verticalQuarterTurns ?? 0) + deltaQuarterTurns,
                ),
            }),
        },
      }
      const stationaryData = getStationarySpatialState(current.bricks, new Set([selected.id]))
      const nextBrick = isAutoSnapEnabled
        ? snapBrickToPlan(rotatedBrick, stationaryData.stationaryBricks, { previousBrick: selected, spatialState: stationaryData.spatialState })
        : rotatedBrick
      const acceptedBrick = canAcceptBrickPose(selected, nextBrick, current.bricks, { action: 'rotateSelected', axis, deltaQuarterTurns }, stationaryData)
        ? nextBrick
        : findNearestOpenPoseAround(nextBrick, stationaryData.stationaryBricks, { radiusStuds: rotationRepositionSearchRadiusStuds })
      if (!acceptedBrick) return current

      return {
        ...current,
        bricks: current.bricks.map((brick) => (brick.id === selected.id ? acceptedBrick : brick)),
      }
    })
  }

  const deleteSelected = () => {
    if (!selectedBrick) return
    const selectionIds = activeSelectedIds.length > 0 ? activeSelectedIds : [selectedBrick.id]
    const selectionIdSet = new Set(selectionIds)
    setPlan((current) => ({
      ...current,
      bricks: current.bricks.filter((brick) => !selectionIdSet.has(brick.id)),
      steps: current.steps
        .map((step) => ({
          ...step,
          brickIds: step.brickIds.filter((brickId) => !selectionIdSet.has(brickId)),
        }))
        .filter((step) => step.brickIds.length > 0),
    }))
    selectBrick('')
  }

  const downloadJson = (filename: string, data: unknown) => {
    downloadFile(filename, JSON.stringify(data, null, 2), 'application/json')
  }

  const downloadText = (filename: string, text: string) => {
    downloadFile(filename, text, 'text/markdown')
  }

  const downloadFile = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const exportPlan = () => {
    const manual = serializeBuildManual(plan, locale)
    downloadJson(`${plan.title || 'brick-plan'}.json`, {
      schemaVersion: 5,
      exportedAt: new Date().toISOString(),
      plan,
      manual,
    })
  }

  const exportLDraw = () => {
    downloadFile(`${plan.title || 'brick-plan'}.ldr`, formatLDrawPlan(plan), 'text/plain')
  }

  const exportManual = () => {
    if (!buildManual) return
    downloadJson(`${buildManual.title || 'brick-manual'}-manual.json`, buildManual)
  }

  const exportManualMarkdown = () => {
    if (!buildManual) return
    downloadText(`${buildManual.title || 'brick-manual'}-manual.md`, manualMarkdown)
  }

  const exportManualHtml = () => {
    if (!buildManual) return
    downloadFile(`${buildManual.title || 'brick-manual'}-manual.html`, formatBuildManualHtml(buildManual, locale), 'text/html')
  }

  const formatPromptPreviewText = () => [
    '# system',
    llmSystemPrompt,
    '',
    '# user',
    llmPromptPreview,
  ].join('\n')

  const exportPromptPreview = () => {
    downloadFile('brick-flow-agent-llm-prompt.txt', formatPromptPreviewText(), 'text/plain')
  }

  const renamePlan = (title: string) => {
    setPlan((current) => current.title === title ? current : {
      ...current,
      title,
    })
  }

  const copyPromptPreview = async () => {
    try {
      await navigator.clipboard.writeText(formatPromptPreviewText())
      setPromptCopyStatus('copied')
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = formatPromptPreviewText()
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand('copy')
      textarea.remove()
      setPromptCopyStatus(copied ? 'copied' : 'failed')
    }
  }

  const copyManualMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(manualMarkdown)
      setManualCopyStatus('copied')
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = manualMarkdown
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand('copy')
      textarea.remove()
      setManualCopyStatus(copied ? 'copied' : 'failed')
    }
  }

  const loadFinishedAsset = (asset: LocalizedFinishedAsset) => {
    const issues = isDefaultFinishedAsset(asset.source) ? [] : validateBuildPlan(asset.displayPlan)
    if (getBlockingBuildPlanIssues(issues).length > 0) {
      setGenerationFailure(t('error.assetInvalid', { summary: summarizeBuildPlanIssues(issues, locale) }))
      setIsAssetLibraryOpen(false)
      return
    }

    setPlan(asset.displayPlan)
    setPrompt(asset.displayPrompt)
    selectBrick('')
    setIsAssetLibraryOpen(false)
    clearGenerationFeedback()
    if (issues.length > 0) {
      setGenerationWarning(summarizeBuildPlanIssues(issues, locale))
    }
  }

  const addFinishedAsset = () => {
    const issues = validateBuildPlan(plan)
    if (getBlockingBuildPlanIssues(issues).length > 0) {
      setGenerationFailure(t('error.saveAssetInvalid', { summary: summarizeBuildPlanIssues(issues, locale) }))
      setIsAssetLibraryOpen(false)
      return
    }

    const title = assetTitle.trim() || plan.title || t('asset.untitled')
    const snapshot = JSON.parse(JSON.stringify(plan)) as BuildPlan

    setFinishedAssets((current) => [
      {
        id: `asset-${Date.now().toString(36)}`,
        title,
        category: assetCategory.trim() || t('asset.customCategory'),
        description: assetDescription.trim() || t('asset.defaultDescription', { parts: snapshot.bricks.length, steps: snapshot.steps.length }),
        plan: snapshot,
      },
      ...current,
    ])
    setAssetTitle('')
    setAssetCategory(t('asset.customCategory'))
    setAssetDescription('')
    if (issues.length > 0) {
      setGenerationWarning(summarizeBuildPlanIssues(issues, locale))
    }
  }

  const deleteFinishedAsset = (assetId: string) => {
    setFinishedAssets((current) => current.filter((asset) => asset.id !== assetId))
  }

  const resetFinishedAssets = () => {
    setFinishedAssets(defaultFinishedAssets)
    loadAllDefaultFinishedAssets().then((defaultAssets) => {
      setFinishedAssets(defaultAssets)
    })
    setAssetQuery('')
    setAssetCategoryFilter('all')
    clearGenerationFeedback()
  }

  const importObjResult = (result: ObjImportResult, saveToLibrary: boolean) => {
    const issues = validateBuildPlan(result.plan)
    const blockingIssues = getBlockingBuildPlanIssues(issues)
    if (blockingIssues.length > 0) {
      setGenerationFailure(t('error.importIssues', { summary: summarizeBuildPlanIssues(issues, locale) }))
      return
    }

    setPlan(result.plan)
    setPrompt(result.plan.prompt)
    selectBrick('')
    clearGenerationFeedback()
    setIsObjImportOpen(false)

    if (saveToLibrary) {
      const dimensions = `${result.stats.dimensions.width}×${result.stats.dimensions.height}×${result.stats.dimensions.depth}`
      setFinishedAssets((current) => [
        {
          id: `asset-obj-${Date.now().toString(36)}`,
          title: result.plan.title,
          category: 'OBJ',
          description: t('objImport.assetDescription', {
            dimensions,
            voxels: result.stats.sourceVoxels,
            change: (result.stats.structuralChangeRatio * 100).toFixed(1),
            bricks: result.stats.brickCount,
          }),
          plan: result.plan,
        },
        ...current,
      ])
    }

    if (issues.length > 0) setGenerationWarning(summarizeBuildPlanIssues(issues, locale))
  }

  const openManual = (sourcePlan?: BuildPlan) => {
    const nextManualPlan = sourcePlan ?? plan
    const issues = validateBuildPlan(nextManualPlan)
    if (getBlockingBuildPlanIssues(issues).length > 0) {
      setGenerationFailure(t('error.manualInvalid', { summary: summarizeBuildPlanIssues(issues, locale) }))
      setIsAssetLibraryOpen(false)
      return
    }

    setManualPlan(sourcePlan)
    setManualStepIndex(0)
    setIsManualPlaying(false)
    setIsManualExploded(true)
    setManualCopyStatus('idle')
    setIsManualOpen(true)
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">brick-flow-agent</p>
            <h1>{t('app.title')}</h1>
          </div>
          <div className="engine-actions">
            <button
              className="icon-button"
              type="button"
              aria-label={t('top.undo')}
              title={t('top.undo')}
              disabled={!canUndo}
              onClick={undoPlan}
            >
              <Undo2 size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={t('top.redo')}
              title={t('top.redo')}
              disabled={!canRedo}
              onClick={redoPlan}
            >
              <Redo2 size={18} />
            </button>
            <button
              type="button"
              className={`icon-button ${sceneViewMode === 'border' ? '' : 'active'}`}
              aria-label={t('top.switchViewMode', {
                current: t(`top.viewMode.${sceneViewMode}`),
                next: t(`top.viewMode.${getNextSceneViewMode(sceneViewMode)}`),
              })}
              title={t('top.switchViewMode', {
                current: t(`top.viewMode.${sceneViewMode}`),
                next: t(`top.viewMode.${getNextSceneViewMode(sceneViewMode)}`),
              })}
              onClick={() => setSceneViewMode((mode) => getNextSceneViewMode(mode))}
            >
              {sceneViewMode === 'border'
                ? <Box size={18} />
                : sceneViewMode === 'borderless'
                  ? <Eye size={18} />
                  : sceneViewMode === 'xray'
                    ? <ScanLine size={18} />
                    : <Boxes size={18} />}
            </button>
            <button
              className={`icon-button ${isAutoSnapEnabled ? 'active' : ''}`}
              type="button"
              aria-label={isAutoSnapEnabled ? t('top.disableAutoSnap') : t('top.enableAutoSnap')}
              title={isAutoSnapEnabled ? t('top.autoSnapOn') : t('top.autoSnapOff')}
              onClick={() => setIsAutoSnapEnabled((enabled) => !enabled)}
            >
              {isAutoSnapEnabled ? <Link size={18} /> : <Unlink2 size={18} />}
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={t('top.stabilityLab')}
              title={t('top.stabilityLab')}
              onClick={() => setIsStabilityLabOpen(true)}
            >
              <Gauge size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={t('top.config')}
              title={t('top.config')}
              onClick={() => setIsConfigOpen(true)}
            >
              <Settings2 size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={t('top.importObj')}
              title={t('top.importObj')}
              onClick={() => setIsObjImportOpen(true)}
            >
              <FileUp size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={t('top.assetLibrary')}
              title={t('top.assetLibrary')}
              onClick={() => setIsAssetLibraryOpen(true)}
            >
              <BookOpen size={18} />
            </button>
            <a
              className="icon-button github-link"
              href="https://github.com/ninjarz/brick-flow-agent"
              target="_blank"
              rel="noreferrer"
              aria-label={t('top.github')}
              title={t('top.github')}
            >
              <Github size={18} />
            </a>
          </div>
        </header>

        <div className="viewer">
          {plan.bricks.length >= simplifiedBrickThreshold && sceneViewMode !== 'voxel' && (
            <div className="performance-badge">{t('scene.performanceMode')}</div>
          )}
          {sceneViewMode === 'voxel' && (
            <div className="voxel-legend" aria-label={t('voxel.legend')}>
              <span><i style={{ background: '#ef4444' }} />{t('voxel.solid')}</span>
              <span><i style={{ background: '#22d3ee' }} />{t('voxel.enterable')}</span>
              <span><i style={{ background: '#f59e0b' }} />{t('voxel.stud')}</span>
              <span><i style={{ background: '#3b82f6' }} />{t('voxel.socket')}</span>
              <span><i style={{ background: '#10b981' }} />{t('voxel.studsocket')}</span>
            </div>
          )}
          {sceneViewMode === 'xray' && sceneStabilityAnalysis && (
            <div className="xray-legend" aria-label={t('xray.legend')}>
              <strong>{t('xray.score', { score: sceneStabilityAnalysis.stabilityScore })}</strong>
              <span className="xray-risk-scale" aria-hidden="true" />
              <span>{t('xray.stable')}</span>
              <span>{t('xray.critical')}</span>
              <span className="xray-com"><i />{t('xray.centerOfMass')}</span>
            </div>
          )}
          <Suspense fallback={<div className="scene-loading">{t('scene.loading')}</div>}>
            <BrickScene
              bricks={plan.bricks}
              selectedId={selectedId}
              cameraFrameKey={plan.id}
              viewMode={sceneViewMode}
              stabilityAnalysis={sceneStabilityAnalysis}
              highlightedIds={activeSelectedIds.filter((id) => id !== selectedId)}
              onSelect={selectBrick}
              onSelectConnected={selectConnectedGroup}
              onNudgeSelected={nudgeSelected}
              onRotateSelected={rotateSelected}
              onDeleteSelected={deleteSelected}
            />
          </Suspense>
          <BrickEditorPanel
            plan={plan}
            selectedBrick={selectedBrick}
            selectedCount={selectedBatchCount}
            onUpdateBrick={updateBrick}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onClose={() => selectBrick('')}
          />
        </div>

        <section className="brick-counts" aria-label={t('counts.aria')}>
          <header>
            <h2>{t('counts.title')}</h2>
            <p>{t('common.parts', { count: plan.bricks.length })}</p>
          </header>
          <div className="brick-count-list">
            {usedBricks.map((brick) => (
              <article key={brick.id}>
                <LazyBrickGlyph
                  brickId={brick.id}
                  kind={brick.kind}
                  footprint={brick.footprint}
                  color={plan.bricks.find((placedBrick) => placedBrick.brickId === brick.id)?.color ?? getDefaultBrickColor(brick)}
                  className="count-glyph"
                />
                <div>
                  <h3>{brick.name}</h3>
                  <p>{t('counts.quantity', { count: brickCounts[brick.id] })}</p>
                </div>
              </article>
            ))}
          </div>
          {usedBricks.length === 0 && <p className="muted">{t('counts.empty')}</p>}
        </section>
      </section>

      <ControlPanel
        engineStatusLabel={t('control.engineStatus', { status: llmEngineStatusLabel })}
        engineStatusTone={llmEngineStatusTone}
        onEngineStatusClick={llmEngineStatus === 'connected' ? undefined : () => setIsConfigOpen(true)}
        prompt={prompt}
        setPrompt={setPrompt}
        isGenerating={isGenerating}
        imagePreview={imagePreview}
        imageName={imageName}
        onImage={handleImage}
        onGenerate={handleGenerate}
        onCancelGenerate={cancelGenerate}
        onOpenPromptPreview={() => {
          setPromptCopyStatus('idle')
          setIsPromptPreviewOpen(true)
        }}
        plan={plan}
        onRenamePlan={renamePlan}
        onAddBrick={addBrick}
        inventoryOverrides={inventoryOverrides}
        onInventoryChange={(brickId, inventory) => {
          setInventoryOverrides((current) => {
            const next = { ...current }
            if (inventory === undefined) delete next[brickId]
            else if (Number.isFinite(inventory)) next[brickId] = Math.max(0, Math.floor(inventory))
            return next
          })
        }}
        onResetInventory={() => setInventoryOverrides({})}
        onExport={exportPlan}
        onExportLDraw={exportLDraw}
        onImportPlan={handleImportPlan}
        onResetWorkspace={resetWorkspace}
        onOpenManual={() => openManual()}
      />

      {generationError && (
        <div className="toast-region" aria-live={generationFeedbackTone === 'error' ? 'assertive' : 'polite'}>
          <div className={`feedback-toast ${generationFeedbackTone}`} role={generationFeedbackTone === 'error' ? 'alert' : 'status'}>
            <p>{generationError}</p>
            <button
              className="icon-button"
              type="button"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={clearGenerationFeedback}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {isObjImportOpen && (
        <Suspense fallback={null}>
          <ObjImportModal
            open
            onClose={() => setIsObjImportOpen(false)}
            onImported={importObjResult}
          />
        </Suspense>
      )}

      {isStabilityLabOpen && (
        <Suspense fallback={null}>
          <StabilityLab plan={plan} onClose={() => setIsStabilityLabOpen(false)} />
        </Suspense>
      )}

      {isConfigOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsConfigOpen(false)}>
          <section
            className="config-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="config-title">{t('config.title')}</h2>
                <p>{llmEngineStatusLabel}</p>
              </div>
              <button className="icon-button" type="button" aria-label={t('common.close')} title={t('common.close')} onClick={() => setIsConfigOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="config-form">
              <section className="config-section">
                <div className="config-section-title">
                  <Globe2 size={16} />
                  <div>
                    <h3>{t('config.languageSection')}</h3>
                    <p>{t('config.languageDescription')}</p>
                  </div>
                </div>
                <div className="language-options" role="group" aria-label={t('app.language')}>
                  <button type="button" className={locale === 'zh-CN' ? 'active' : ''} onClick={() => setLocale('zh-CN')}>
                    中文
                  </button>
                  <button type="button" className={locale === 'en-US' ? 'active' : ''} onClick={() => setLocale('en-US')}>
                    English
                  </button>
                </div>
              </section>

              <section className="config-section">
                <div className="config-section-title">
                  <Settings2 size={16} />
                  <div>
                    <h3>{t('config.llmSection')}</h3>
                    <p>{llmEngineStatusLabel}</p>
                  </div>
                </div>
                <label>
                  {t('config.modelName')}
                  <input
                    value={llmConfig.modelName}
                    onChange={(event) => {
                      setLlmConfigFeedback(undefined)
                      setLlmConfig({ ...llmConfig, modelName: event.target.value })
                    }}
                    placeholder={t('config.modelPlaceholder')}
                    autoComplete="off"
                  />
                </label>
                <label>
                  {t('config.endpoint')}
                  <span className="input-with-icon">
                    <Link size={15} />
                    <input
                      value={llmConfig.endpoint}
                      onChange={(event) => {
                        setLlmConfigFeedback(undefined)
                        setLlmConfig({ ...llmConfig, endpoint: event.target.value })
                      }}
                      placeholder="https://api.example.com/v1/chat/completions"
                      type="url"
                      autoComplete="off"
                    />
                  </span>
                </label>
                <label>
                  api_key
                  <span className="input-with-icon">
                    <KeyRound size={15} />
                    <input
                      value={llmConfig.apiKey}
                      onChange={(event) => {
                        setLlmConfigFeedback(undefined)
                        setLlmConfig({ ...llmConfig, apiKey: event.target.value })
                      }}
                      placeholder="sk-..."
                      type="password"
                      autoComplete="off"
                    />
                  </span>
                </label>
                <div className="config-field">
                  <span>{t('config.requestMode')}</span>
                  <div className="request-mode-options" role="group" aria-label={t('config.requestMode')}>
                    {(['direct', 'proxy'] as const).map((requestMode) => (
                      <button
                        key={requestMode}
                        type="button"
                        className={llmConfig.requestMode === requestMode ? 'active' : ''}
                        onClick={() => {
                          setLlmConfigFeedback(undefined)
                          setLlmConfig({ ...llmConfig, requestMode })
                        }}
                      >
                        {requestMode === 'direct' ? <Globe2 size={15} /> : <Link size={15} />}
                        <span>{t(`config.requestMode.${requestMode}`)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="config-field-note">
                    {t(`config.requestModeDescription.${llmConfig.requestMode}`)}
                  </p>
                </div>
                <label className="config-toggle">
                  <input
                    type="checkbox"
                    checked={llmConfig.enableThinking}
                    onChange={(event) => {
                      setLlmConfigFeedback(undefined)
                      setLlmConfig({ ...llmConfig, enableThinking: event.target.checked })
                    }}
                  />
                  <span>
                    <strong>{t('config.thinkingMode')}</strong>
                    <small>{t(`config.thinkingModeDescription.${llmConfig.enableThinking ? 'on' : 'off'}`)}</small>
                  </span>
                </label>
                <label className="config-toggle">
                  <input
                    type="checkbox"
                    checked={llmConfig.autoRepair}
                    onChange={(event) => {
                      setLlmConfigFeedback(undefined)
                      setLlmConfig({ ...llmConfig, autoRepair: event.target.checked })
                    }}
                  />
                  <span>
                    <strong>{t('config.autoRepair')}</strong>
                    <small>{t(`config.autoRepairDescription.${llmConfig.autoRepair ? 'on' : 'off'}`)}</small>
                  </span>
                </label>
                <div className="config-actions">
                  <button type="button" className="secondary" onClick={handleTestLlmConfig} disabled={isTestingLlmConfig}>
                    {isTestingLlmConfig ? t('config.testing') : t('config.test')}
                  </button>
                  {llmConfigFeedback && (
                    <p className={`feedback-text ${llmConfigFeedback.tone}`}>{llmConfigFeedback.text}</p>
                  )}
                </div>
              </section>
            </div>
          </section>
        </div>
      )}

      {isPromptPreviewOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            setIsPromptPreviewOpen(false)
            setPromptCopyStatus('idle')
          }}
        >
          <section
            className="prompt-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-preview-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="prompt-preview-title">{t('prompt.title')}</h2>
                <p>{prompt.trim() || fallbackPrompt}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={t('common.close')}
                title={t('common.close')}
                onClick={() => {
                  setIsPromptPreviewOpen(false)
                  setPromptCopyStatus('idle')
                }}
              >
                <X size={18} />
              </button>
            </header>
            <label>
              {t('prompt.system')}
              <textarea readOnly value={llmSystemPrompt} />
            </label>
            <label>
              {t('prompt.user')}
              <textarea readOnly value={llmPromptPreview} />
            </label>
            <div className="prompt-actions">
              <button className="secondary" type="button" onClick={copyPromptPreview}>
                {promptCopyStatus === 'copied' ? t('common.copied') : promptCopyStatus === 'failed' ? t('common.copyFailed') : t('prompt.copyAll')}
              </button>
              <button className="secondary" type="button" onClick={exportPromptPreview}>
                <Download size={16} />
                {t('common.exportTxt')}
              </button>
            </div>
          </section>
        </div>
      )}

      {isAssetLibraryOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsAssetLibraryOpen(false)}>
          <section
            className="asset-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-library-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="asset-library-title">{t('asset.title')}</h2>
                <p>{t('asset.count', { visible: visibleFinishedAssets.length, total: finishedAssets.length })}</p>
              </div>
              <button className="icon-button" type="button" aria-label={t('common.close')} title={t('common.close')} onClick={() => setIsAssetLibraryOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <section className="asset-create">
              <div className="asset-create-fields">
                <input value={assetTitle} onChange={(event) => setAssetTitle(event.target.value)} placeholder={t('asset.titlePlaceholder', { title: plan.title })} />
                <input value={assetCategory} onChange={(event) => setAssetCategory(event.target.value)} placeholder={t('asset.categoryPlaceholder')} />
              </div>
              <input
                value={assetDescription}
                onChange={(event) => setAssetDescription(event.target.value)}
                placeholder={t('asset.descriptionPlaceholder')}
              />
              <button className="primary compact-primary" type="button" onClick={addFinishedAsset}>
                <Plus size={16} />
                {t('asset.saveCurrent')}
              </button>
              <button className="secondary compact-primary" type="button" onClick={resetFinishedAssets}>
                {t('asset.restoreDefault')}
              </button>
            </section>

            <section className="asset-tools">
              <input
                value={assetQuery}
                onChange={(event) => setAssetQuery(event.target.value)}
                placeholder={t('asset.searchPlaceholder')}
              />
              <div className="asset-category-tabs" aria-label={t('asset.categories')}>
                {assetCategories.map((category) => (
                  <button
                    key={category.value}
                    type="button"
                    className={category.value === assetCategoryFilter ? 'active' : ''}
                    onClick={() => setAssetCategoryFilter(category.value)}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            </section>

            <div className="asset-list">
              {visibleFinishedAssets.map((asset) => (
                <article key={asset.source.id} className="asset-card">
                  <div>
                    <span>{asset.displayCategory}</span>
                    {asset.source.instructionStatus && (
                      <span className={`asset-status ${asset.source.instructionStatus}`}>
                        {asset.source.instructionStatus === 'mapped' ? t('asset.mapped') : t('asset.inspired')}
                      </span>
                    )}
                    <h3>{asset.displayTitle}</h3>
                    <p>{asset.displayDescription}</p>
                    <small>{t('common.parts', { count: asset.displayPlan.bricks.length })} · {t('common.steps', { count: asset.displayPlan.steps.length })} · {asset.displayPrompt}</small>
                  </div>
                  <div className="asset-actions">
                    <button type="button" onClick={() => loadFinishedAsset(asset)}>
                      {t('common.load')}
                    </button>
                    <button type="button" onClick={() => openManual(asset.displayPlan)}>
                      {t('asset.manual')}
                    </button>
                    {asset.source.instructionUrl && (
                      <a className="asset-link-button" href={asset.source.instructionUrl} target="_blank" rel="noreferrer">
                        <Link size={15} />
                        {t('asset.instructions')}
                      </a>
                    )}
                    <button className="icon-button danger" type="button" aria-label={t('asset.delete')} title={t('asset.delete')} onClick={() => deleteFinishedAsset(asset.source.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
              {finishedAssets.length === 0 && <p className="muted">{t('asset.empty')}</p>}
              {finishedAssets.length > 0 && visibleFinishedAssets.length === 0 && <p className="muted">{t('asset.noMatches')}</p>}
            </div>
          </section>
        </div>
      )}

      {isManualOpen && buildManual && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            closeManual()
          }}
        >
          <section
            className="manual-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="build-manual-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="build-manual-title">{t('manual.title')}</h2>
                <p>{buildManual.title} · {t('common.parts', { count: buildManual.totalPieces })} · {t('common.pages', { count: buildManual.totalSteps })}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={t('common.close')}
                title={t('common.close')}
                onClick={() => {
                  closeManual()
                }}
              >
                <X size={18} />
              </button>
            </header>

            <section className="manual-inventory">
              <h3>{t('manual.inventory')}</h3>
              <p className={`structure-status ${manualIssues.length > 0 ? (manualBlockingIssues.length > 0 ? 'warn' : 'notice') : 'ok'}`}>
                {manualIssues.length > 0 ? manualIssueSummary : t('common.structureOk')}
              </p>
              <div>
                {buildManual.inventory.map((item) => (
                  <span key={item.key}>
                    {item.name} · {item.color} × {item.quantity}
                  </span>
                ))}
              </div>
            </section>

            {selectedManualStep && (
              <section className="manual-preview">
                <div>
                  <h3>{t('manual.pageTitle', { page: selectedManualStep.stepNumber, title: selectedManualStep.title })}</h3>
                  <p>{selectedManualStep.description}</p>
                  <p className={`structure-status ${selectedManualStep.validation.ok ? (selectedManualStep.validation.issueCount > 0 ? 'notice' : 'ok') : 'warn'}`}>
                    {selectedManualStep.validation.summary}
                  </p>
                </div>
                <div className="manual-timeline">
                  <div className="manual-timeline-actions">
                    <button
                      type="button"
                      onClick={() => {
                        if (!isManualPlaying && manualStepIndex >= buildManual.steps.length - 1) setManualStepIndex(0)
                        setIsManualPlaying((playing) => !playing)
                      }}
                    >
                      {isManualPlaying ? <Pause size={15} /> : <Play size={15} />}
                      {t(isManualPlaying ? 'manual.pauseTimeline' : 'manual.playTimeline')}
                    </button>
                    <button type="button" onClick={() => { setIsManualPlaying(false); setManualStepIndex(0) }}>
                      <RotateCcw size={15} />
                      {t('manual.restartTimeline')}
                    </button>
                    <label>
                      <input type="checkbox" checked={isManualExploded} onChange={(event) => setIsManualExploded(event.target.checked)} />
                      {t('manual.explodedView')}
                    </label>
                    <select value={manualPlaybackIntervalMs} onChange={(event) => setManualPlaybackIntervalMs(Number(event.target.value))} aria-label={t('manual.playbackSpeed')}>
                      <option value={2000}>0.5×</option>
                      <option value={1200}>1×</option>
                      <option value={650}>2×</option>
                    </select>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, buildManual.steps.length - 1)}
                    value={manualStepIndex}
                    onChange={(event) => { setIsManualPlaying(false); setManualStepIndex(Number(event.target.value)) }}
                    aria-label={t('manual.timeline')}
                  />
                  <span>{t('manual.timelineProgress', { current: manualStepIndex + 1, total: buildManual.steps.length })}</span>
                </div>
                <div className="manual-assembly-guides">
                  {[...new Set(selectedManualStep.addPieces.map((piece) => piece.assembly.label))].map((label) => <span key={label}>{label}</span>)}
                </div>
                <div className="manual-preview-viewer">
                  <Suspense fallback={<div className="scene-loading">{t('scene.loading')}</div>}>
                    <BrickScene
                      bricks={manualDisplayBricks}
                      selectedId=""
                      highlightedIds={selectedManualStep.addPieces.map((piece) => piece.instanceId)}
                      cameraFrameKey={`${manualPlan?.id ?? 'manual'}:${selectedManualStep.stepNumber}:${isManualExploded ? 'exploded' : 'assembled'}`}
                      initialCameraAzimuthDegrees={selectedManualStep.cameraAzimuthDegrees}
                      onSelect={() => {}}
                      onNudgeSelected={() => {}}
                      onRotateSelected={() => {}}
                      onDeleteSelected={() => {}}
                    />
                  </Suspense>
                </div>
                <div className="manual-page-controls">
                  <button
                    type="button"
                    onClick={() => { setIsManualPlaying(false); setManualStepIndex((current) => Math.max(0, current - 1)) }}
                    disabled={manualStepIndex === 0}
                  >
                    {t('manual.prev')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsManualPlaying(false); setManualStepIndex((current) => Math.min(buildManual.steps.length - 1, current + 1)) }}
                    disabled={manualStepIndex >= buildManual.steps.length - 1}
                  >
                    {t('manual.next')}
                  </button>
                </div>
                <div className="manual-page-tabs" aria-label={t('manual.pageTabs')}>
                  {manualPageTabItems.map((item) => item.kind === 'gap' ? (
                    <span key={item.key} className="manual-page-gap" aria-hidden="true">…</span>
                  ) : (
                    <button
                      key={`${buildManual.steps[item.index].stepNumber}-${buildManual.steps[item.index].title}`}
                      type="button"
                      className={item.index === manualStepIndex ? 'active' : ''}
                      onClick={() => { setIsManualPlaying(false); setManualStepIndex(item.index) }}
                    >
                      {buildManual.steps[item.index].stepNumber}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="manual-step-list-header">
              <strong>{t('manual.stepRange', {
                start: manualStepPage.total > 0 ? manualStepPage.start + 1 : 0,
                end: manualStepPage.end,
                total: manualStepPage.total,
              })}</strong>
              <div>
                <button
                  type="button"
                  disabled={!manualStepPage.hasPrevious}
                  onClick={() => {
                    setIsManualPlaying(false)
                    setManualStepIndex(Math.max(0, manualStepPage.start - manualStepPageSize))
                  }}
                >
                  {t('manual.prevGroup')}
                </button>
                <button
                  type="button"
                  disabled={!manualStepPage.hasNext}
                  onClick={() => {
                    setIsManualPlaying(false)
                    setManualStepIndex(manualStepPage.end)
                  }}
                >
                  {t('manual.nextGroup')}
                </button>
              </div>
            </div>
            <div className="manual-step-list">
              {visibleManualSteps.map((step, visibleIndex) => {
                const index = manualStepPage.start + visibleIndex
                return (
                <article
                  key={`${step.stepNumber}-${step.title}`}
                  className={`manual-step-card ${index === manualStepIndex ? 'active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => { setIsManualPlaying(false); setManualStepIndex(index) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setIsManualPlaying(false)
                      setManualStepIndex(index)
                    }
                  }}
                >
                  <header>
                    <span>{step.stepNumber}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                    </div>
                  </header>
                  <div className="manual-piece-list">
                    {step.addPieces.map((piece) => (
                      <div key={piece.instanceId}>
                        <strong>{piece.name}</strong>
                        <small>
                          {piece.color} · x{piece.pose.xStud} y{piece.pose.yStud} z{piece.pose.zStud} · {piece.rotationDegrees}° · {piece.assembly.label}
                        </small>
                      </div>
                    ))}
                  </div>
                  <p className="manual-step-meta">
                    {t('manual.stepMeta', { added: step.addPieces.length, total: step.completedPieceCount })}
                  </p>
                  <p className={`structure-status ${step.validation.ok ? (step.validation.issueCount > 0 ? 'notice' : 'ok') : 'warn'}`}>
                    {step.validation.summary}
                  </p>
                </article>
                )
              })}
            </div>

            <div className="manual-actions">
              <button className="secondary" type="button" onClick={copyManualMarkdown}>
                <BookOpen size={16} />
                {manualCopyStatus === 'copied' ? t('common.copied') : manualCopyStatus === 'failed' ? t('common.copyFailed') : t('manual.copyMarkdown')}
              </button>
              <button className="secondary" type="button" onClick={exportManualMarkdown}>
                <Download size={16} />
                {t('common.exportMarkdown')}
              </button>
              <button className="secondary" type="button" onClick={exportManualHtml}>
                <Download size={16} />
                {t('common.exportHtml')}
              </button>
              <button className="primary compact-primary" type="button" onClick={exportManual}>
                <Download size={16} />
                {t('manual.exportJson')}
              </button>
            </div>
            {manualCopyStatus === 'failed' && (
              <textarea className="manual-copy-output" readOnly value={manualMarkdown} aria-label={t('manual.markdownText')} />
            )}
          </section>
        </div>
      )}
    </main>
  )
}

export default App
