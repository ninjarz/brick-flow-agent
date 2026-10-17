# 乐高套装数字复刻

## 批量复刻：21000、21002、21007

三款均位于「素材库 → 模型 → Classic」，使用原有的加载、手册和主画布编辑流程，零件未预先固化。

| 套装 | 装配件数（不含备用件） | 官方主步骤 | 官方 PDF | OMR 作者 |
| --- | ---: | ---: | --- | --- |
| 21000 西尔斯大厦 | 69 | 17 | [4580893](https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4580893.pdf) | Damien Roux [Darats] |
| 21002 帝国大厦 | 77 | 25 | [4580898](https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4580898.pdf) | Orion Pobursky [OrionP] |
| 21007 洛克菲勒中心 | 240 | 23 | [4632899](https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4632899.pdf) | Damien Roux [Darats] |

原始文件来自 LDraw OMR，位于 `public/lego-replicas/models/`，保留作者与 CC BY 2.0 许可头。`scripts/architectureReplicaSources.json` 固定源文件 SHA-256、逐步零件成员、官方 PDF 页码与总成说明；原始 MPD 中没有步骤的部分，依据官方图示重新标注。`scripts/build-architecture-assets.mjs` 转换为原生可编辑模型，保留具体零件变体与四块原始印刷铭牌。

65 个官方主步骤均已在原有界面回放，并将每步实际场景截图与对应 PDF 图示并列核验。21007 的第 17–23 主步骤按塔楼总成展示，其中第 20 步含第 34–44 页的 21 个内部装配子步骤，第 23 步含第 49–53 页的 10 个子步骤；这些内部子步骤未单独拆成应用页面，不能将主步骤检查记录表述为所有子步骤均已独立回放。

颜色件数：21000 为 black 61、light-gray 6、white 2；21002 为 tan 65、black 6、light-gray 6；21007 为 tan 189、light-gray 39、black 11、pearl-gold 1。西尔斯大厦的双天线是白色，洛克菲勒广场中央圆板为珍珠金色；说明书的深色底板光照不应被当作灰色零件。

补齐了源零件几何中的销孔、空心凸点与板底销连接，以及 1×2 光面板中央空腔连接。首次打开模型手册、加载模型、异步恢复保存素材和画布状态栏检查时，先准备精确几何再执行结构校验，避免以尚未加载的近似形状误报重叠。未关闭碰撞或支撑检查。

重建与验证：

```bash
node scripts/generate-ldraw-structural.mjs > /tmp/architecture-geometry.json
node scripts/build-architecture-assets.mjs /tmp/architecture-geometry.json
npm run generate:part-colors
npm run verify:replicas
npm run validate:builds
npm run audit:ldraw
npm test
npm run lint
npm run build
```

本地截图与逐步核验记录位于忽略的 `docs/replicas/21000/native/`、`21002/native/`、`21007/native/`，批量记录位于 `docs/replicas/batch/`。官方 PDF 仅用于本地比对，不随代码分发。本批未纳入仍存在件数与自由角度兼容性疑点的 21005 流水别墅。

## LEGO 21013 大本钟

在「素材库 → 模型 → Classic」中选择「LEGO 21013 大本钟」，使用与小幽灵、灯塔相同的「加载」「手册」「说明书」。模型有 346 个可编辑零件、52 个官方主步骤；第 51 步包含说明书第 54–58 页的 10 个钟室与尖塔装配子步骤，应用在主步骤中整体展示该总成。零件未预先固化。

[官方手册页面](https://www.lego.com/en-us/service/building-instructions/21013) · [官方 PDF 6115609](https://www.lego.com/cdn/product-assets/product.bi.core.pdf/6115609.pdf)。颜色数量为 tan 264、dark-gray 26、light-gray 25、black 20、white 9、dark-green 2，不包含备用件。

装配来自 Greg Teft 的 [LDraw OMR 21013-1.mpd](https://library.ldraw.org/library/omr/21013-1.mpd)，按 CC BY 2.0 授权；原文件、作者与许可头保留在 `public/lego-replicas/models/21013-1.mpd`。转换脚本展开子模型、保留主步骤，依据生成几何的原点校准坐标，保留 3794b、3044b 和印刷件的具体型号；52 个主步骤已逐步在原有手册中回放并对照官方图示。

模型使用 24 种正交朝向中的侧转姿态，JSON/手册与带元数据的 LDraw 往返保留这些姿态。钟面和铭牌使用原 LDraw 文件中的固定色三角形。补齐了 2×2 板中央管座、1×2 板底部销与空心凸点连接，未通过禁用碰撞或结构检查来载入模型。

重建原生模型（所需零件与依赖已随仓库保存）：

```bash
node scripts/generate-ldraw-structural.mjs > /tmp/architecture-geometry.json
node scripts/build-big-ben-asset.mjs /tmp/architecture-geometry.json
npm test
npm run validate:builds
npm run audit:ldraw
npm run build
```

截图、官方 PDF 与本地核验记录位于忽略的 `docs/replicas/21013/`，不随代码分发。LDraw 库许可和原文件署名保留。

## LEGO 30023 灯塔

在「素材库 → 模型」中选择「LEGO 30023 灯塔」。它与「Classic 小幽灵」共用模型卡片：点击「加载」进入主画布，可以选择、移动、编辑每个零件并撤销；点击「手册」使用原有搭建手册逐步查看。独立复刻查看器已移除。

本款按 LEGO 官方说明书 4650618 独立转录 25 件装配坐标，使用 LDraw 零件几何。原生模型包含 9 个官方步骤，累计件数依次为 2、5、8、12、18、19、20、23、25；不包含备用件。第 1–7 步位于官方 PDF 第 1 页，第 8–9 步位于第 2 页。原有手册保留明确标记的官方步骤，不会按高度重新分组。

[官方页面](https://www.lego.com/en-us/service/building-instructions/30023) · [官方 PDF](https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4650618.pdf)。PDF 不随仓库分发。本地逐步操作记录位于忽略的 `docs/replicas/30023/native/`。

重新生成装配、原生几何及模型：

```bash
python3 scripts/build-lighthouse-replica.py
node scripts/generate-ldraw-structural.mjs > /tmp/lighthouse-geometry.json
node scripts/build-lighthouse-asset.mjs /tmp/lighthouse-geometry.json
npm run verify:replicas
npm run validate:builds
npm test
npm run build
```

## 历史 LDraw 资料

以下六份社区 MPD 及其依赖仍保留在 `public/lego-replicas/` 作为源资料。它们尚未转换成主画布可编辑模型，也未逐步核准与官方手册完全一致，不作为当前模型列表中的复刻成品展示。

| 套装 | LEGO 官方件数 | 数字模型零件实例 | MPD 步骤标记 | 官方说明书 | 数字模型 |
| --- | ---: | ---: | ---: | --- | --- |
| 10030 Imperial Star Destroyer | 3,104 | 3,037 | 593 | [LEGO](https://www.lego.com/en-us/service/building-instructions/10030) | [LDraw OMR](https://library.ldraw.org/omr/sets/308) |
| 8099 Midi-scale Imperial Star Destroyer | 423 | 418 | 117 | [LEGO](https://www.lego.com/en-us/service/building-instructions/8099) | [LDraw MPD](https://library.ldraw.org/library/omr/8099-1.mpd) |
| 10124 Wright Flyer | 666 | 677 | 105 | [LEGO](https://www.lego.com/en-us/service/building-instructions/10124) | [LDraw OMR](https://library.ldraw.org/omr/sets/1145) |
| 10182 Café Corner | 2,058 | 2,417 | 242 | [LEGO](https://www.lego.com/en-us/service/building-instructions/10182) | [LDraw OMR](https://library.ldraw.org/omr/sets/865) |
| 10258 London Bus | 1,686 | 1,682 | 102 | [LEGO](https://www.lego.com/en-us/service/building-instructions/10258) | [LDraw OMR](https://library.ldraw.org/omr/sets/871) |
| 10134 Y-wing Attack Starfighter | 1,489 | 1,493 | 168 | [LEGO](https://www.lego.com/en-us/service/building-instructions/10134) | [LDraw OMR](https://library.ldraw.org/omr/sets/322) |


六款作者依次为 Roland Dahl、Orion Pobursky、Marc Giraudet、Max Martin Richter、Philippe Hurbain、Roland Dahl。表中实例数、STEP 标记不等于官方件数或 PDF 步数。保留这些差异，不能据此宣称完整复刻。

重建归档依赖时，下载 LDraw 完整零件库与上述 MPD，按 `<编号>-1.mpd` 命名，然后执行：

```bash
python3 scripts/prepare-lego-replicas.py /path/to/complete.zip /path/to/mpds
npm run verify:replicas
```

校验脚本核对 SHA-256、模型实例数、STEP 标记及递归零件依赖。

## 授权

六份社区 MPD 按文件头 CC BY 2.0 授权；独立编写的 30023 装配文件按 CC BY 4.0 授权。LDraw 零件几何按各文件头的 CC BY 2.0、CC BY 4.0 或两者授权，原作者、许可头及许可文本均保留。LEGO 官方说明书只提供链接，不再分发 PDF。LEGO® 为 LEGO Group 的商标。
