# 积流工坊

> 一个运行在浏览器里的砖块类搭建工作台，结合零件包、LDraw 几何、结构体素和可选的 LLM 生成能力

[English README](../README.md) | 中文文档

积流工坊（brick-flow-agent）可以把提示词、导入方案和手动编辑的布局变成可交互的 3D 搭建工作区。项目的目标是把不同砖块类体系放进同一个编辑器：当前以 LEGO-compatible LDraw 零件为主，下一步扩展 Minecraft 风格体素方块，之后可以继续接入更多零件包

项目使用 React + Three.js 构建编辑器，使用 LDraw 数据渲染零件，并通过连接点、结构体素、碰撞和支撑规则来校验模型；同时支持素材库、体素调试、搭建手册预览和 Markdown/HTML/JSON 导出

## ✨ 功能亮点

- 通过 OpenAI-compatible 接口按提示词生成搭建方案
- 默认支持浏览器直连 LLM，适合纯静态部署；也支持本地代理绕过 CORS
- 支持零件包切换，目前有 LEGO-compatible LDraw 包和早期 Minecraft 包
- 使用 LDraw 数据生成零件视觉和结构数据
- 支持积木级编辑：添加、选择、移动、旋转、换色、复制、删除、导入、导出
- 支持 stud、tube、bar、pin、axle 和双向连接面等连接语义的校验
- 支持结构体素调试视图，可查看 solid、socket、stud、双向连接面、enterable 等单元
- 内置成品素材库，并支持本地保存用户素材
- 搭建手册按“一步一个零件”生成，支持预览、复制 Markdown、导出 HTML/Markdown/JSON
- 中英文 UI，默认跟随浏览器语言，也可以在配置里手动切换

<p align="center">
  <img src="../preview/classic-ghost-demo.png" alt="Classic 小幽灵 demo 预览" width="420">
  <img src="../preview/build-manual.png" alt="搭建手册预览" width="420">
</p>

## 🧱 零件包

- **LEGO-compatible 包：** 当前主要零件包。尽可能使用内置 LDraw 数据生成视觉和结构信息，并通过回归测试覆盖官方颜色数据、连接点位置、碰撞、支撑和默认素材
- **Minecraft 包：** 早期体素优先零件包。目前包含一个基础 `1 x 1 x 1` 方块

## 🚀 快速开始

```bash
npm install
npm run dev
```

打开终端中显示的 Vite 地址，通常是：

```text
http://127.0.0.1:5173/
```

## 🛠️ 构建

```bash
npm run build
npm run preview
```

如果 LLM 使用浏览器直连模式，并且接口支持 CORS，生产构建可以作为纯静态前端部署

## 🧪 开发脚本

```bash
npm run dev                  # 启动 Vite
npm run build                # 类型检查并构建
npm run lint                 # 运行 ESLint
npm run validate:builds      # 校验默认素材和回归用例
npm run profile:performance  # 性能分析
```

## 🤖 LLM 配置

在应用内打开 **配置**，填写：

<p align="center">
  <img src="../preview/llm-config.png" alt="LLM 配置界面预览" width="320">
</p>

- API endpoint：OpenAI-compatible chat completions 地址
- API key：只保存在本地浏览器
- Model name：接口支持的模型名
- Request mode：浏览器直连或本地代理
- Thinking mode：思考模式，默认关闭，让生成更快也更稳定

## 🧩 零件维护

新增或修正零件时应基于真实资料：

1. 先看官方 LDraw `.dat`、subpart 和 primitive 数据
2. 外形有争议时，对照 LEGO 官方图或说明书图片
3. 保留真实零件号、尺寸、连接点语义和回归测试
4. 修改 LDraw 生成数据后运行 `npm run generate:ldraw` 和 `npm run validate:builds`

对于非 LEGO 零件包，应优先定义清晰的结构语义，而不是硬套 LEGO 的 stud/tube 规则。例如 Minecraft 基础方块使用 `studsocket` 双向面连接器：方块保持完整实心，同时又能支持面对面连接

## 🤝 参与贡献

欢迎 issue 和 patch。比较有价值的贡献方向包括：

- 改进优化 agent 能力
- 迭代零件库，修正错误数据
- 素材库库存管理功能
- 制作素材库 demo
- 导入导出多格式兼容
- 性能优化

提交前建议运行：

```bash
npm run lint
npm run build
npm run validate:builds
```

如果 `validate:builds` 因为已知 demo 回归失败，请在 PR 说明里明确写出来

## 🙏 特别鸣谢

- [LDraw](https://ldraw.org/)：开放的零件几何、primitive 和社区维护的零件库，是 LDraw 零件包的基础
- [Rebrickable](https://rebrickable.com/downloads/)：公开的 element 和 color 数据，用于生成粗粒度官方颜色可用性
