import { useState } from 'react'
import type { useWorkspacePersistence } from '../hooks/useWorkspacePersistence'
import { useI18n } from '../lib/i18n'

export const ProjectManager = (props: ReturnType<typeof useWorkspacePersistence>) => {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState(false)
  return <details className="project-manager" onToggle={event => { if (event.currentTarget.open) void props.refresh() }}>
    <summary>{zh ? '项目' : 'Projects'} · {props.current?.name ?? '…'}</summary>
    <fieldset disabled={props.busy || props.status === 'loading'}>
      <label>{zh ? '项目名称' : 'Project name'} <input aria-label="Project name" value={name} onChange={event => setName(event.target.value)} placeholder={props.current?.name} maxLength={120} /></label>
      <button onClick={() => void props.create(name || 'Untitled')}>{zh ? '新建项目' : 'New project'}</button>
      <button onClick={() => void props.create(name || `${props.current?.name} copy`, true)}>{zh ? '复制项目' : 'Duplicate project'}</button>
      <button disabled={!name.trim()} onClick={() => void props.rename(name)}>{zh ? '重命名' : 'Rename'}</button>
      <button onClick={() => setDeleting(true)}>{zh ? '删除当前项目' : 'Delete current project'}</button>
      {deleting && <span>{zh ? '删除后无法恢复。' : 'Deletion cannot be undone.'}<button onClick={() => { setDeleting(false); void props.remove() }}>{zh ? '确认删除' : 'Confirm deletion'}</button><button onClick={() => setDeleting(false)}>{zh ? '取消' : 'Cancel'}</button></span>}
      <ul>{props.projects.map(project => <li key={project.id}><button disabled={project.id === props.current?.id} onClick={() => void props.open(project.id)}>{project.name}</button> <time>{new Date(project.savedAt).toLocaleString()}</time></li>)}</ul>
      <button onClick={() => void props.checkpoint(name || (zh ? '手动恢复点' : 'Manual checkpoint'))}>{zh ? '保存恢复点' : 'Save checkpoint'}</button>
      <ul>{props.checkpoints.map(item => <li key={item.id}>{item.name} · {new Date(item.savedAt).toLocaleString()} <button onClick={() => void props.restore(item.id)}>{zh ? '恢复' : 'Restore'}</button></li>)}</ul>
      {props.status === 'conflict' && <div role="alert">{zh ? '项目已被其他标签页修改或删除。请选择重新加载，或将当前内容另存为新项目。' : 'Another tab changed or deleted this project. Reload or save your work as a new project.'}<button onClick={() => void props.reload()}>{zh ? '重新加载项目' : 'Reload project'}</button></div>}
      {(props.status === 'conflict' || props.status === 'unavailable') && <button onClick={() => void props.saveAs(name || 'Recovered project')}>{zh ? '另存为新项目' : 'Save as new project'}</button>}
    </fieldset>
  </details>
}
