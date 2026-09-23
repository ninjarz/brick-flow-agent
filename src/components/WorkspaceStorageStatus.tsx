import type { useWorkspacePersistence } from '../hooks/useWorkspacePersistence'
import { useI18n } from '../lib/i18n'

export const WorkspaceStorageStatus = ({ status, recovery, retry }: ReturnType<typeof useWorkspacePersistence>) => {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const label = {
    conflict: zh ? '保存冲突：请在项目菜单中重新加载或另存为新项目' : 'Save conflict: reload or save as a new project in Projects',
    loading: zh ? '正在恢复项目…' : 'Restoring project…',
    saving: zh ? '正在保存…' : 'Saving…',
    saved: zh ? '已保存在此浏览器' : 'Saved in this browser',
    unavailable: zh ? '暂时无法保存，请导出项目备份' : 'Saving unavailable. Export a project backup.',
    recovery: zh ? '原草稿无法恢复，已暂停自动保存以保护原始数据。请先下载备份；清空画布后可重新保存。' : 'The original draft could not be restored. Autosave is paused to protect it. Download a backup before clearing the canvas to start again.',
  }[status]
  return <div className={`workspace-storage-status ${status}`} role="status">
    <span>{label}</span>
    {status === 'unavailable' && <button type="button" onClick={() => void retry()}>{zh ? '重试保存' : 'Retry save'}</button>}
    {status === 'recovery' && recovery?.value != null && <button type="button" onClick={() => {
      const value = typeof recovery.value === 'string' ? recovery.value : JSON.stringify(recovery.value)
      const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'brick-flow-draft-recovery.json'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    }}>{zh ? '下载原始草稿' : 'Download original draft'}</button>}
  </div>
}
