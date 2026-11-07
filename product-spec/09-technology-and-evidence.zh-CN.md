# 09 技术选型、复用和研究证据

调研截点：2026-11-07。版本号区分“本机观察”“拟议锁定”和“实际运行通过”；本章不将三者混用。已有观察摘要见 [observations.json](research/observations.json)。

## 1. 选型表

| 层 | 默认选择 | 理由 | 替代与触发条件 |
| --- | --- | --- | --- |
| 领域调度 | 本仓 superagent core slice | 已有授权、接单、派工、输入、重试规则和测试；执行器 port 可替换 | G0 有具体不可裁剪阻塞才重新 ADR，不默认重建 |
| 语言与工具 | TypeScript；pnpm workspace | 复用原代码与协议生态，单 lockfile 便于兼容管理 | 不为初期多语言重写核心 |
| Node | 拟锁 24.22.2，非“最新 LTS”主张 | 保守发行基线；本机观察 24.21.0 | 新 LTS 作为独立兼容 lane，通过再升 |
| 包管理 | 拟沿用 pnpm 11.7.0 | 当前仓声明此版本；G0 验证目标 Node 与 CI，再精确锁 | 不依赖用户全局随机 pnpm |
| SQLite binding | 拟锁 better-sqlite3 13.0.3 | 同步事务适合现有 core，成熟 SQL interface；13 使用 N-API/随包 prebuild | node:sqlite 24.x 所读文档为 RC，需独立 ADR/同等测试，不静默切换 |
| 持久化 | 单机 SQLite WAL + 受限 artifact 文件 | 满足个人数据量，事务内接单/排队/receipt 一致 | 多用户/多机形成真实需求时评估 PostgreSQL/成熟 workflow backend |
| HTTP | Hono + 官方 Node adapter | 少量命令/读取/SSE；基于 Web 标准，业务集中在 ApplicationService | 不让 Hono ctx 进入 core；若已有成熟宿主再评估嵌入 |
| 推送 | SSE + 持久 cursor + snapshot | 当前主要是单向投影；重连语义清楚 | 交互流媒体/双向场景出现再引 WebSocket |
| UI | React + Vite + TypeScript | 常见维护栈；真实操作工作台，适合 fixture 并行开发 | G0 固定稳定版本；不原样继承 DSH client peers |
| UI 基础 | TanStack Query、Router；Radix primitives；lucide-react | 服务端投影缓存、路由、可访问控件与现成图标 | 只引实际需要的模块，不同时上两套 UI 框架 |
| schema | Zod 单一 schema 源与生成流程 | 运行时入口校验，避免 TS/JSON 双写 | 草案 TS 转实现 schema 的方向在 G0 冻结 |
| 原生进程 | Node spawn argv + Runner + 有界 IPC | 控制生命周期与进程身份，避免 shell 拼接 | 不是 OS 沙箱，权限仍需原生准备 |
| Codex | native app-server stdio | 双向事件、请求/权限、会话控制 | JSONL exec 可作受限批处理，不作为完整交互默认 |
| DSH | ACP stable v1 + 官方 TS SDK | 复用已有标准协议，产品差异主要落 Profile | ACP 缺关键事实时才评估 DSH native SDK adapter |
| ZCode | 独立 native Driver，安装版优先 | 官方源码有协议线索，安装版仍需对齐 | 对齐不明则保持实验状态，不能假设兼容 ACP/Codex |
| Reasoner | 现有原生 agent runtime + 受限工具 | 不重写模型/tool loop，平台校验提案 | 独立配置与 worker 验收，不授予通用 shell |
| 测试 | Vitest、真实 fake subprocess、Playwright | 分开覆盖领域、事务、进程、交互和 native 兼容 | 付费 smoke 只在明确测试项目/预算下运行 |
| 知识 | 只读文件/Obsidian adapter + provenance | 先复用现有笔记，不先复制全部内容到向量库 | 检索证据表明必要时再加 FTS/向量索引 |
| 学习 | 自有小规模策略治理；GEPA 等可选实验 adapter | 创新位于解释/选择/推广，而非再造优化器 | CAC Evolver 后接；无收益时保留简单明确规则 |

除明确标注的拟锁版本，其他库的精确 patch 在 G0 从官方稳定版选定、写 lockfile/manifest 并验证；不能在本文编造一个“已测组合”。运行时不使用 latest 自动漂移。

## 2. 为什么不是把一整套框架搬进来

LangGraph/Temporal/DBOS 可以解决部分持久流程，但不能替代原生执行器的发送不确定性、真实停止、问题绑定和工作区所有权。当前仓已有可提取的领域规则，首期引入第二个全权调度框架反而增加状态同步。未来跨机器/多人或长流程需求出现时，应优先评估成熟 backend，而不是继续手写分布式框架。

ACP 统一一部分 client-agent 通信，MCP 主要统一工具/资源，A2A 关注 agent 间协作；它们不自动提供本产品的合同、可信完成和人类决定归属。按具体适用层复用，不用“支持协议”替代端到端验收。

现有 superagent 的 GitHub/Feishu/DSH 宿主部分服务其原产品。B 版复用其通用 core，不要求个人用户先部署这些入口。MIT 允许提取，但必须保留版权、LICENSE、上游 commit 和改动清单。

## 3. 关键证据与结论限制

| 一手来源 | 支撑的决定 | 仍需实施验证 |
| --- | --- | --- |
| [本仓 core](../src/core/index.ts)、[ports](../src/core/ports.ts)、[144-test 基线文件](../tests/core-engine.spec.ts) | 优先提取，Executor 可适配 | 独立 import/type graph、产品完成扩展和原生接线 |
| [本仓 Store](../src/app/store.ts)、[Effects](../src/app/effects.ts) | 复用领域 SQL 与队列算法 | 去应用耦合、真实 binding 事务、unknown-send 分类 |
| [DSH 官方 CLI](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md) | acp/sdk/headless profile 候选 | 本机 0.2.1-rc.2 不能直接套 master 能力 |
| [DSH 官方 SDK](https://deepseek-harness.github.io/deepseek-harness/en/guide/python-sdk) | SDK 与打包 runtime 路径可选 | 专用 home、认证、权限和 HMR 身份 |
| [Codex app-server](https://developers.openai.com/codex/app-server)、[non-interactive](https://developers.openai.com/codex/non-interactive-mode) | native 双向控制优先 | 本机 0.164.0 schema 与真实问题/取消/恢复 |
| [ACP TS SDK](https://agentclientprotocol.com/libraries/typescript.md)、[测试工具](https://agentclientprotocol.com/libraries/testing.md) | 官方 SDK stable v1，TCK 补充 | SDK 2.4.0 不等于 wire v2；TCK 不完整，不是认证 |
| [ZCode 固定源码](https://github.com/zai-org/ZCode/tree/aac4755666d09fdcd70272fcf063c077a639015f)、[Agent Server 设计](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/apps/zcode-cli/docs/design/v2/zcode-protocol-agent-server.md) | 不必默认抓终端文案，可做协议 spike | source CLI 0.1.0 与安装 0.16.5 对应关系未知；v4 module / wire 3 / projection 1 各自独立 |
| [Node 24 SQLite 文档](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)、[发行索引](https://nodejs.org/dist/index.json) | 区分 runtime/binding/SQLite engine | 拟议组合未安装/加载验证 |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)、[SQLite WAL](https://www.sqlite.org/wal.html#walreset)、[backup](https://www.sqlite.org/backup.html) | native-load、WAL 修复入场与一致备份 | 实际包内版本、OS/arch、restore 与故障测试 |
| [Hono Node](https://hono.dev/docs/getting-started/nodejs)、[streaming](https://hono.dev/docs/helpers/streaming) | 官方 adapter 与 SSE helper | 持久 cursor、背压和应用认证仍由产品实现 |
| [Git worktree](https://git-scm.com/docs/git-worktree) | 独立工作目录复用 Git | 共享 metadata、dirty 文件、外部副作用与安全隔离不自动解决 |

共享的一手来源和重新采集步骤见 [research/README.md](research/README.md)。原始 Hono HTML 快照、原生资料、Codex 320 份本机 schema 和 hash 保留在本机调研缓存，未作为编译或验收依赖上传。静态 schema 导出、网页内容和源代码存在，都不是运行兼容证明。

## 4. 原始需求和历史研究的延续

原始个人助理方向来自用户知识库中的《个人Agent开发助理设计（我的Trae宝）》及多轮研究。CAC 源码路径为 `/Users/hh/Desktop/huawei/ade/cac`；最新版 sub-team 暂不可得，其主入口提问/工作 session 接收消息是需求输入，不宣称已验证对应实现。

历史双方案比较和创新调研保留在本机可选归档 `.artifacts/personal-agent-architecture/` 与 `.artifacts/personal-agent-innovation-research/`，新 clone 无需存在这些目录。其中重建 WorkKernel/Work 独立执行状态的草案被本目录复用决定取代。论文、产品与实践比较的当前研究门槛见 [06](06-learning-and-evaluation.zh-CN.md)。

历史 `.artifacts` 是本机调研附件，可能被 Git ignore；不能把它当发布时一定存在的依赖。正式实施由 G0 把需要的来源锁、生成命令和脱敏 fixtures 带入各包；本机观察的持久摘要在 [research/observations.json](research/observations.json)，外部一手链接和固定 commit 见本章。新 clone 不应依赖私有绝对目录才能编译或验收。

## 5. 建议记录的 ADR

G0：独立组合根与提取范围；唯一状态所有权；契约生成方向；Node/binding/包管理发行锁。

G1：可信完成模式；fenced report；真实事务/effect 语义；WriterLease 与恢复。

G2：原生权限准备；QuestionBroker 与 core Attention 的关系；候选冻结和验证。

G3/G4：首个正式 profile；配置漂移；第二协议和新增 agent 成本；发布/迁移。

G5/G6：学习研究预注册、active 推广范围、CAC adapter 与跨 harness 子委派授权。每份 ADR 包含背景、证据、决定、替代项、已知风险、验收引用和撤销条件。
