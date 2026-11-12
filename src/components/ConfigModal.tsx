import { ModelNameInput } from './ModelNameInput'
import { useEffect, useRef, useState } from 'react'
import { listLlmModels } from '../lib/llmModels'
import { Globe2, KeyRound, Link, Settings2, ShieldCheck, X } from 'lucide-react'
import { appVersion } from '../lib/appDiagnostics'
import { clearAllLocalAppData } from '../lib/localData'
import { defaultLlmConfig, maxRepairAttemptsCeiling, normalizeMaxRepairAttempts } from '../lib/llmConfig'
import { useI18n } from '../lib/i18n'
import type { LlmConfig } from '../types/bricks'

type Feedback = { tone: 'error' | 'warning' | 'success'; text: string }
type Props = {
  config: LlmConfig
  engineStatusLabel: string
  testing: boolean
  feedback?: Feedback
  onUpdate: (config: LlmConfig) => void
  onFeedback: (feedback?: Feedback) => void
  onTest: () => void
  onClose: () => void
}

export const ConfigModal = ({ config, engineStatusLabel, testing, feedback, onUpdate, onFeedback, onTest, onClose }: Props) => {
  const { locale, setLocale, t } = useI18n()
  const zh = locale === 'zh-CN'
  const [modelList, setModelList] = useState<string[]>([])
  const [listing, setListing] = useState(false)
  const [listMessage, setListMessage] = useState('')
  const listRequest = useRef<AbortController>()
  useEffect(() => {
    listRequest.current?.abort()
    setModelList([])
    setListing(false)
    setListMessage('')
    return () => listRequest.current?.abort()
  }, [config.endpoint, config.apiKey, config.requestMode])
  const loadModels = async () => {
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    setListing(true)
    setListMessage('')
    try {
      const models = await listLlmModels(config, controller.signal)
      if (controller.signal.aborted) return
      setModelList(models)
      if (!models.length) setListMessage(zh ? '服务商返回的模型列表为空，可手动填写。' : 'The provider returned no models. Enter a model manually.')
    } catch {
      if (controller.signal.aborted) return
      setModelList([])
      setListMessage(zh ? '无法获取模型列表，请检查地址、密钥和接口支持。直连可能受跨域限制，可尝试本地代理或手动填写。' : 'Could not list models. Check the endpoint, key, and provider support. Browser CORS restrictions may require local proxy mode. You can also enter a model manually.')
    } finally {
      if (!controller.signal.aborted) setListing(false)
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="config-modal" role="dialog" aria-modal="true" aria-labelledby="config-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><h2 id="config-title">{t('config.title')}</h2><p>{engineStatusLabel}</p></div><button className="icon-button" type="button" aria-label={t('common.close')} onClick={onClose}><X size={18} /></button></header>
        <div className="config-form">
          <section className="config-section">
            <div className="config-section-title"><Globe2 size={16} /><div><h3>{t('config.languageSection')}</h3><p>{t('config.languageDescription')}</p></div></div>
            <div className="language-options" role="group" aria-label={t('app.language')}><button type="button" className={locale === 'zh-CN' ? 'active' : ''} onClick={() => setLocale('zh-CN')}>中文</button><button type="button" className={locale === 'en-US' ? 'active' : ''} onClick={() => setLocale('en-US')}>English</button></div>
          </section>
          <section className="config-section">
            <div className="config-section-title"><Settings2 size={16} /><div><h3>{t('config.llmSection')}</h3><p>{engineStatusLabel}</p></div></div>
            <label>{t('config.endpoint')}<span className="input-with-icon"><Link size={15} /><input value={config.endpoint} onChange={(event) => onUpdate({ ...config, endpoint: event.target.value })} placeholder="https://api.example.com/v1" type="url" autoComplete="off" /></span></label>
            <label>api_key<span className="input-with-icon"><KeyRound size={15} /><input value={config.apiKey} onChange={(event) => onUpdate({ ...config, apiKey: event.target.value })} placeholder="sk-..." type="password" autoComplete="off" /></span></label>
            <div className="config-field">
              <span>{t('config.modelName')}</span>
              <div className="model-name-row">
                <ModelNameInput value={config.modelName} models={modelList} label={t('config.modelName')} placeholder={t('config.modelPlaceholder')} onChange={modelName => onUpdate({ ...config, modelName })} />
                <button type="button" className="secondary model-list-button" onClick={loadModels} disabled={listing || !config.endpoint.trim() || !config.apiKey.trim()}>{listing ? (zh ? '获取中…' : 'Loading…') : (zh ? '获取模型列表' : 'List models')}</button>
              </div>
              {listMessage && <p className="config-field-note" role="status">{listMessage}</p>}
            </div>
            <div className="config-field"><span>{t('config.requestMode')}</span><div className="request-mode-options" role="group" aria-label={t('config.requestMode')}>{(['direct', 'proxy'] as const).map((requestMode) => <button key={requestMode} type="button" className={config.requestMode === requestMode ? 'active' : ''} onClick={() => onUpdate({ ...config, requestMode })}>{requestMode === 'direct' ? <Globe2 size={15} /> : <Link size={15} />}<span>{t(`config.requestMode.${requestMode}`)}</span></button>)}</div><p className="config-field-note">{t(`config.requestModeDescription.${config.requestMode}`)}</p></div>
            <label className="config-toggle"><input type="checkbox" checked={config.enableThinking} onChange={(event) => onUpdate({ ...config, enableThinking: event.target.checked })} /><span><strong>{t('config.thinkingMode')}</strong><small>{t(`config.thinkingModeDescription.${config.enableThinking ? 'on' : 'off'}`)}</small></span></label>
            <label className="config-toggle"><input type="checkbox" checked={config.autoRepair} onChange={(event) => onUpdate({ ...config, autoRepair: event.target.checked })} /><span><strong>{t('config.autoRepair')}</strong><small>{t(`config.autoRepairDescription.${config.autoRepair ? 'on' : 'off'}`)}</small></span></label>
            {config.autoRepair && <label className="config-inline-field"><span>{t('config.maxRepairAttempts')}</span><input type="number" min={1} max={maxRepairAttemptsCeiling} step={1} value={normalizeMaxRepairAttempts(config.maxRepairAttempts)} onChange={(event) => onUpdate({ ...config, maxRepairAttempts: normalizeMaxRepairAttempts(event.target.value) })} /></label>}
            <div className="config-actions"><button type="button" className="secondary" onClick={onTest} disabled={testing}>{testing ? t('config.testing') : t('config.test')}</button>{feedback && <p className={`feedback-text ${feedback.tone}`}>{feedback.text}</p>}</div>
          </section>
          <section className="config-section privacy-section">
            <div className="config-section-title"><ShieldCheck size={16} /><div><h3>{zh ? '隐私与本地数据' : 'Privacy and local data'}</h3><p>{zh ? '项目、素材和配置只保存在此浏览器。直连模式会把提示词、所选参考图片和 API Key 直接发送到你配置的模型服务商；Brick Flow 没有项目服务器。' : 'Projects, assets, and settings stay in this browser. Direct mode sends prompts, selected reference images, and the API key directly to your configured model provider; Brick Flow has no project server.'}</p></div></div>
            <p className="config-field-note">Brick Flow {appVersion}</p>
            <div className="config-actions privacy-actions">
              <button type="button" className="secondary" onClick={() => { onUpdate({ ...defaultLlmConfig }); onFeedback({ tone: 'success', text: zh ? 'API 配置已从本浏览器清除。' : 'API settings were cleared from this browser.' }) }}>{zh ? '清除 API 配置' : 'Clear API settings'}</button>
              <button type="button" className="danger-action" onClick={async () => {
                if (!window.confirm(zh ? '这会删除当前项目草稿、自定义素材、API 配置和所有偏好，且无法撤销。继续吗？' : 'This deletes the current draft, custom assets, API settings, and all preferences. It cannot be undone. Continue?')) return
                const cleared = await clearAllLocalAppData()
                if (!cleared) { window.alert(zh ? 'IndexedDB 正被另一个 Brick Flow 标签页使用。请关闭其他标签页后再试。' : 'IndexedDB is in use by another Brick Flow tab. Close the other tab and try again.'); return }
                window.location.reload()
              }}>{zh ? '清除所有本地数据' : 'Clear all local data'}</button>
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
