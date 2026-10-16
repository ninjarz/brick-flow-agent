# 乐高套装数字复刻

## 当前模型：LEGO 30023 灯塔

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
