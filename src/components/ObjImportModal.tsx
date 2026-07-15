import { useEffect, useRef, useState } from 'react'
import { Box, FileUp, X } from 'lucide-react'
import {
  objImportProfiles,
  type ObjImportOrientation,
  type ObjImportProfileId,
  type ObjImportProgress,
  type ObjImportResult,
  type ObjImportWorkerRequest,
  type ObjImportWorkerResponse,
} from '../lib/objImport'
import { useI18n } from '../lib/i18n'

type ObjImportModalProps = {
  open: boolean
  onClose: () => void
  onImported: (result: ObjImportResult, saveToLibrary: boolean) => void
}

const maxObjFileBytes = 100 * 1024 * 1024

const stripObjExtension = (fileName: string) => fileName.replace(/\.obj$/i, '')

export const ObjImportModal = ({ open, onClose, onImported }: ObjImportModalProps) => {
  const { locale, t } = useI18n()
  const workerRef = useRef<Worker>()
  const importRunRef = useRef(0)
  const [file, setFile] = useState<File>()
  const [title, setTitle] = useState('')
  const [profileId, setProfileId] = useState<ObjImportProfileId>('s')
  const [orientation, setOrientation] = useState<ObjImportOrientation>('upright')
  const [saveToLibrary, setSaveToLibrary] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState<ObjImportProgress>({ stage: 'parse', progress: 0 })
  const [error, setError] = useState('')

  const stopWorker = () => {
    workerRef.current?.terminate()
    workerRef.current = undefined
  }

  useEffect(() => {
    if (open) {
      setFile(undefined)
      setTitle('')
      setProfileId('s')
      setOrientation('upright')
      setSaveToLibrary(false)
      setProgress({ stage: 'parse', progress: 0 })
      setError('')
      return
    }

    importRunRef.current += 1
    stopWorker()
    setIsImporting(false)
  }, [open])

  useEffect(() => () => {
    importRunRef.current += 1
    stopWorker()
  }, [])

  if (!open) return null

  const close = () => {
    importRunRef.current += 1
    stopWorker()
    setIsImporting(false)
    onClose()
  }

  const chooseFile = (nextFile?: File) => {
    if (isImporting) return
    setError('')
    if (!nextFile) return
    if (!/\.obj$/i.test(nextFile.name)) {
      setFile(undefined)
      setError(t('objImport.error.fileType'))
      return
    }
    if (nextFile.size > maxObjFileBytes) {
      setFile(undefined)
      setError(t('objImport.error.fileSize'))
      return
    }
    setFile(nextFile)
    setTitle(stripObjExtension(nextFile.name))
  }

  const getWorkerError = (code: string) => {
    if (code === 'OBJ_READ_FAILED') return t('objImport.error.readFailed')
    if (code === 'OBJ_EMPTY_GEOMETRY') return t('objImport.error.emptyGeometry')
    if (code === 'OBJ_DEGENERATE_GEOMETRY') return t('objImport.error.degenerateGeometry')
    if (code === 'OBJ_EMPTY_VOXELS' || code === 'OBJ_EMPTY_PLAN') return t('objImport.error.emptyPlan')
    return t('objImport.error.failed')
  }

  const startImport = () => {
    if (!file) {
      setError(t('objImport.error.noFile'))
      return
    }

    setError('')
    setIsImporting(true)
    setProgress({ stage: 'parse', progress: 0.02 })
    stopWorker()
    const importRun = ++importRunRef.current

    try {
      const worker = new Worker(new URL('../workers/objImportWorker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<ObjImportWorkerResponse>) => {
        if (importRunRef.current !== importRun) return
        if (event.data.type === 'progress') {
          setProgress(event.data.progress)
          return
        }
        stopWorker()
        setIsImporting(false)
        if (event.data.type === 'error') {
          setError(getWorkerError(event.data.code))
          return
        }
        onImported(event.data.result, saveToLibrary)
      }
      worker.onerror = () => {
        if (importRunRef.current !== importRun) return
        stopWorker()
        setIsImporting(false)
        setError(t('objImport.error.failed'))
      }
      const request: ObjImportWorkerRequest = {
        type: 'import',
        file,
        options: {
          title: title.trim() || stripObjExtension(file.name),
          profileId,
          orientation,
          color: 'gray',
          locale: locale === 'zh-CN' ? 'zh' : 'en',
          idPrefix: `${stripObjExtension(file.name)}-${Date.now().toString(36)}`,
        },
      }
      worker.postMessage(request)
    } catch {
      stopWorker()
      setIsImporting(false)
      setError(t('objImport.error.failed'))
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <section
        className="obj-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="obj-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="obj-import-title">{t('objImport.title')}</h2>
            <p>{t('objImport.description')}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t('common.close')} title={t('common.close')} onClick={close}>
            <X size={18} />
          </button>
        </header>

        <label
          className={`obj-file-drop ${file ? 'selected' : ''}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            chooseFile(event.dataTransfer.files[0])
          }}
        >
          <FileUp size={24} />
          <strong>{file?.name ?? t('objImport.chooseFile')}</strong>
          <small>{file ? t('objImport.fileSize', { size: (file.size / 1024 / 1024).toFixed(2) }) : t('objImport.fileHint')}</small>
          <input
            type="file"
            accept=".obj,model/obj,text/plain"
            disabled={isImporting}
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        </label>

        <div className="obj-import-fields">
          <label>
            <span>{t('objImport.modelName')}</span>
            <input value={title} disabled={isImporting} onChange={(event) => setTitle(event.target.value)} placeholder={t('objImport.modelNamePlaceholder')} />
          </label>
          <label>
            <span>{t('objImport.orientation')}</span>
            <select value={orientation} disabled={isImporting} onChange={(event) => setOrientation(event.target.value as ObjImportOrientation)}>
              <option value="upright">{t('objImport.orientation.upright')}</option>
              <option value="lay-side">{t('objImport.orientation.laySide')}</option>
              <option value="lay-back">{t('objImport.orientation.layBack')}</option>
            </select>
          </label>
        </div>

        <fieldset className="obj-profile-options" disabled={isImporting}>
          <legend>{t('objImport.size')}</legend>
          <div>
            {objImportProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={profileId === profile.id ? 'active' : ''}
                onClick={() => setProfileId(profile.id)}
              >
                <strong>{profile.label}</strong>
                <small>{t('objImport.resolution', { resolution: profile.resolution })}</small>
              </button>
            ))}
          </div>
          <p>{t(`objImport.sizeHint.${profileId}`)}</p>
        </fieldset>

        <label className="obj-save-option">
          <input type="checkbox" checked={saveToLibrary} disabled={isImporting} onChange={(event) => setSaveToLibrary(event.target.checked)} />
          <span>{t('objImport.saveToLibrary')}</span>
        </label>

        {isImporting && (
          <div className="obj-import-progress" role="status" aria-live="polite">
            <div>
              <Box size={17} />
              <span>{t(`objImport.stage.${progress.stage}`)}</span>
              <strong>{Math.round(progress.progress * 100)}%</strong>
            </div>
            <progress max={1} value={progress.progress} />
          </div>
        )}

        {error && <p className="obj-import-error" role="alert">{error}</p>}

        <div className="obj-import-actions">
          <button className="secondary" type="button" onClick={close}>{isImporting ? t('control.cancel') : t('common.close')}</button>
          <button className="primary" type="button" disabled={!file || isImporting} onClick={startImport}>
            <FileUp size={17} />
            {isImporting ? t('objImport.importing') : t('objImport.import')}
          </button>
        </div>
      </section>
    </div>
  )
}
