# 乐高套装数字复刻

在素材库中打开「乐高复刻」，可查看完整三维模型、旋转缩放、按 LDraw 步骤标记回放，并打开 LEGO 官方说明书进行人工对照。「聚焦当前」可放大正在检查的阶段。数字模型与零件定义已随应用打包，查看模型不依赖第三方服务。10030 在本机 Chrome 的首次解析约 45–50 秒，界面会显示等待提示。

| 套装 | LEGO 官方件数 | 数字模型零件实例 | MPD 步骤标记 | 官方说明书 | 数字模型 |
| --- | ---: | ---: | ---: | --- | --- |
| 10030 Imperial Star Destroyer | 3,104 | 3,037 | 593 | [LEGO](https://www.lego.com/en-us/service/building-instructions/10030) | [LDraw OMR](https://library.ldraw.org/omr/sets/308) |
| 8099 Midi-scale Imperial Star Destroyer | 423 | 418 | 117 | [LEGO](https://www.lego.com/en-us/service/building-instructions/8099) | [LDraw MPD](https://library.ldraw.org/library/omr/8099-1.mpd) |
| 10124 Wright Flyer | 666 | 677 | 105 | [LEGO](https://www.lego.com/en-us/service/building-instructions/10124) | [LDraw OMR](https://library.ldraw.org/omr/sets/1145) |
| 10182 Café Corner | 2,058 | 2,417 | 242 | [LEGO](https://www.lego.com/en-us/service/building-instructions/10182) | [LDraw OMR](https://library.ldraw.org/omr/sets/865) |
| 10258 London Bus | 1,686 | 1,682 | 102 | [LEGO](https://www.lego.com/en-us/service/building-instructions/10258) | [LDraw OMR](https://library.ldraw.org/omr/sets/871) |
| 10134 Y-wing Attack Starfighter | 1,489 | 1,493 | 168 | [LEGO](https://www.lego.com/en-us/service/building-instructions/10134) | [LDraw OMR](https://library.ldraw.org/omr/sets/322) |

数字模型是 LDraw 社区制作的 MPD，六款作者依次为 Roland Dahl、Orion Pobursky、Marc Giraudet、Max Martin Richter、Philippe Hurbain、Roland Dahl。模型和 LEGO 官方说明书分别来自上表的原始来源。模型按 MPD 子模型及 `STEP` 标记回放；浏览器中展开重复子模型后得到的回放阶段数可能多于 MPD 文件里的标记数，也不等于官方 PDF 页码。数字模型的实例计数与 LEGO 官方件数不一致；原因没有逐件核准，因此界面分别展示两种统计，未将它们视为完全一致。

已下载并抽查原有三份官方说明书的封面与中间步骤页：10030 为 228 页，8099 为 48 页，10124 为 68 页。新增三款均核对了 LEGO 官方说明书页面；10182 分为两册（48、76 页），10258 与 10134 各一册。PDF 没有放入仓库。

浏览器视图是独立的完整装配预览，不会把数千个复杂零件送入当前编辑器的碰撞与体素系统。现有编辑器只覆盖少量零件及部分旋转，直接导入会丢失零件与姿态。此视图用于模型和说明书验收，不能在编辑器里逐块改动或做结构仿真。

LDraw OMR 将 10030、10258 和 10134 标记为缺少贴纸，但零件与印刷图案齐全。三维模型外观因此可能与带贴纸的实物略有差别。候选 10143 虽有 3,449 件，但其 OMR 模型没有 `STEP` 标记，因此未加入这个以步骤回放为核心的画廊。

## 复现与校验

官方说明书 PDF 不放入仓库；可从上表的 LEGO 页面下载。LDraw MPD 和所需零件已放在 `public/lego-replicas/`。需要重建资源时，下载 [LDraw 完整零件库](https://library.ldraw.org/library/updates/complete.zip) 与上表六个 MPD，按套装编号命名为 `<编号>-1.mpd` 并放在同一目录，然后执行：

```bash
python3 scripts/prepare-lego-replicas.py /path/to/complete.zip /path/to/mpds
npm run verify:replicas
```

校验脚本会核对 MPD 的 SHA-256、模型实例数、步骤标记、每个零件的递归依赖及实际文件。当前裁剪零件库有 1,205 个依赖文件，模型与库合计约 8.5 MB。浏览器回归检查应确认六款模型加载后没有缺失文件、控制条可播放，10030 在目标设备上能够旋转。10258 的 MPD 内嵌子零件名使用反斜杠；加载时会在内存中规范化文件名，仓库中的原始 MPD 保持不变。

## 授权

六个 MPD 的文件头标为 `CCAL version 2.0`，即 CC BY 2.0。LDraw 零件库文件分别按文件头标明的 CC BY 2.0、CC BY 4.0 或两者授权；作者信息与许可文本保留在原文件及 `public/lego-replicas/CAreadme.txt`、`CAlicense.txt`、`CAlicense4.txt`。仓库对源 MPD 与零件几何文件仅做选取和打包，未改写内容。LEGO 官方说明书只通过链接展示，没有再分发 PDF。LEGO® 为 LEGO Group 的商标，LDraw 社区模型不代表 LEGO 官方授权。
