import { Copy, RotateCw, Trash2, X } from 'lucide-react'
import { brickById } from '../data/basicBricks'
import { WORLD_EDIT_STEP_STUDS, normalizeEditableStud, normalizeYStud } from '../lib/brickUnits'
import { useI18n } from '../lib/i18n'
import type { BrickColor, BuildPlan, PlacedBrick } from '../types/bricks'

type BrickEditorPanelProps = {
  plan: BuildPlan
  selectedBrick?: PlacedBrick
  selectedCount?: number
  onUpdateBrick: (brick: PlacedBrick) => void
  onDuplicate: () => void
  onDelete: () => void
  onClose: () => void
}

const colors: BrickColor[] = ['red', 'blue', 'yellow', 'green', 'white', 'black', 'gray', 'brown', 'orange', 'tan', 'cyan', 'lime', 'pink', 'trans-pink']

export const BrickEditorPanel = ({
  plan,
  selectedBrick,
  selectedCount = 0,
  onUpdateBrick,
  onDuplicate,
  onDelete,
  onClose,
}: BrickEditorPanelProps) => {
  const { t } = useI18n()
  if (!selectedBrick) return null

  const selectedDefinition = brickById.get(selectedBrick.brickId)
  const selectedColors = selectedDefinition?.colors ?? colors
  const selectedStep = plan.steps.find((step) => step.brickIds.includes(selectedBrick.id))

  const setPose = (axis: 'xStud' | 'yStud' | 'zStud', value: number) => {
    if (!Number.isFinite(value)) return
    const nextValue = axis === 'yStud' ? normalizeYStud(value) : normalizeEditableStud(value)
    const next: PlacedBrick = {
      ...selectedBrick,
      pose: {
        ...selectedBrick.pose,
        [axis]: nextValue,
      },
    }
    onUpdateBrick(next)
  }

  return (
    <section className="brick-editor-window" aria-label={t('control.editor')}>
      <div className="floating-window-title">
        <div className="section-title">
          <RotateCw size={18} />
          <h2>{t('control.editor')}</h2>
        </div>
        <button className="icon-button" type="button" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
          <X size={17} />
        </button>
      </div>

      <div className="selected-piece-card">
        <div>
          <span>{selectedCount > 1 ? t('control.selectedParts', { count: selectedCount }) : t('control.currentPart')}</span>
          <strong>{selectedDefinition?.name ?? selectedBrick.brickId}</strong>
        </div>
        <p>
          {t('control.partNumber', { number: selectedDefinition?.partNumber ?? selectedBrick.brickId })} ·
          {t('control.instance', { id: selectedBrick.id })}
          {selectedStep ? ` · ${t('control.belongsTo', { step: selectedStep.title })}` : ` · ${t('control.manualAdded')}`}
        </p>
      </div>

      <div className="field-grid">
        <label>
          {t('control.x')}
          <input type="number" step={WORLD_EDIT_STEP_STUDS} value={selectedBrick.pose.xStud} onChange={(event) => setPose('xStud', Number(event.target.value))} />
        </label>
        <label>
          {t('control.y')}
          <input type="number" step={WORLD_EDIT_STEP_STUDS} value={selectedBrick.pose.yStud} onChange={(event) => setPose('yStud', Number(event.target.value))} />
        </label>
        <label>
          {t('control.z')}
          <input type="number" step={WORLD_EDIT_STEP_STUDS} value={selectedBrick.pose.zStud} onChange={(event) => setPose('zStud', Number(event.target.value))} />
        </label>
        <label>
          {t('control.horizontalRotation')}
          <select
            value={selectedBrick.pose.rotationQuarterTurns}
            onChange={(event) =>
              onUpdateBrick({
                ...selectedBrick,
                pose: {
                  ...selectedBrick.pose,
                  rotationQuarterTurns: Number(event.target.value) as 0 | 1 | 2 | 3,
                },
              })
            }
          >
            <option value={0}>0°</option>
            <option value={1}>90°</option>
            <option value={2}>180°</option>
            <option value={3}>270°</option>
          </select>
        </label>
        <label>
          {t('control.verticalRotation')}
          <select
            value={selectedBrick.pose.verticalQuarterTurns ?? 0}
            onChange={(event) =>
              onUpdateBrick({
                ...selectedBrick,
                pose: {
                  ...selectedBrick.pose,
                  verticalQuarterTurns: Number(event.target.value) as 0 | 1 | 2 | 3,
                },
              })
            }
          >
            <option value={0}>0°</option>
            <option value={1}>90°</option>
            <option value={2}>180°</option>
            <option value={3}>270°</option>
          </select>
        </label>
      </div>

      <div className="swatches" aria-label={t('control.colors')}>
        {selectedColors.map((color) => (
          <button
            key={color}
            type="button"
            className={selectedBrick.color === color ? 'active' : ''}
            style={{ background: `var(--brick-${color})` }}
            title={color}
            onClick={() => onUpdateBrick({ ...selectedBrick, color })}
          />
        ))}
      </div>

      <div className="button-row">
        {selectedCount <= 1 && (
          <button type="button" onClick={onDuplicate}>
            <Copy size={16} />
            {t('control.copy')}
          </button>
        )}
        <button type="button" className="danger" onClick={onDelete}>
          <Trash2 size={16} />
          {t('common.delete')}
        </button>
      </div>
    </section>
  )
}
