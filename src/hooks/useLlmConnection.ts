import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { isLlmConfigComplete, resetLlmThinkingCompatibility, testLlmConnection } from '../lib/llmGenerator'
import { clearLlmConnection, hasPersistedLlmConnection, loadLlmConfig, saveLlmConfig, saveLlmConnection } from '../lib/llmConfig'
import type { LlmConfig } from '../types/bricks'
import type { createWorkspaceSession } from '../lib/workspaceSession'

type LlmFeedback = { tone: 'error' | 'warning' | 'success'; text: string }

export const useLlmConnection = (session: ReturnType<typeof createWorkspaceSession>) => {
  const { locale, t } = useI18n()
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(() => loadLlmConfig())
  const [isLlmConnectionVerified, setIsLlmConnectionVerified] = useState(() => hasPersistedLlmConnection(llmConfig))
  const [isTestingLlmConfig, setIsTestingLlmConfig] = useState(false)
  const [llmConfigFeedback, setLlmConfigFeedback] = useState<LlmFeedback>()
  const configTestAbortRef = useRef<AbortController>()
  const configRevisionRef = useRef(0)
  const llmConfigComplete = isLlmConfigComplete(llmConfig)

  useEffect(() => { saveLlmConfig(llmConfig) }, [llmConfig])

  const cancelConfigTest = useCallback(() => {
    configTestAbortRef.current?.abort()
    configTestAbortRef.current = undefined
    setIsTestingLlmConfig(false)
  }, [])

  const updateLlmConfig = (nextConfig: LlmConfig) => {
    configRevisionRef.current += 1
    session.invalidate()
    resetLlmThinkingCompatibility()
    clearLlmConnection()
    setIsLlmConnectionVerified(false)
    setLlmConfigFeedback(undefined)
    setLlmConfig(nextConfig)
  }

  const handleTestLlmConfig = async () => {
    resetLlmThinkingCompatibility()
    setLlmConfigFeedback(undefined)
    if (!llmConfigComplete) {
      setLlmConfigFeedback({ tone: 'error', text: t('config.incomplete') })
      return
    }
    setIsTestingLlmConfig(true)
    configTestAbortRef.current?.abort()
    const controller = new AbortController()
    configTestAbortRef.current = controller
    const configRevision = configRevisionRef.current
    try {
      await testLlmConnection(llmConfig, locale, controller.signal)
      if (controller.signal.aborted || configRevision !== configRevisionRef.current) return
      saveLlmConnection(llmConfig)
      setIsLlmConnectionVerified(true)
      setLlmConfigFeedback({ tone: 'success', text: t('config.success') })
    } catch (error) {
      if (controller.signal.aborted || configRevision !== configRevisionRef.current) return
      clearLlmConnection()
      setIsLlmConnectionVerified(false)
      setLlmConfigFeedback({ tone: 'error', text: error instanceof Error ? error.message : t('config.failed') })
    } finally {
      if (configTestAbortRef.current === controller) {
        configTestAbortRef.current = undefined
        setIsTestingLlmConfig(false)
      }
    }
  }

  return {
    llmConfig, llmConfigComplete, isLlmConnectionVerified, setIsLlmConnectionVerified,
    isTestingLlmConfig, setIsTestingLlmConfig, llmConfigFeedback, setLlmConfigFeedback,
    updateLlmConfig, handleTestLlmConfig, cancelConfigTest,
  }
}
