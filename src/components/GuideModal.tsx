import { BookOpen, Compass, Keyboard, Move, RotateCw, ShieldAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'

type GuideTab = 'shortcuts' | 'camera' | 'move' | 'rotate'
type DemoKey = 'camera' | 'select' | 'move' | 'rotate' | 'undo'

type GuideModalProps = {
  onClose: () => void
}

type DemoConfig = {
  frames: string[]
  captionsZh: string[]
  captionsEn: string[]
}

const guideDemoModules = import.meta.glob('../assets/guide-demos/*.jpg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const demoFrame = (name: string) => guideDemoModules[`../assets/guide-demos/${name}.jpg`] ?? ''

const DEMO_CONFIGS: Record<DemoKey, DemoConfig> = {
  camera: {
    frames: [demoFrame('camera-1'), demoFrame('camera-2'), demoFrame('camera-3')],
    captionsZh: ['默认视角', '左键拖拽旋转观察', '滚轮缩放拉近细节'],
    captionsEn: ['Default view', 'Left-drag to orbit', 'Scroll wheel to zoom in'],
  },
  select: {
    frames: [demoFrame('select-1'), demoFrame('select-2'), demoFrame('select-3')],
    captionsZh: ['未选中状态', '左键点击单选（紧贴蓝框）', '双击 / Shift+点击选中整组（黄框可固化）'],
    captionsEn: ['Idle scene', 'Click to select (tight blue OBB)', 'Double-click / Shift+Click group (yellow OBB)'],
  },
  move: {
    frames: [demoFrame('move-1'), demoFrame('move-2'), demoFrame('move-3')],
    captionsZh: ['选中零件 / 整组', '按 R / F 垂直升降', '按 W A S D 水平微调移动'],
    captionsEn: ['Select brick / group', 'Press R / F to raise or lower', 'Press W A S D to nudge horizontally'],
  },
  rotate: {
    frames: [demoFrame('rotate-1'), demoFrame('rotate-2'), demoFrame('rotate-3')],
    captionsZh: ['初始 0° 朝向', 'Shift + Q 按 15° 精细旋转（30°）', '按 Q 顺时针旋转 90°（120°）'],
    captionsEn: ['Initial 0° orientation', 'Shift + Q fine 15° step (30°)', 'Press Q for 90° turn (120°)'],
  },
  undo: {
    frames: [demoFrame('undo-1'), demoFrame('undo-2'), demoFrame('undo-3')],
    captionsZh: ['编辑前状态', '按 Backspace 删除选中件', '按 ⌘/Ctrl + Z 一键撤销恢复'],
    captionsEn: ['Before edit', 'Press Backspace to delete', 'Press ⌘/Ctrl + Z to undo'],
  },
}

const RealSceneDemo = ({
  demoKey,
  isZh,
  compact = false,
}: {
  demoKey: DemoKey
  isZh: boolean
  compact?: boolean
}) => {
  const config = DEMO_CONFIGS[demoKey]
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    setFrameIndex(0)
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % config.frames.length)
    }, 1050)
    return () => window.clearInterval(timer)
  }, [config.frames.length, demoKey])

  const captions = isZh ? config.captionsZh : config.captionsEn

  return (
    <div className={`guide-real-demo ${compact ? 'compact' : ''}`}>
      <div className="guide-real-demo-stage">
        {config.frames.map((src, index) => (
          <img
            key={src}
            src={src}
            alt={captions[index]}
            className={index === frameIndex ? 'active' : ''}
            loading="eager"
          />
        ))}
        <span className="guide-real-demo-badge">
          {captions[frameIndex]}
        </span>
      </div>
      {!compact && (
        <div className="guide-real-demo-steps" role="group" aria-label={isZh ? '演示帧切换' : 'Demo frames'}>
          {captions.map((caption, index) => (
            <button
              key={caption}
              type="button"
              className={index === frameIndex ? 'active' : ''}
              onClick={() => setFrameIndex(index)}
            >
              <span>{index + 1}</span>
              {caption}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type ShortcutItem = {
  keys: string[]
  desc: string
  demo: DemoKey
}

export const GuideModal = ({ onClose }: GuideModalProps) => {
  const { locale, t } = useI18n()
  const isZh = locale === 'zh-CN'
  const [tab, setTab] = useState<GuideTab>('shortcuts')
  const [hovered, setHovered] = useState<{ item: ShortcutItem; x: number; y: number } | null>(null)

  const shortcutGroups: { title: string; items: ShortcutItem[] }[] = [
    {
      title: isZh ? '视角与画布' : 'Camera & Viewport',
      items: [
        { keys: [isZh ? '左键拖拽空白' : 'Left-drag'], desc: isZh ? '围绕模型自由旋转视角' : 'Orbit camera around model', demo: 'camera' },
        { keys: [isZh ? '右键拖拽' : 'Right-drag'], desc: isZh ? '平移画布视角' : 'Pan camera', demo: 'camera' },
        { keys: [isZh ? '滚轮' : 'Scroll'], desc: isZh ? '缩放远近' : 'Zoom in / out', demo: 'camera' },
        { keys: ['W', 'A', 'S', 'D'], desc: isZh ? '未选中零件时，沿当前朝向漫游镜头' : 'Fly camera horizontally when nothing is selected', demo: 'camera' },
      ],
    },
    {
      title: isZh ? '选择与固化结构' : 'Selection & Structures',
      items: [
        { keys: [isZh ? '左键点击' : 'Click'], desc: isZh ? '选中单个零件或已固化结构（紧贴蓝框）' : 'Select brick or solidified structure (blue OBB)', demo: 'select' },
        { keys: ['Shift', isZh ? '点击' : 'Click'], desc: isZh ? '加选 / 取消多选多个零件（黄框）' : 'Add / toggle bricks in multi-selection (yellow OBB)', demo: 'select' },
        { keys: [isZh ? '双击零件' : 'Double-click'], desc: isZh ? '选中一整块连通的拼装结构' : 'Select entire connected assembly', demo: 'select' },
        { keys: ['Esc'], desc: isZh ? '取消放置 / 关闭弹窗 / 退出当前操作' : 'Cancel placement / close active modal', demo: 'select' },
      ],
    },
    {
      title: isZh ? '移动、吸附与旋转' : 'Move, Snap & Rotate',
      items: [
        { keys: ['W', 'A', 'S', 'D'], desc: isZh ? '选中后按镜头方向水平微调（0.2 格，长按连发）' : 'Nudge selected horizontally (0.2 stud, hold to repeat)', demo: 'move' },
        { keys: ['R', 'F'], desc: isZh ? '选中后垂直抬高 / 降低（0.2 格）' : 'Raise / lower selected brick (0.2 stud)', demo: 'move' },
        { keys: ['Q', 'E'], desc: isZh ? '水平 / 垂直顺时针旋转 90°' : 'Rotate horizontal / vertical by 90°', demo: 'rotate' },
        { keys: ['Shift', 'Q / E'], desc: isZh ? '水平 / 垂直精细旋转 15°（支持单件与固化结构）' : 'Fine rotate horizontal / vertical by 15°', demo: 'rotate' },
        { keys: [isZh ? '左键拖拽选中件' : 'Drag selected'], desc: isZh ? '拖动并自动吸附凸点，遇到斜角结构自动对齐角度' : 'Drag with stud snapping & auto-align to angled bricks', demo: 'move' },
        { keys: ['Backspace'], desc: isZh ? '删除当前选中的零件或整组选区' : 'Delete selected brick(s)', demo: 'undo' },
      ],
    },
    {
      title: isZh ? '撤销与快捷工具' : 'History & Tools',
      items: [
        { keys: ['⌘ / Ctrl', 'Z'], desc: isZh ? '撤销上一步拼装或编辑' : 'Undo last edit', demo: 'undo' },
        { keys: ['⌘ / Ctrl', 'Shift', 'Z'], desc: isZh ? '重做已撤销的操作' : 'Redo edit', demo: 'undo' },
        { keys: [isZh ? '拖入文件' : 'Drop file'], desc: isZh ? '直接拖入 JSON / LDR / MPD / OBJ 模型文件' : 'Drop JSON / LDR / MPD / OBJ directly into workspace', demo: 'camera' },
      ],
    },
  ]

  const showHoverPreview = (item: ShortcutItem, target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    const previewW = 304
    const previewH = 216
    const margin = 12
    const x = Math.min(Math.max(margin, rect.left + rect.width / 2 - previewW / 2), window.innerWidth - previewW - margin)
    const above = rect.top - previewH - 10
    const y = above >= margin ? above : Math.min(rect.bottom + 10, window.innerHeight - previewH - margin)
    setHovered({ item, x, y })
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card guide-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('guide.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="guide-modal-title">
            <BookOpen size={20} />
            <div>
              <h2>{t('guide.title')}</h2>
              <p className="subtle-text">{t('guide.subtitle')}</p>
            </div>
          </div>
          <button className="icon-button" type="button" aria-label={t('common.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="guide-tabs" role="tablist" aria-label={t('guide.title')}>
          <button type="button" role="tab" aria-selected={tab === 'shortcuts'} className={tab === 'shortcuts' ? 'active' : ''} onClick={() => { setTab('shortcuts'); setHovered(null) }}>
            <Keyboard size={15} />
            {isZh ? '快捷键速查' : 'All Shortcuts'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'camera'} className={tab === 'camera' ? 'active' : ''} onClick={() => { setTab('camera'); setHovered(null) }}>
            <Compass size={15} />
            {isZh ? '视角与选择' : 'Camera & Select'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'move'} className={tab === 'move' ? 'active' : ''} onClick={() => { setTab('move'); setHovered(null) }}>
            <Move size={15} />
            {isZh ? '移动与斜角吸附' : 'Move & Snap'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'rotate'} className={tab === 'rotate' ? 'active' : ''} onClick={() => { setTab('rotate'); setHovered(null) }}>
            <RotateCw size={15} />
            {isZh ? '旋转与防穿模' : 'Rotate & Guard'}
          </button>
        </div>

        <div className="guide-body" onScroll={() => setHovered(null)}>
          {tab === 'shortcuts' && (
            <>
              <p className="guide-hover-hint">
                {isZh ? '将鼠标悬浮在任意快捷键条目上，可实时查看预设 3D 场景的操作效果演示。' : 'Hover any shortcut row to preview a live animated demo from the preset 3D scene.'}
              </p>
              <div className="guide-shortcuts-grid">
                {shortcutGroups.map((group) => (
                  <section key={group.title} className="guide-shortcut-group">
                    <h3>{group.title}</h3>
                    <dl>
                      {group.items.map((item) => (
                        <div
                          key={item.desc}
                          className={`guide-shortcut-row interactive ${hovered?.item.desc === item.desc ? 'active' : ''}`}
                          tabIndex={0}
                          onMouseEnter={(event) => showHoverPreview(item, event.currentTarget)}
                          onMouseLeave={() => setHovered((current) => (current?.item.desc === item.desc ? null : current))}
                          onFocus={(event) => showHoverPreview(item, event.currentTarget)}
                          onBlur={() => setHovered((current) => (current?.item.desc === item.desc ? null : current))}
                        >
                          <dt>
                            {item.keys.map((key) => (
                              <kbd key={key}>{key}</kbd>
                            ))}
                          </dt>
                          <dd>{item.desc}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            </>
          )}

          {tab === 'camera' && (
            <div className="guide-panel">
              <RealSceneDemo demoKey="select" isZh={isZh} />
              <div className="guide-tips-grid">
                <article className="guide-tip-card">
                  <h3>{isZh ? '视角操控' : 'Camera Controls'}</h3>
                  <ul>
                    <li><kbd>{isZh ? '左键拖拽' : 'Left-drag'}</kbd> {isZh ? '旋转镜头观察任意角度' : 'Orbit around the build'}</li>
                    <li><kbd>{isZh ? '右键拖拽' : 'Right-drag'}</kbd> {isZh ? '平移视角' : 'Pan viewport'}</li>
                    <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {isZh ? '未选中零件时自由漫游' : 'Fly when nothing is selected'}</li>
                  </ul>
                </article>
                <article className="guide-tip-card">
                  <h3>{isZh ? '精准选中与固化' : 'Selection & Solidify'}</h3>
                  <ul>
                    <li><kbd>{isZh ? '左键' : 'Click'}</kbd> {isZh ? '选中零件，显示紧贴斜角的蓝色 OBB 选框' : 'Select piece with tight blue OBB outline'}</li>
                    <li><kbd>Shift</kbd> + <kbd>{isZh ? '点击' : 'Click'}</kbd> {isZh ? '多选零件，可一键固化为整体结构' : 'Multi-select pieces & solidify as a rigid group'}</li>
                    <li><kbd>{isZh ? '双击' : 'Double-click'}</kbd> {isZh ? '快速选中整组相互连接的零件' : 'Select entire connected sub-assembly'}</li>
                  </ul>
                </article>
              </div>
            </div>
          )}

          {tab === 'move' && (
            <div className="guide-panel">
              <RealSceneDemo demoKey="move" isZh={isZh} />
              <div className="guide-tips-grid">
                <article className="guide-tip-card">
                  <h3>{isZh ? '键盘精细微调' : 'Keyboard Nudging'}</h3>
                  <ul>
                    <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {isZh ? '按当前视角方向每次移动 0.2 格（长按连发）' : 'Move 0.2 stud along camera direction (hold to repeat)'}</li>
                    <li><kbd>R</kbd> / <kbd>F</kbd> {isZh ? '垂直抬高 / 降低 0.2 格' : 'Raise / lower by 0.2 stud'}</li>
                    <li>{isZh ? '编辑面板支持直接输入精确的 X / Y / Z 装配原点坐标' : 'Type exact X / Y / Z assembly coordinates in Editor'}</li>
                  </ul>
                </article>
                <article className="guide-tip-card">
                  <h3>{isZh ? '斜角自动对齐吸附' : 'Angled Auto-Alignment'}</h3>
                  <ul>
                    <li>{isZh ? '开启顶部「自动吸附」后，将零件拖到斜角城墙或斜向底板上，会自动匹配下方零件角度并严丝合缝吸附凸点' : 'With Auto-Snap enabled, dragging onto an angled wall auto-matches its angle and snaps onto studs'}</li>
                    <li>{isZh ? '关闭「自动吸附」可完全自由悬停定位' : 'Toggle Auto-Snap off for free unconstrained placement'}</li>
                  </ul>
                </article>
              </div>
            </div>
          )}

          {tab === 'rotate' && (
            <div className="guide-panel">
              <RealSceneDemo demoKey="rotate" isZh={isZh} />
              <div className="guide-tips-grid">
                <article className="guide-tip-card">
                  <h3>{isZh ? '90° 与 15° / 任意角度旋转' : '90°, 15° & Arbitrary Angles'}</h3>
                  <ul>
                    <li><kbd>Q</kbd> / <kbd>E</kbd> {isZh ? '水平 / 垂直旋转 90°' : 'Horizontal / vertical 90° turn'}</li>
                    <li><kbd>Shift</kbd> + <kbd>Q</kbd> / <kbd>E</kbd> {isZh ? '按 15° 精细步进旋转' : 'Fine 15° step rotation'}</li>
                    <li>{isZh ? '在右侧编辑面板可直接输入任意角度（如 22.5°、33.7°），单件与固化结构均绕装配基准原地旋转' : 'Type any degree (e.g. 22.5°, 33.7°) in the Editor panel'}</li>
                  </ul>
                </article>
                <article className="guide-tip-card">
                  <h3><ShieldAlert size={14} /> {isZh ? '物理防穿模提示' : 'Physical Collision Guard'}</h3>
                  <ul>
                    <li>{isZh ? '单凸点圆板/跳板可 360° 自由旋转；多凸点零件若歪斜导致边缘凸点顶撞侧壁，系统会自动拦截' : 'Single-stud pivots rotate 360° freely; multi-stud plates hitting a wall are blocked'}</li>
                    <li>{isZh ? '被拦截时，挡路的零件会短暂闪烁红框，输入框显示浅琥珀色提示' : 'When blocked, the obstructing brick flashes a red OBB and the input highlights amber'}</li>
                  </ul>
                </article>
              </div>
            </div>
          )}
        </div>

        {hovered && (
          <aside
            className="guide-hover-popover"
            style={{ left: `${hovered.x}px`, top: `${hovered.y}px` }}
            aria-hidden="true"
          >
            <div className="guide-hover-popover-head">
              <div className="guide-hover-keys">
                {hovered.item.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </div>
              <span>{hovered.item.desc}</span>
            </div>
            <RealSceneDemo demoKey={hovered.item.demo} isZh={isZh} compact />
          </aside>
        )}
      </section>
    </div>
  )
}
