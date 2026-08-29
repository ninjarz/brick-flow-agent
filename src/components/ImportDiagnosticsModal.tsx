import { Clipboard, Github, Trash2, X } from 'lucide-react'
import { createImportDiagnosticIssueUrl, deleteImportDiagnostic, formatImportDiagnosticMarkdown, type ImportDiagnostic } from '../lib/importDiagnostics'
import { useI18n } from '../lib/i18n'

type Props = {
  diagnostics: ImportDiagnostic[]
  onChange: (diagnostics: ImportDiagnostic[]) => void
  onClose: () => void
}

export const ImportDiagnosticsModal = ({ diagnostics, onChange, onClose }: Props) => {
  const { locale, t } = useI18n()
  const zh = locale === 'zh-CN'
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="import-diagnostics-modal" role="dialog" aria-modal="true" aria-labelledby="import-diagnostics-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><h2 id="import-diagnostics-title">{zh ? '导入兼容性中心' : 'Import Compatibility Center'}</h2><p>{zh ? '最近 10 次导入的兼容性、修复和质量指标。' : 'Compatibility, repair, and quality metrics for the last 10 imports.'}</p></div>
          <button className="icon-button" type="button" aria-label={t('common.close')} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="import-diagnostics-list">
          {diagnostics.length === 0 && <p className="empty-state">{zh ? '还没有导入报告。' : 'No import reports yet.'}</p>}
          {diagnostics.map((diagnostic) => (
            <article key={diagnostic.id} className={diagnostic.status}>
              <header><div><strong>{diagnostic.fileName}</strong><small>{diagnostic.format} · {new Date(diagnostic.createdAt).toLocaleString(locale)}</small></div><span>{diagnostic.status}</span></header>
              <div className="import-diagnostic-metrics">
                <span>{zh ? '导入' : 'Imported'} <b>{diagnostic.importedPartCount}</b></span>
                <span>{zh ? '忽略' : 'Ignored'} <b>{diagnostic.ignoredPartCount}</b></span>
                <span>{zh ? '无效姿态' : 'Invalid poses'} <b>{diagnostic.unsupportedPoseCount}</b></span>
                <span>{zh ? '未知颜色' : 'Unknown colors'} <b>{diagnostic.unsupportedColorCodes.length}</b></span>
              </div>
              {diagnostic.unsupportedParts.length > 0 && <p>{zh ? '不支持零件：' : 'Unsupported parts: '}{diagnostic.unsupportedParts.map((item) => `${item.partNumber} ×${item.count}`).join(', ')}</p>}
              {diagnostic.validationMessages.map((message) => <p key={message}>{message}</p>)}
              {diagnostic.objMetrics && <p>IoU {(diagnostic.objMetrics.voxelIoU * 100).toFixed(1)}% · silhouette {(diagnostic.objMetrics.frontSilhouetteIoU * 100).toFixed(1)}%/{(diagnostic.objMetrics.sideSilhouetteIoU * 100).toFixed(1)}%/{(diagnostic.objMetrics.topSilhouetteIoU * 100).toFixed(1)}% · {diagnostic.objMetrics.brickCount} parts</p>}
              <footer>
                <button type="button" onClick={() => void navigator.clipboard.writeText(formatImportDiagnosticMarkdown(diagnostic))}><Clipboard size={14} />{zh ? '复制报告' : 'Copy report'}</button>
                <a href={createImportDiagnosticIssueUrl(diagnostic)} target="_blank" rel="noreferrer"><Github size={14} />Issue</a>
                <button type="button" onClick={() => onChange(deleteImportDiagnostic(diagnostic.id))}><Trash2 size={14} />{zh ? '删除' : 'Delete'}</button>
              </footer>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
