import { BookOpen, Compass, Keyboard, Move, RotateCw, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { GuideDemoCanvas, type GuideDemoMode } from './GuideDemoCanvas'

type GuideTab = 'shortcuts' | 'camera' | 'move' | 'rotate'

type GuideModalProps = {
  onClose: () => void
}

type ShortcutItem = {
  keys: string[]
  desc: string
  mode: GuideDemoMode
  badgeZh: string
  badgeEn: string
}

export const GuideModal = ({ onClose }: GuideModalProps) => {
  const { locale, t } = useI18n()
  const isZh = locale === 'zh-CN'
  const [tab, setTab] = useState<GuideTab>('shortcuts')
  const [cameraSubMode, setCameraSubMode] = useState<GuideDemoMode>('orbit')
  const [moveSubMode, setMoveSubMode] = useState<GuideDemoMode>('angledSnap')
  const [rotateSubMode, setRotateSubMode] = useState<GuideDemoMode>('rotate15')
  const [hovered, setHovered] = useState<{ item: ShortcutItem; x: number; y: number } | null>(null)

  const shortcutGroups: { title: string; items: ShortcutItem[] }[] = [
    {
      title: isZh ? '视角与画布' : 'Camera & Viewport',
      items: [
        { keys: [isZh ? '左键拖拽空白' : 'Left-drag'], desc: isZh ? '围绕模型自由旋转 360° 视角' : 'Orbit camera 360° around model', mode: 'orbit', badgeZh: '360° 环绕旋转', badgeEn: '360° Orbit' },
        { keys: [isZh ? '右键拖拽' : 'Right-drag'], desc: isZh ? '平移画布视角' : 'Pan camera', mode: 'pan', badgeZh: '右键平移视角', badgeEn: 'Right-drag Pan' },
        { keys: [isZh ? '滚轮' : 'Scroll'], desc: isZh ? '缩放远近' : 'Zoom in / out', mode: 'zoom', badgeZh: '滚轮推拉缩放', badgeEn: 'Scroll Zoom' },
        { keys: ['W', 'A', 'S', 'D'], desc: isZh ? '未选中零件时，沿当前朝向漫游镜头' : 'Fly camera horizontally when nothing is selected', mode: 'fly', badgeZh: '镜头漫游', badgeEn: 'Camera Fly' },
      ],
    },
    {
      title: isZh ? '选择与固化结构' : 'Selection & Structures',
      items: [
        { keys: [isZh ? '左键点击' : 'Click'], desc: isZh ? '选中单个零件或已固化结构（紧贴蓝框）' : 'Select brick or solidified structure (blue OBB)', mode: 'select', badgeZh: '单选蓝框', badgeEn: 'Single Blue OBB' },
        { keys: ['Shift', isZh ? '点击' : 'Click'], desc: isZh ? '加选 / 取消多选多个零件（黄框）' : 'Add / toggle bricks in multi-selection (yellow OBB)', mode: 'multiselect', badgeZh: 'Shift 多选黄框', badgeEn: 'Multi-Select' },
        { keys: [isZh ? '双击零件' : 'Double-click'], desc: isZh ? '选中一整块连通的拼装结构' : 'Select entire connected assembly', mode: 'connected', badgeZh: '双击选整组', badgeEn: 'Connected Group' },
        { keys: ['Esc'], desc: isZh ? '取消放置 / 关闭弹窗 / 退出当前操作' : 'Cancel placement / close active modal', mode: 'select', badgeZh: '退出 / 取消', badgeEn: 'Cancel / Close' },
      ],
    },
    {
      title: isZh ? '移动、吸附与旋转' : 'Move, Snap & Rotate',
      items: [
        { keys: ['W', 'A', 'S', 'D'], desc: isZh ? '选中后按镜头方向水平微调（0.2 格，长按连发）' : 'Nudge selected horizontally (0.2 stud, hold to repeat)', mode: 'nudge', badgeZh: 'WASD 水平微调', badgeEn: 'WASD Nudge' },
        { keys: ['R', 'F'], desc: isZh ? '选中后垂直抬高 / 降低（0.2 格）' : 'Raise / lower selected brick (0.2 stud)', mode: 'lift', badgeZh: 'R / F 升降', badgeEn: 'R / F Lift' },
        { keys: ['Q', 'E'], desc: isZh ? '水平 / 垂直顺时针旋转 90°' : 'Rotate horizontal / vertical by 90°', mode: 'rotate90', badgeZh: '90° 旋转', badgeEn: '90° Turn' },
        { keys: ['Shift', 'Q / E'], desc: isZh ? '水平 / 垂直精细旋转 15°（支持单件与固化结构）' : 'Fine rotate horizontal / vertical by 15°', mode: 'rotate15', badgeZh: '15° 精细步进', badgeEn: '15° Fine Step' },
        { keys: [isZh ? '左键拖拽选中件' : 'Drag selected'], desc: isZh ? '拖动并自动吸附凸点，遇到斜角结构自动对齐角度' : 'Drag with stud snapping & auto-align to angled bricks', mode: 'angledSnap', badgeZh: '33.7° 斜角自动对齐', badgeEn: 'Angled Auto-Snap' },
        { keys: ['Backspace'], desc: isZh ? '删除当前选中的零件或整组选区' : 'Delete selected brick(s)', mode: 'undo', badgeZh: '删除 / 撤销', badgeEn: 'Delete / Undo' },
      ],
    },
    {
      title: isZh ? '撤销与快捷工具' : 'History & Tools',
      items: [
        { keys: ['⌘ / Ctrl', 'Z'], desc: isZh ? '撤销上一步拼装或编辑' : 'Undo last edit', mode: 'undo', badgeZh: '撤销恢复', badgeEn: 'Undo' },
        { keys: ['⌘ / Ctrl', 'Shift', 'Z'], desc: isZh ? '重做已撤销的操作' : 'Redo edit', mode: 'undo', badgeZh: '重做操作', badgeEn: 'Redo' },
        { keys: [isZh ? '拖入文件' : 'Drop file'], desc: isZh ? '直接拖入 JSON / LDR / MPD / OBJ 模型文件' : 'Drop JSON / LDR / MPD / OBJ directly into workspace', mode: 'orbit', badgeZh: '拖入导入模型', badgeEn: 'Drop to Import' },
      ],
    },
  ]

  const showHoverPreview = (item: ShortcutItem, target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    const previewW = 420
    const previewH = 290
    const margin = 12
    const x = Math.min(Math.max(margin, rect.left + rect.width / 2 - previewW / 2), window.innerWidth - previewW - margin)
    const above = rect.top - previewH - 12
    const y = above >= margin ? above : Math.min(rect.bottom + 12, window.innerHeight - previewH - margin)
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
                {isZh ? '将鼠标悬浮在任意按键条目上，实时弹出 3D 砖块近景操作演示。' : 'Hover any shortcut row to preview a live close-up 3D brick animation.'}
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
              <div className="guide-demo-switcher">
                {([
                  ['orbit', isZh ? '左键 360° 旋转视角' : '360° Orbit'],
                  ['pan', isZh ? '右键平移' : 'Right-drag Pan'],
                  ['zoom', isZh ? '滚轮缩放' : 'Scroll Zoom'],
                  ['select', isZh ? '单选蓝框' : 'Single Select'],
                  ['multiselect', isZh ? 'Shift 多选黄框' : 'Multi-Select'],
                ] as const).map(([m, label]) => (
                  <button key={m} type="button" className={cameraSubMode === m ? 'active' : ''} onClick={() => setCameraSubMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
              <GuideDemoCanvas
                mode={cameraSubMode}
                caption={
                  cameraSubMode === 'orbit'
                    ? (isZh ? '按住左键拖拽空白处，围绕砖块 360° 旋转观察' : 'Left-drag empty space to orbit 360° around the brick')
                    : cameraSubMode === 'pan'
                      ? (isZh ? '按住右键拖拽平移视角' : 'Right-drag to pan the viewport')
                      : cameraSubMode === 'zoom'
                        ? (isZh ? '滚动滚轮拉近或拉远视角' : 'Scroll wheel to zoom in or out')
                        : cameraSubMode === 'select'
                          ? (isZh ? '左键点击零件，显示紧贴砖块的蓝色 OBB 选框' : 'Click a brick to select it with a tight blue OBB')
                          : (isZh ? '按住 Shift 点击多个零件，显示黄色多选框并可固化为整体' : 'Shift+Click multiple bricks for yellow OBB multi-selection')
                }
              />
              <div className="guide-tips-grid">
                <article className="guide-tip-card">
                  <h3>{isZh ? '视角操控' : 'Camera Controls'}</h3>
                  <ul>
                    <li><kbd>{isZh ? '左键拖拽' : 'Left-drag'}</kbd> {isZh ? '围绕砖块 360° 自由旋转视角' : 'Orbit 360° around the build'}</li>
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
              <div className="guide-demo-switcher">
                {([
                  ['angledSnap', isZh ? '斜角 33.7° 自动对齐吸附' : '33.7° Angled Auto-Snap'],
                  ['nudge', isZh ? 'WASD 水平微调' : 'WASD Nudge'],
                  ['lift', isZh ? 'R / F 垂直升降' : 'R / F Lift'],
                ] as const).map(([m, label]) => (
                  <button key={m} type="button" className={moveSubMode === m ? 'active' : ''} onClick={() => setMoveSubMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
              <GuideDemoCanvas
                mode={moveSubMode}
                caption={
                  moveSubMode === 'angledSnap'
                    ? (isZh ? '拖到 33.7° 斜角砖块上方时，自动对齐朝向并吸合凸点' : 'Drag over a 33.7° angled brick to auto-align and snap onto studs')
                    : moveSubMode === 'nudge'
                      ? (isZh ? '按 W A S D 沿镜头方向水平步进微调（0.2 格）' : 'Press W A S D to nudge horizontally by 0.2 stud')
                      : (isZh ? '按 R / F 垂直抬高或降低砖块（0.2 格）' : 'Press R / F to raise or lower by 0.2 stud')
                }
              />
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
              <div className="guide-demo-switcher">
                {([
                  ['rotate15', isZh ? 'Shift + Q 15° 精细旋转' : 'Shift + Q 15° Step'],
                  ['rotate90', isZh ? 'Q 90° 快速旋转' : 'Q 90° Turn'],
                  ['collision', isZh ? '凸点干涉红框拦截' : 'Stud Collision Guard'],
                ] as const).map(([m, label]) => (
                  <button key={m} type="button" className={rotateSubMode === m ? 'active' : ''} onClick={() => setRotateSubMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
              <GuideDemoCanvas
                mode={rotateSubMode}
                caption={
                  rotateSubMode === 'rotate15'
                    ? (isZh ? '单凸点轴心上按 Shift + Q 按 15° 精细旋转' : 'Press Shift + Q on a 1-stud pivot for 15° fine turns')
                    : rotateSubMode === 'rotate90'
                      ? (isZh ? '按 Q / E 绕装配原点 90° 旋转' : 'Press Q / E for crisp 90° turns around assembly origin')
                      : (isZh ? '多凸点歪斜顶撞侧壁时自动拦截，下方阻挡件闪烁红框' : 'Misaligned multi-stud twist is blocked with red OBB flash')
                }
              />
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
            <GuideDemoCanvas
              mode={hovered.item.mode}
              badge={isZh ? hovered.item.badgeZh : hovered.item.badgeEn}
              caption={hovered.item.desc}
              compact
            />
          </aside>
        )}
      </section>
    </div>
  )
}
