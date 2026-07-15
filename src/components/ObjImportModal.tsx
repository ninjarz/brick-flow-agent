import { useEffect, useRef, useState } from 'react'
import { Box, Check, FileUp, RotateCcw, X } from 'lucide-react'
import {
  objImportProfiles,
  type ObjImportEdgeStyle,
  type ObjImportOrientation,
  type ObjImportProfileId,
  type ObjImportProgress,
  type ObjImportProjection,
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

const ObjProjectionGraphic = ({ projection, variant, label }: {
  projection: ObjImportProjection
  variant: 'source' | 'final'
  label: string
}) => {
  const rows = variant === 'source' ? projection.sourceRows : projection.finalRows
  const occupied = rows.flatMap((row, y) => [...row].flatMap((value, x) => value === '1' ? [{ x, y }] : []))
  return (
    <figure>
      <svg viewBox={`0 0 ${projection.width} ${projection.height}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
        <rect width={projection.width} height={projection.height} fill="#e2e8f0" />
        {occupied.map((cell) => <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={1} height={1} fill={variant === 'source' ? '#64748b' : '#2563eb'} />)}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  )
}

export const ObjImportModal = ({ open, onClose, onImported }: ObjImportModalProps) => {
  const { locale, t } = useI18n()
  const workerRef = useRef<Worker>()
  const importRunRef = useRef(0)
  const [file, setFile] = useState<File>()
  const [title, setTitle] = useState('')
  const [profileId, setProfileId] = useState<ObjImportProfileId>('s')
  const [orientation, setOrientation] = useState<ObjImportOrientation>('upright')
  const [edgeStyle, setEdgeStyle] = useState<ObjImportEdgeStyle>('angular')
  const [brickBudget, setBrickBudget] = useState('2000')
  const [saveToLibrary, setSaveToLibrary] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState<ObjImportProgress>({ stage: 'parse', progress: 0 })
  const [error, setError] = useState('')
  const [result, setResult] = useState<ObjImportResult>()

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
      setEdgeStyle('angular')
      setBrickBudget('2000')
      setSaveToLibrary(false)
      setProgress({ stage: 'parse', progress: 0 })
      setError('')
      setResult(undefined)
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
    setResult(undefined)
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
        setResult(event.data.result)
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
          edgeStyle,
          maxBricks: brickBudget === 'unlimited' ? undefined : Number(brickBudget),
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
            <input value={title} disabled={isImporting} onChange={(event) => { setTitle(event.target.value); setResult(undefined) }} placeholder={t('objImport.modelNamePlaceholder')} />
          </label>
          <label>
            <span>{t('objImport.orientation')}</span>
            <select value={orientation} disabled={isImporting} onChange={(event) => { setOrientation(event.target.value as ObjImportOrientation); setResult(undefined) }}>
              <option value="upright">{t('objImport.orientation.upright')}</option>
              <option value="lay-side">{t('objImport.orientation.laySide')}</option>
              <option value="lay-back">{t('objImport.orientation.layBack')}</option>
            </select>
          </label>
          <label>
            <span>{t('objImport.edgeStyle')}</span>
            <select value={edgeStyle} disabled={isImporting} onChange={(event) => { setEdgeStyle(event.target.value as ObjImportEdgeStyle); setResult(undefined) }}>
              <option value="angular">{t('objImport.edgeStyle.angular')}</option>
              <option value="curved">{t('objImport.edgeStyle.curved')}</option>
            </select>
          </label>
          <label>
            <span>{t('objImport.brickBudget')}</span>
            <select value={brickBudget} disabled={isImporting} onChange={(event) => { setBrickBudget(event.target.value); setResult(undefined) }}>
              <option value="250">250</option>
              <option value="750">750</option>
              <option value="2000">2000</option>
              <option value="unlimited">{t('objImport.brickBudget.unlimited')}</option>
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
                onClick={() => { setProfileId(profile.id); setResult(undefined) }}
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

        {result && (
          <section className="obj-result-preview" aria-label={t('objImport.preview')}>
            <header>
              <div>
                <h3>{t('objImport.preview')}</h3>
                <p>{t('objImport.previewDescription')}</p>
              </div>
              <span>{result.stats.dimensions.width}×{result.stats.dimensions.height}×{result.stats.dimensions.depth}</span>
            </header>
            <div className="obj-preview-comparison">
              <ObjProjectionGraphic projection={result.preview.front} variant="source" label={t('objImport.preview.source')} />
              <ObjProjectionGraphic projection={result.preview.front} variant="final" label={t('objImport.preview.result')} />
            </div>
            <div className="obj-preview-metrics">
              <span><strong>{result.stats.brickCount}</strong>{t('objImport.metric.bricks')}</span>
              <span><strong>{result.stats.resolution}</strong>{t('objImport.metric.resolution')}</span>
              <span><strong>{(result.stats.voxelIoU * 100).toFixed(1)}%</strong>{t('objImport.metric.voxelIoU')}</span>
              <span><strong>{(((result.stats.frontSilhouetteIoU + result.stats.sideSilhouetteIoU + result.stats.topSilhouetteIoU) / 3) * 100).toFixed(1)}%</strong>{t('objImport.metric.silhouetteIoU')}</span>
              <span><strong>{(result.stats.structuralChangeRatio * 100).toFixed(1)}%</strong>{t('objImport.metric.structuralChange')}</span>
              <span><strong>{result.stats.curvedSlopeCount}</strong>{t('objImport.metric.curvedSlopes')}</span>
            </div>
          </section>
        )}

        {error && <p className="obj-import-error" role="alert">{error}</p>}

        <div className="obj-import-actions">
          <button className="secondary" type="button" onClick={close}>{isImporting ? t('control.cancel') : t('common.close')}</button>
          {result && !isImporting && (
            <button className="secondary" type="button" onClick={startImport}>
              <RotateCcw size={16} />
              {t('objImport.regenerate')}
            </button>
          )}
          <button className="primary" type="button" disabled={!file || isImporting} onClick={result ? () => onImported(result, saveToLibrary) : startImport}>
            {result ? <Check size={17} /> : <FileUp size={17} />}
            {isImporting ? t('objImport.importing') : result ? t('objImport.confirmImport') : t('objImport.generatePreview')}
          </button>
        </div>
      </section>
    </div>
  )
}
