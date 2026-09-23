# 项目审查与迭代方案

审查日期：2026-09-05。基线：`32ee55d`，版本 `0.4.0`。本次只新增审查文档和复现材料，没有修改业务实现。

## 结论

项目已经具备较完整的建模、导入导出、结构分析、世界模拟和 AI 叙事能力，几何及模拟领域有较多回归测试。本轮发现 **10 项问题：3 项 P1、7 项 P2**。其中 7 项已通过针对性单元或浏览器实验复现，3 项通过调用链确认，尚未做专门的端到端复现。

最优先的问题是数据可靠性：未完成草稿可能在重载时被覆盖，撤销项目切换会丢失世界状态，取消生成可能无法阻止后续提交。建议先修复这些问题，再继续扩展玩法和 AI 功能。

这里的“完整审查”覆盖项目主要子系统与现有发布检查，不代表穷尽所有输入、浏览器、几何组合和真实模型服务。没有进行付费模型调用、真实供应商兼容性测试、依赖漏洞数据库扫描或长期 GPU 内存压测。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run lint` | 通过 |
| `npm run build` | 通过；存在大于 500 kB 的产物警告 |
| `npm test` | 83 个文件、385 个测试通过 |
| `npm run test:e2e` | 7 个测试通过 |
| `npm run validate:builds` | 通过 |
| `npm run audit:ldraw` | 通过 |
| `npm run audit:obj-connectivity` | 通过 |
| `npm run check:performance` | 通过 |
| 本次新增的缺陷证据实验 | 4 个单元实验、4 个浏览器实验通过，即成功观察到现有缺陷 |

首次 E2E 启动受沙箱端口权限限制；获准在本地启动后测试通过，不计为项目缺陷。性能数字仅代表本机本轮：1500 方块校验约 50 ms，60 NPC 的 100 次模拟约 717 ms；不等于实际浏览器帧耗时。

## 问题清单

### R01 · P1 · 未完成草稿在重载后丢失并被覆盖【已复现】

位置：[workspaceDraft.ts:30](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/lib/workspaceDraft.ts:30)、[App.tsx:2456](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:2456)、[App.tsx:761](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:761)。

删除支撑零件允许模型暂时悬空，自动保存也接受这个编辑中状态；但加载草稿调用结构校验，遇到悬空等阻塞问题便返回 `undefined`。App 随后加载默认项目，自动保存再覆盖原草稿。

复现：构造含一个位于 `yStud=1.2` 的无支撑砖块的有效格式草稿，启动应用。实验确认原项目未加载，且存储中的项目 ID 随后改变。实际编辑路径为搭建上下两层、删除底层、等待保存、重载。

修复：区分“可解析的工作草稿”和“可发布的结构”。草稿恢复仅做数据格式与安全边界校验，结构问题作为诊断保留。恢复失败时隔离原始数据并提供下载，不自动覆盖唯一副本。

验收：悬空、暂时碰撞、空模型均能原样恢复；损坏草稿不会被默认模型静默覆盖。

### R02 · P1 · 撤销项目切换只恢复模型，丢失 NPC 与叙事状态【已复现】

位置：[App.tsx:345](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:345)、[App.tsx:376](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:376)、[App.tsx:754](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:754)。

历史仅保存 `BuildPlan`，导入却同时改变 `plan`、`world`、`prompt`。撤销恢复旧 plan 后，world 的 planId 不匹配，effect 用空世界替换，无法恢复角色、剧情、关系和原提示词。

浏览器实验：启动带一个 NPC 的项目 A，导入 B，再撤销。项目名称恢复 A，但持久化的 NPC 数量从 1 变为 0。

修复：将项目切换定义为原子工作区命令，保存 `{plan, world, prompt}`；明确普通建模撤销与模拟时间推进的边界，不把每一个模拟 tick 都加入撤销栈。

验收：A→B→撤销→重做后，模型、角色、剧情、提示词一并匹配各自快照；NPC 编辑的可撤销范围有明确产品行为。

### R03 · P1 · 收到响应头后取消和超时失效，生成仍可完成【已复现】

位置：[llmGenerator.ts:997](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/lib/llmGenerator.ts:997)、[llmGenerator.ts:1006](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/lib/llmGenerator.ts:1006)、[App.tsx:1204](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:1204)。同类问题也存在于非流式 `requestLlmJsonContent`、连接测试。

`fetch()` 返回响应头后，finally 就清除了超时并移除了外部 abort 监听，真正读取 `response.text()` 在这个保护范围之外。服务端先返回头再延迟 body 时，取消不再传递到请求，也没有完整 body 的超时保护。App 提交前又没有检查本次请求是否仍有效，清空后可能被迟到结果恢复内容。

单元实验将响应体延迟：收到头后取消，内部请求 signal 仍为未取消，释放 body 后生成正常返回。

修复：把读取、解析 body 放进同一个 try/finally；开始请求时处理已取消 signal；提交前检查 signal、请求 ID 和工作区版本。旧请求的 finally 不得清除新请求的忙碌状态。

验收：发请求前、等待头、等待 body、解析后提交前取消均无状态提交；body 永不结束时能超时退出。

### R04 · P2 · localStorage 不可访问会白屏，错误边界无法接住【已复现】

位置：[i18n.tsx:1259](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/lib/i18n.tsx:1259)、[main.tsx:20](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/main.tsx:20)、[llmConfig.ts:31](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/lib/llmConfig.ts:31)。

语言初始化直接访问 localStorage，I18nProvider 又在 AppErrorBoundary 外。浏览器拒绝存储访问时，初始化异常直接导致根节点空白。配置、素材读取以及部分偏好写入也没有统一的容错。

浏览器实验令 `Storage.getItem()` 抛出 SecurityError，确认出现 pageerror 且 `#root` 为空。

修复：所有存储经统一适配层访问，失败时保留内存工作模式和可见保存状态；将最外层初始化纳入错误边界。IndexedDB 恢复不应只依赖 localStorage 标记，否则无法实现真正独立的回退。

验收：读拒绝、写拒绝、配额不足、IndexedDB 失败均有可操作界面；不因偏好保存失败损失编辑能力。

### R05 · P2 · 畸形配置通过加载器，之后在 `.trim()` 处崩溃【已复现】

位置：[llmConfig.ts:35](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/lib/llmConfig.ts:35)、[llmGenerator.ts:712](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/lib/llmGenerator.ts:712)。

`JSON.parse` 后用类型断言充当校验；`?? ''` 保留数字和对象。将存储配置设为 `{ "modelName": 123 }`，加载器成功返回，完整性检查则抛出 `trim is not a function`。此路径会进入错误页，普通重载无法解决。

修复：对外部数据执行字段类型检查与版本迁移；只重置损坏配置，不要求清除整个项目。相同的格式校验原则应用于项目、素材和报告存储。

验收：配置字段为数字、数组、对象、null 时均安全回退；合法旧配置可以迁移。

### R06 · P2 · 模型变化后重算默认风灾，界面仍显示原工况【已复现】

位置：[StabilityLab.tsx:165](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/components/StabilityLab.tsx:165)。

`runSimulation` 依赖 `plan.bricks`，模型变化会触发 effect，但 effect 固定传入 wind/70/25/challenge，没有同步重置界面的 scenario 等状态。应用加固或实验室打开时导入模型都能走到该路径，破坏前后比较的一致性。

浏览器实验选择 Earthquake 后导入新模型：捕获的 Worker 请求变为 wind，而 Earthquake 的 aria-pressed 仍为 true。

修复：初始化与模型变化重算分开处理；重算使用当前已提交工况。报告、播放、加固建议和显示标签共同引用一次运行的不可变 options。

验收：非默认灾害、方向、强度及物理模式下应用加固后，重算参数保持一致；运行结果标签始终匹配请求参数。

### R07 · P2 · 手册 JSON 往返丢失方块交互状态【已复现】

位置：[manualSerializer.ts:231](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/lib/manualSerializer.ts:231)、[planFileIO.ts:53](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/lib/planFileIO.ts:53)。

ManualPiece 不保存 `voxelState`，从 addPieces 还原时也没有恢复该字段。实验确认 slabHalf 丢失；同一路径还会丢失 open、powered、containerName、storyContents。普通项目 JSON 使用另一条路径，不应笼统描述为所有 JSON 导出都会丢失状态。

修复：明确手册可重建的数据契约，升级 schema 并保存方块必需状态；若手册仅面向静态搭建，导出/导入界面应明确其有损范围。slab 的位置也记录在 pose 中，因此本次不声称丢字段必然立即改变其渲染位置。

验收：上半砖、开门、灯光、箱子内容的往返测试；除结构合法外，还比较语义字段。旧 schema 继续可读。

### R08 · P2 · 项目切换不隔离正在执行的 AI 请求【代码路径确认】

位置：[App.tsx:994](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:994)、[App.tsx:1204](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:1204)、[App.tsx:1865](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:1865)。

清空工作区会 abort 请求，但文件导入、场景切换等路径没有统一执行这一步。生成结果直接 setPlan，酒馆结果应用到回包时的 worldRef，而没有验证其属于请求发起时的世界。即使修好 R03，用户未点击取消、仅切换项目时仍存在此问题。

触发序列：A 中发起慢生成/酒馆请求→导入 B→A 的请求成功返回。代码允许替换 B 的模型或向 B 应用旧活动结果。尚未做专门网络延迟 E2E。

修复：引入单调增加的 workspaceEpoch，所有异步操作捕获 epoch 与目标 worldId；项目替换统一取消或丢弃旧结果。配置连接测试也应核对配置版本。

验收：延迟回包、乱序回包、相同 planId 的重新导入，都不能把旧任务结果提交到新工作区。

### R09 · P2 · 模拟 Worker 的过期校验漏掉模型版本【代码路径确认】

位置：[useWorldSimulationLoop.ts:100](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/hooks/useWorldSimulationLoop.ts:100)、[useWorldSimulationLoop.ts:137](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/hooks/useWorldSimulationLoop.ts:137)。

Worker 同时接收 world 和 plan，但回包只检查 world 的引用与请求身份。模拟执行期间修改墙体、门或结构，只改变 plan 时，旧障碍数据计算出的结果仍会被接受，可能短暂出现不符合当前场景的移动或交互。未进行专门慢 Worker 的 E2E。

修复：请求携带 worldRevision、planRevision 和控制选项版本；提交时统一验证。Worker 构造本身也应置于降级保护内，目前只保护 postMessage 及运行时错误。

验收：人为延迟 Worker，期间移墙/开门/改结构或切换控制模式；旧版本结果不得提交，失败时能明确降级。

### R10 · P2 · 试演退出恢复快照，却保留试演中的建模历史【代码路径确认】

位置：[App.tsx:689](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:689)、[App.tsx:3429](/Users/ninjar/Documents/Code/Github/brick-flow-agent/src/App.tsx:3429)。

试演中的 object-interaction 通过 setPlan 写入正常撤销栈；退出时直接 setPlanState 恢复快照，没有恢复进入试演前的 past/future。发生多次门/箱子交互或模型编辑后，退出再撤销可能跳回已放弃的试演中间状态。单次无模型变更的试演不一定触发。

修复：试演作为隔离会话，保存并恢复历史边界，或者使用独立命令栈。持久化也需要明确保存正式快照还是试演状态，避免退出语义与自动保存冲突。

验收：进入试演→多次改变物体→退出恢复→撤销/重做，不出现任何被放弃的试演状态；重载期间行为明确。

## 设计层面的改进

### 工作区缺少统一事务边界

`App.tsx` 3914 行，同时管理模型、世界、AI、历史、持久化、导入及多个编辑器。问题并非只在文件长度，而是一个业务动作需要手动同步多个 state/ref 和 effect。R01、R02、R08、R10 都与这个边界缺失相关。

建议先抽取工作区命令与 reducer：ReplaceWorkspace、EditPlan、EditWorld、BeginPlaytest、RestorePlaytest、ApplyAsyncResult。每条命令明确变更哪些状态、是否记录历史、是否增加版本、是否保存。可先使用 React reducer，不必把更换状态库当作前置条件。

### 持久化需要恢复协议，而不只是写入函数

当前 localStorage/IndexedDB 两套数据依赖标记切换，草稿 coalesced writer 与清理操作又是独立路径；所有本地数据删除时，应用的定时保存仍可能继续运行。这些并发场景尚未做受控压力复现，应列入故障注入测试，不能直接宣布已经验证安全。

建议统一存储协调器：迁移、读取状态、保存版本、排空/取消队列、清理屏障、恢复备份。初始化期间的 prompt/world 修改也应计入 dirty revision，不能只根据 plan 引用判断是否可覆盖。对大型 IndexedDB 草稿，在 pagehide 时不要依赖异步写入必定完成。

### 世界类型、导入迁移与剧本内容耦合

`worldEntity.ts` 1727 行，包含实体操作、复杂存档解析和具体 Gray Raven 剧本的升级逻辑。应将存档 schema/migrations、实体领域操作、内置剧本迁移拆开，避免新增某个故事时修改通用世界加载器。

### 测试数量充足，但集成维度不足

Vitest 配置只收集 `src/**/*.test.ts` 且使用 node 环境；现有 7 个 E2E 主要覆盖建模/结构实验室，世界、AI、恢复、试演跨模块流程覆盖不足。新增测试应围绕本报告的用户操作序列和不变量，而不是镜像 reducer 实现。

CI 的浏览器测试运行在 Vite dev server；部署流程没有生产预览 E2E。应增加构建产物 smoke，覆盖 base path、动态 chunk、Worker 路径和重载；复用同一套发布门禁，性能信息采集失败也应可见。

### 性能预算需要包含 UI 和数据交换

构建中主入口约 630 kB（gzip 173 kB），另有约 758 kB 的共享产物和约 793 kB 的几何块。体积警告本身不等于实际卡顿，不能将各 chunk 简单相加当作首屏下载量。

下一轮测量首屏资源瀑布、交互长任务、实际帧耗时、Worker 的结构化复制成本、长时间运行内存。模拟请求目前每轮发送完整 plan/world；可按模型版本只同步变化部分，但应在 R09 的版本协议稳定后实施。方块栅栏状态同步逐栅栏扫描全场景，也应补充高栅栏占比负载，现有分块基准不能代表这个开销。

## 分阶段迭代计划

工期为单名熟悉项目的开发者的粗估人日，包含相关回归验证；不是交付承诺。先做正确性，再进行结构拆分与性能优化。

| 阶段 | 范围 | 预计工作量 | 退出条件 |
| --- | --- | --- | --- |
| I1 数据可靠性 | R01、R02、R03；补存储与配置容错 R04/R05 | 4–6 人日 | 草稿不被覆盖；项目撤销保持完整世界；取消和超时全链路有效；存储故障仍可编辑 |
| I2 状态与分析一致性 | workspaceEpoch；R06、R08、R09、R10；修复 R07 的格式契约 | 4–6 人日 | 迟到回包零提交；当前工况一致；试演历史隔离；手册往返语义明确 |
| I3 边界与发布保障 | 提取工作区命令、存储协调器、AI 请求生命周期；拆存档迁移；生产 smoke | 5–7 人日 | App 负责组装；状态提交入口统一；旧存档与生产路径回归通过 |
| I4 性能与产品整理 | 首屏/帧耗时/复制成本/内存基线，按数据优化；编辑与试演入口及保存状态整理 | 3–5 人日 | 大场景交互有可重复基线；热点优化有前后证据；用户明确当前编辑/试演与保存状态 |

I1 可拆为三次小 PR：草稿恢复与容错、完整工作区撤销、请求取消与提交保护。I2 在引入版本协议后逐项落地，避免一次大规模重写。I3 以已通过的行为测试约束迁移；I4 根据测量决定是否需要额外状态库、增量 Worker 协议或更细的懒加载。

统一验收门禁：现有发布检查全部通过，加上本报告每项验收中的用户序列。AI 使用确定性假服务注入响应头延迟、body 延迟、错误、乱序和取消；不依赖真实服务收费或随机输出。

## 复现材料

同目录保留 `unit-evidence.test.ts.txt` 与 `browser-evidence.spec.ts.txt`。它们断言“现有缺陷确实发生”，并非正式回归测试；因此采用 `.txt`，不进入正常 CI。

复现时分别临时复制到原相对位置 `src/lib/reviewEvidence.test.ts` 和 `tests/e2e/review-evidence.spec.ts`，在仓库根运行：

```sh
npx vitest run src/lib/reviewEvidence.test.ts
npm run test:e2e -- tests/e2e/review-evidence.spec.ts
```

完成后删除临时副本。修复时将对应断言改为验收期望并纳入正式测试；不能让“缺陷仍然存在”成为发布成功条件。

复现与发现对应：单元实验覆盖 R01/R03/R05/R07；浏览器实验覆盖 R01/R02/R04/R06。R08/R09/R10 目前为代码路径结论，应在修复前补专门延迟/试演复现。
