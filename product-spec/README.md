# 个人 Agent 助理：方案 B 产品实现蓝图

版本：`B-1.0-draft` · 2026-11-07 · 状态：可用于拆分实施，须先通过 G0。本文档集是本产品的当前设计基线；不是已实现产品的说明书。

交付仓库：[JokersDH/dsh-superagent-prototype](https://github.com/JokersDH/dsh-superagent-prototype)。代码位置和两个额外 Agent 的开工入口见根 [START-HERE](../START-HERE.zh-CN.md)；新产品直接落在本仓根 packages/apps/tools。

## 1. 产品结论

做一个本地优先、以主对话为入口的个人开发助理。用户在一个地方讨论、委托多个项目的工作、回答各 agent 的问题、修订要求、查看验证后的交付，并沉淀明确决定。后台协调器持续工作；关闭网页不停止任务。ZCode、DeepSeek Harness、Codex 是首批接入目标，CAC 后续以执行器接入。

**方案 B 指产品独立于 CAC 和 DSH 应用宿主，不表示全部自研。** 默认提取本仓库 superagent 的 Ticket/Assignment 内核，复用事务、队列和通知的适用部分；原生 agent 继续承担模型循环、工具执行、原生会话与原生子团队。我们实现跨运行时的可靠接线、人工交互、目标版本、验证及个人经验治理。

首版默认一个合同版本对应一个主 Ticket，优先使用该执行器已有的 team/subagent。跨 harness 的细粒度动态团队属于后续扩展，不能成为首版交付前提。

## 2. 最终产品形态

初始交付是本机 daemon + 浏览器工作台 + CLI，首先支持 macOS；不先做桌面壳、云集群或移动 App。

```text
pa start / pa status / pa doctor / pa backup / pa stop
                  │
       127.0.0.1 本地网页
 ┌──────────────┬──────────────────────────────┐
 │ 项目 / 工作  │ 主对话：讨论、委托、问题、交付 │
 │ 待你决定  2  │                              │
 │ Agent 连接   │ 当前工作与合同 / 证据 / 变更   │
 │ 决定与经验   │ 需要时展开的执行细节与诊断     │
 └──────────────┴──────────────────────────────┘
```

`pa` 是拟议命令名。完整流程、页面、空状态、失效状态和线框见 [01 产品与体验](01-product-and-experience.zh-CN.md)。主页面的价值是每天能用的助理；研发证据和实验控制放在可展开区域。

第一可用出口：一个通过验收的真实执行器、两个项目、完整提问链路、真实产物验证、关闭重开和协调器恢复、准确停止。下一出口：第二种真实协议验证扩展能力，再补齐第三个目标。若原生版本能力不足，清楚降级，不用统一绿灯掩盖差异。

## 3. 文档地图

| 文档 | 用途 | 主要读者 |
| --- | --- | --- |
| [01 产品与体验](01-product-and-experience.zh-CN.md) | 用户流程、交互、范围和 UX 验收 | 产品、UI、应用编排 |
| [02 架构与复用](02-architecture-and-reuse.zh-CN.md) | 逐文件复用、状态所有权、内核必要改造 | 集成负责人、core、存储 |
| [03 契约与数据](03-contracts-and-data.zh-CN.md) | 公共 interface、数据、事务、时序、HTTP | 全部实现者，必须先读 |
| [04 Agent 运行时](04-agent-runtime-and-extension.zh-CN.md) | DriverKit、三个接入、原生权限与扩展 | Runner、Driver 作者 |
| [05 稳定性与运维](05-reliability-and-operations.zh-CN.md) | 崩溃、取消、重试、备份、发布与诊断 | 后端、测试、发布 |
| [06 学习与创新验证](06-learning-and-evaluation.zh-CN.md) | 明确决定、选择性学习、联合提问、实验 | 经验模块、研究实现者 |
| [07 实施与验收](07-implementation-and-acceptance.zh-CN.md) | G0–G6、步骤、测试层次、发布出口 | 负责人、验收人员 |
| [08 多 Agent 开发](08-multi-agent-development.zh-CN.md) | 任务归属、依赖、RFC、分支与集成 | 所有领任务的 agent |
| [09 选型与证据](09-technology-and-evidence.zh-CN.md) | 选型理由、替代项、来源和已知限制 | 架构、依赖维护 |
| [任务包索引](tasks/README.md) | 可逐包复制给不同 agent 的实现指令 | 派工者 |
| [公共类型草案](contracts/contracts.ts) | 单一公共类型候选，G0 冻结为实现契约 | 契约负责人 |
| [类型化样例](contracts/fixtures.ts) | 委托、主对话、原生问题和答案的最小样例 | UI、应用、Driver |
| [任务清单](work-packages.json) / [验收目录](acceptance-catalog.json) | 机器可检查的依赖与验收索引 | 自动化、集成 |

阅读顺序：本页 → 01 → 02 → 03 → 07 → 自己的任务包及其专题。并行实施规则以 08 为准。契约变动先 RFC；不得在各 Driver 内复制一个私有版本。

需要连续阅读时打开 [完整合并版](FULL-BLUEPRINT.zh-CN.md)；需要派工时直接打开对应任务包。合并版由同一来源生成，不能另行编辑。

当前有主 Agent 加两个额外 Agent 时，按 [三 Agent 分工与首轮指令](three-agent-dispatch.zh-CN.md) 执行：先在 WP-00 内并行完成契约、core 提取、平台验证，再进入正式模块开发。

## 4. 关键决定

| 决定 | 原因与约束 |
| --- | --- |
| 复用 core，独立组合根 | 本仓 core 主要依赖本目录与 node:crypto；先独立提取验证，不能直接依赖原 DSH 插件根入口 |
| Ticket/Assignment 是唯一执行生命周期 | Work 仅保存稳定身份、目标版本和 Ticket 关联，展示状态从事实派生 |
| 单 coordinator writer + SQLite WAL | 首期本机单用户工作负载；避免多个写入权威和分布式恢复成本 |
| Supervisor + 每 attempt 受控 Runner | 协议与进程失败可隔离；平台崩溃后仍需核对实际 writer |
| 协议 Driver + 产品 Profile | 同协议优先复用 Driver；新协议才增加 Driver；能力由实际测试证明 |
| 主对话 Reasoner 复用已有 runtime | 不自建 LLM loop；只给读和结构化提案能力，执行授权由可信入口决定 |
| 问题集中，原生批准逐请求 | 业务答案可有条件复用，权限/认证不能因文本相似而共享 |
| 可信完成 gate | 原生 end_turn 不等于交付合格，core 最终完成须绑定当前候选与验证 |
| 先明确决定，再研究自动学习 | 日常价值先交付；推断规则须经过独立实验和版本化推广 |

## 5. 复用、自研与延期

直接复用：本仓 core slice 与测试、Git worktree、厂商 agent runtime、ACP 官方 SDK、HTTP/UI/测试基础库。适配复用：Store 的领域 SQL 和事务行为、Effects 算法、文本 Outbox、原生协议与版本 schema。新增：产品索引、Source/Policy、completion/report guards、Supervisor、QuestionBroker、Verifier、工作台与兼容报告。

暂缓：自研 agent 推理框架、Redis/Temporal、Kubernetes、多机调度、全自动跨 harness 子团队、共享账号权限代理、自动部署/合并、全局无审查自进化。完整设计保留扩展 interface，首版不为空想功能建一套通用平台。

## 6. 创新定位

多 agent 接入、问题上浮、后台任务、自动开发流水线本身已有成熟先例。本方案把它们作为产品基础，不宣称突破。

研究重点是：区分用户“改变目标”与 agent“偏离目标”的选择性学习；在团队总等待、返工和人工成本下选择提问；带适用条件、来源和失效测试的跨 harness 策略迁移。每项都给出强基线、停止条件和实验门槛，详见 06。创新收益没有被本次文档工作证明。

## 7. 从哪里开始

先派发 [WP-00](tasks/WP-00.md)：复用提取试验、契约/仓库/bootstrap、版本与来源锁定。通过 G0 后，core、存储、DriverKit、UI fixture 可以分开推进；Driver 的正式接入验收必须等待 Runner 与原生策略链路，不能仅靠 parser 单测。

随后按 [实施计划](07-implementation-and-acceptance.zh-CN.md) 完成一条真实纵向链路，再扩大并行。所有任务包区分 `startAfter` 与 `acceptAfter`，允许先用 fixture 开发，但不会把 mock 联调算成产品验收。

## 8. 当前证据与检查

设计调研阶段运行的原仓 144 个测试仅作为 reference baseline。随后 G0 已完成：Agent A 的独立提取/144 测试和 AST 复核，主 Agent 的单一来源契约包/183 测试/独立构建，Agent B 在打包补正后的 darwin-arm64 目标组合/30 探针与独立复验。当前 G0 结论和范围见 [交接报告](../docs/adr/bootstrap/g0-main-report.md)。

G1 已交付正式 core 的候选/可信完成、Assignment-scoped report/read、当前版本/退役守卫，以及共享 workspace/检查入口；见 [G1 交接](../docs/adr/core/g1-core-handoff.md)。core 178 项和契约 183 项测试通过，真实 Store/Runner 联调尚未通过，因此整体 G1 仍在进行。

尚未实现完整产品协调器，也未运行原生 agent 模型任务或学习实验。原生产品版本/协议调研依然不代表接入通过，未实际执行的平台能力保持 NOT_TESTED。

A/B 首批交付的原始 7 项阻断复现现已通过；后续新增的 5 项边界仍未通过。主 Agent 已交付严格事实入口，18 项确定性和 7 项真实 SQLite 测试通过，见 [交接](../docs/adr/core/g1-ingress-handoff.md)。生产 binding/IPC/恢复仍待接线，不代表整体 G1 通过；原模块 owner 继续处理补充修复。

文档一致性检查：`node product-spec/tools/verify-spec.mjs`。公共类型检查命令见 07。这些检查只证明规格内部一致和草案可编译，不证明产品稳定性或学习收益。

整合时发现的接口与依赖问题及修正见 [复核记录](reviews/integrated-design-review.md)，可作为后续架构评审和回归依据。

本目录优先于 `.artifacts/personal-agent-architecture/` 和 `.artifacts/personal-agent-b-plan/` 中旧的实现草案；历史调研来源仍可引用。遇到冲突以本目录当前契约和 ADR 为准。
