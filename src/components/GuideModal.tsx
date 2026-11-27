import { BookOpen, Compass, Keyboard, Move, RotateCw, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../lib/i18n'

type GuideTab = 'camera' | 'move' | 'rotate' | 'shortcuts'

type GuideModalProps = {
  onClose: () => void
}

const CameraDemoSvg = ({ isZh }: { isZh: boolean }) => (
  <svg className="guide-demo-svg" viewBox="0 0 360 190" role="img" aria-label={isZh ? '视角控制与多选动图演示' : 'Camera and multi-select animation'}>
    <defs>
      <pattern id="guide-grid-cam" width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dbeafe" strokeWidth="1" />
      </pattern>
    </defs>
    <rect width="360" height="190" rx="10" fill="#f8fafc" />
    <rect x="12" y="12" width="336" height="166" rx="8" fill="url(#guide-grid-cam)" />
    {/* Orbiting brick assembly */}
    <g className="demo-orbit-group">
      <rect x="125" y="76" width="54" height="32" rx="4" fill="#3b82f6" stroke="#1e3a8a" strokeWidth="1.5" />
      <circle cx="141" cy="92" r="6" fill="#60a5fa" stroke="#1e3a8a" strokeWidth="1.2" />
      <circle cx="163" cy="92" r="6" fill="#60a5fa" stroke="#1e3a8a" strokeWidth="1.2" />
      {/* Single select blue OBB */}
      <rect className="demo-blue-obb" x="120" y="71" width="64" height="42" rx="5" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeDasharray="6 3" />

      <rect x="184" y="76" width="54" height="32" rx="4" fill="#eab308" stroke="#854d0e" strokeWidth="1.5" />
      <circle cx="200" cy="92" r="6" fill="#fde047" stroke="#854d0e" strokeWidth="1.2" />
      <circle cx="222" cy="92" r="6" fill="#fde047" stroke="#854d0e" strokeWidth="1.2" />
      {/* Multi-select yellow OBB */}
      <rect className="demo-yellow-obb" x="179" y="71" width="64" height="42" rx="5" fill="none" stroke="#f59e0b" strokeWidth="2.2" />
    </g>
    {/* Animated pointer cursor */}
    <g className="demo-cursor-select">
      <path d="M0 0 L0 16 L4.5 12.5 L8 19 L10.5 17.6 L7 11 L12.5 11 Z" fill="#0f172a" stroke="#fff" strokeWidth="1.2" />
    </g>
    <rect x="20" y="144" width="320" height="24" rx="6" fill="rgba(255,255,255,0.9)" stroke="#e2e8f0" />
    <text x="180" y="160" textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155">
      {isZh ? '左键单选（蓝框）· Shift+点击多选（黄框）· 双击选中整组连通结构' : 'Click (Blue OBB) · Shift+Click Multi-select (Yellow) · Double-click Connected'}
    </text>
  </svg>
)

const MoveSnapDemoSvg = ({ isZh }: { isZh: boolean }) => (
  <svg className="guide-demo-svg" viewBox="0 0 360 190" role="img" aria-label={isZh ? '斜角自动对齐吸附动图演示' : 'Angled stud auto-alignment animation'}>
    <defs>
      <pattern id="guide-grid-move" width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dbeafe" strokeWidth="1" />
      </pattern>
    </defs>
    <rect width="360" height="190" rx="10" fill="#f8fafc" />
    <rect x="12" y="12" width="336" height="166" rx="8" fill="url(#guide-grid-move)" />
    {/* Target angled 33.7 deg wall */}
    <g transform="translate(228 84) rotate(33.7)">
      <rect x="-46" y="-15" width="92" height="30" rx="4" fill="#d6c5a3" stroke="#78716c" strokeWidth="1.5" />
      <circle cx="-30" cy="0" r="6" fill="#e7dcc5" stroke="#78716c" strokeWidth="1.2" />
      <circle cx="0" cy="0" r="6" fill="#e7dcc5" stroke="#78716c" strokeWidth="1.2" />
      <circle cx="30" cy="0" r="6" fill="#e7dcc5" stroke="#78716c" strokeWidth="1.2" />
    </g>
    <text x="275" y="42" fontSize="10.5" fontWeight="800" fill="#64748b">33.7°</text>
    {/* Dragged brick auto-aligning to 33.7 deg and snapping */}
    <g className="demo-angled-snap-brick">
      <rect x="-46" y="-15" width="92" height="30" rx="4" fill="#64748b" stroke="#0f172a" strokeWidth="1.5" />
      <circle cx="-30" cy="0" r="6" fill="#94a3b8" stroke="#0f172a" strokeWidth="1.2" />
      <circle cx="0" cy="0" r="6" fill="#94a3b8" stroke="#0f172a" strokeWidth="1.2" />
      <circle cx="30" cy="0" r="6" fill="#94a3b8" stroke="#0f172a" strokeWidth="1.2" />
      <rect x="-50" y="-19" width="100" height="38" rx="5" fill="none" stroke="#38bdf8" strokeWidth="2" />
    </g>
    <rect x="20" y="144" width="320" height="24" rx="6" fill="rgba(255,255,255,0.9)" stroke="#e2e8f0" />
    <text x="180" y="160" textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155">
      {isZh ? '拖到斜角砖块上方时，自动匹配 33.7° 朝向并吸附凸点' : 'Drag over an angled wall to auto-align to 33.7° and snap onto studs'}
    </text>
  </svg>
)

const RotateCollisionDemoSvg = ({ isZh }: { isZh: boolean }) => (
  <svg className="guide-demo-svg" viewBox="0 0 360 190" role="img" aria-label={isZh ? '任意角度旋转与凸点碰撞拦截动图演示' : 'Arbitrary angle rotation and stud collision guard animation'}>
    <defs>
      <pattern id="guide-grid-rot" width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dbeafe" strokeWidth="1" />
      </pattern>
    </defs>
    <rect width="360" height="190" rx="10" fill="#f8fafc" />
    <rect x="12" y="12" width="336" height="166" rx="8" fill="url(#guide-grid-rot)" />
    {/* Left: 1x1 pivot smooth 15-deg rotation */}
    <g transform="translate(104 82)">
      <circle cx="0" cy="0" r="14" fill="#cbd5e1" stroke="#475569" strokeWidth="1.5" />
      <g className="demo-pivot-rotate">
        <rect x="-42" y="-13" width="84" height="26" rx="4" fill="#3b82f6" stroke="#1e3a8a" strokeWidth="1.5" />
        <circle cx="-28" cy="0" r="5" fill="#93c5fd" stroke="#1e3a8a" strokeWidth="1.2" />
        <circle cx="0" cy="0" r="5" fill="#93c5fd" stroke="#1e3a8a" strokeWidth="1.2" />
        <circle cx="28" cy="0" r="5" fill="#93c5fd" stroke="#1e3a8a" strokeWidth="1.2" />
        <rect x="-46" y="-17" width="92" height="34" rx="5" fill="none" stroke="#38bdf8" strokeWidth="2" />
      </g>
      <text x="0" y="45" textAnchor="middle" fontSize="10.5" fontWeight="800" fill="#16a34a">
        {isZh ? '单点轴心：15°/任意角 ✓' : '1-stud pivot: 15° / any ✓'}
      </text>
    </g>
    {/* Right: multi-stud misaligned collision blocked with red OBB flash */}
    <g transform="translate(256 82)">
      <rect x="-42" y="-13" width="84" height="26" rx="4" fill="#94a3b8" stroke="#334155" strokeWidth="1.5" />
      <circle cx="-28" cy="0" r="5" fill="#cbd5e1" stroke="#334155" strokeWidth="1.2" />
      <circle cx="0" cy="0" r="5" fill="#cbd5e1" stroke="#334155" strokeWidth="1.2" />
      <circle cx="28" cy="0" r="5" fill="#cbd5e1" stroke="#334155" strokeWidth="1.2" />
      <rect className="demo-red-blocker" x="-47" y="-18" width="94" height="36" rx="5" fill="none" stroke="#ef4444" strokeWidth="2.5" />
      <g className="demo-blocked-twist">
        <rect x="-42" y="-13" width="84" height="26" rx="4" fill="#64748b" fillOpacity="0.88" stroke="#0f172a" strokeWidth="1.5" />
        <circle cx="0" cy="0" r="5" fill="#cbd5e1" stroke="#0f172a" strokeWidth="1.2" />
      </g>
      <text x="0" y="45" textAnchor="middle" fontSize="10.5" fontWeight="800" fill="#dc2626">
        {isZh ? '凸点顶撞侧壁：红框拦截 ✕' : 'Stud hits wall: Blocked ✕'}
      </text>
    </g>
    <rect x="20" y="144" width="320" height="24" rx="6" fill="rgba(255,255,255,0.9)" stroke="#e2e8f0" />
    <text x="180" y="160" textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155">
      {isZh ? 'Q/E 按 90° 旋转 · Shift+Q/E 按 15° 微调 · 碰撞时红框闪烁提示阻挡件' : 'Q/E 90° · Shift+Q/E 15° · Red OBB flashes the blocking brick on collision'}
    </text>
  </svg>
)

export const GuideModal = ({ onClose }: GuideModalProps) => {
  const { locale, t } = useI18n()
  const isZh = locale === 'zh-CN'
  const [tab, setTab] = useState<GuideTab>('camera')

  const shortcutGroups = [
    {
      title: isZh ? '视角与画布' : 'Camera & Viewport',
      items: [
        { keys: [isZh ? '左键拖拽空白' : 'Left-drag'], desc: isZh ? '围绕模型自由旋转视角' : 'Orbit camera around model' },
        { keys: [isZh ? '右键拖拽' : 'Right-drag'], desc: isZh ? '平移画布视角' : 'Pan camera' },
        { keys: [isZh ? '滚轮' : 'Scroll'], desc: isZh ? '缩放远近' : 'Zoom in / out' },
        { keys: ['W', 'A', 'S', 'D'], desc: isZh ? '未选中零件时，沿当前朝向漫游镜头' : 'Fly camera horizontally when nothing is selected' },
      ],
    },
    {
      title: isZh ? '选择与固化结构' : 'Selection & Structures',
      items: [
        { keys: [isZh ? '左键点击' : 'Click'], desc: isZh ? '选中单个零件或已固化结构（紧贴蓝框）' : 'Select brick or solidified structure (blue OBB)' },
        { keys: ['Shift', isZh ? '点击' : 'Click'], desc: isZh ? '加选 / 取消多选多个零件（黄框）' : 'Add / toggle bricks in multi-selection (yellow OBB)' },
        { keys: [isZh ? '双击零件' : 'Double-click'], desc: isZh ? '选中一整块连通的拼装结构' : 'Select entire connected assembly' },
        { keys: ['Esc'], desc: isZh ? '取消放置 / 关闭弹窗 / 退出当前操作' : 'Cancel placement / close active modal' },
      ],
    },
    {
      title: isZh ? '移动、吸附与旋转' : 'Move, Snap & Rotate',
      items: [
        { keys: ['W', 'A', 'S', 'D'], desc: isZh ? '选中后按镜头方向水平微调（0.2 格，长按连发）' : 'Nudge selected horizontally (0.2 stud, hold to repeat)' },
        { keys: ['R', 'F'], desc: isZh ? '选中后垂直抬高 / 降低（0.2 格）' : 'Raise / lower selected brick (0.2 stud)' },
        { keys: ['Q', 'E'], desc: isZh ? '水平 / 垂直顺时针旋转 90°' : 'Rotate horizontal / vertical by 90°' },
        { keys: ['Shift', 'Q / E'], desc: isZh ? '水平 / 垂直精细旋转 15°（支持单件与固化结构）' : 'Fine rotate horizontal / vertical by 15°' },
        { keys: [isZh ? '左键拖拽选中件' : 'Drag selected'], desc: isZh ? '拖动并自动吸附凸点，遇到斜角结构自动对齐角度' : 'Drag with stud snapping & auto-align to angled bricks' },
        { keys: ['Backspace'], desc: isZh ? '删除当前选中的零件或整组选区' : 'Delete selected brick(s)' },
      ],
    },
    {
      title: isZh ? '撤销与快捷工具' : 'History & Tools',
      items: [
        { keys: ['⌘ / Ctrl', 'Z'], desc: isZh ? '撤销上一步拼装或编辑' : 'Undo last edit' },
        { keys: ['⌘ / Ctrl', 'Shift', 'Z'], desc: isZh ? '重做已撤销的操作' : 'Redo edit' },
        { keys: [isZh ? '拖入文件' : 'Drop file'], desc: isZh ? '直接拖入 JSON / LDR / MPD / OBJ 模型文件' : 'Drop JSON / LDR / MPD / OBJ directly into workspace' },
      ],
    },
  ]

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
          <button type="button" role="tab" aria-selected={tab === 'camera'} className={tab === 'camera' ? 'active' : ''} onClick={() => setTab('camera')}>
            <Compass size={15} />
            {isZh ? '视角与选择' : 'Camera & Select'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'move'} className={tab === 'move' ? 'active' : ''} onClick={() => setTab('move')}>
            <Move size={15} />
            {isZh ? '移动与斜角吸附' : 'Move & Snap'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'rotate'} className={tab === 'rotate' ? 'active' : ''} onClick={() => setTab('rotate')}>
            <RotateCw size={15} />
            {isZh ? '旋转与防穿模' : 'Rotate & Guard'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'shortcuts'} className={tab === 'shortcuts' ? 'active' : ''} onClick={() => setTab('shortcuts')}>
            <Keyboard size={15} />
            {isZh ? '快捷键速查' : 'All Shortcuts'}
          </button>
        </div>

        <div className="guide-body">
          {tab === 'camera' && (
            <div className="guide-panel">
              <CameraDemoSvg isZh={isZh} />
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
              <MoveSnapDemoSvg isZh={isZh} />
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
              <RotateCollisionDemoSvg isZh={isZh} />
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

          {tab === 'shortcuts' && (
            <div className="guide-shortcuts-grid">
              {shortcutGroups.map((group) => (
                <section key={group.title} className="guide-shortcut-group">
                  <h3>{group.title}</h3>
                  <dl>
                    {group.items.map((item) => (
                      <div key={item.desc} className="guide-shortcut-row">
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
          )}
        </div>
      </section>
    </div>
  )
}
