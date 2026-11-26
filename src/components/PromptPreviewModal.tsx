import { Download, X } from 'lucide-react'
import { useI18n } from '../lib/i18n'

type Props = {
  promptPreview: { original: string; system: string; user: string }
  copyStatus: 'idle' | 'copied' | 'failed'
  onCopy: () => void
  onExport: () => void
  onClose: () => void
}

export const PromptPreviewModal = ({ promptPreview, copyStatus, onCopy, onExport, onClose }: Props) => {
  const { t } = useI18n()

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
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
            <p><strong>{t('prompt.request')}</strong> {promptPreview.original}</p>
            <p>{t('prompt.firstRequest')}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <label>
          {t('prompt.system')}
          <textarea readOnly value={promptPreview.system} />
        </label>
        <label>
          {t('prompt.user')}
          <textarea readOnly value={promptPreview.user} />
        </label>
        <div className="prompt-actions">
          <button className="secondary" type="button" onClick={onCopy}>
            {copyStatus === 'copied' ? t('common.copied') : copyStatus === 'failed' ? t('common.copyFailed') : t('prompt.copyAll')}
          </button>
          <button className="secondary" type="button" onClick={onExport}>
            <Download size={16} />
            {t('common.exportTxt')}
          </button>
        </div>
      </section>
    </div>
  )
}
