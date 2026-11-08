# 三个 Agent 的实际分工与首轮指令

当前执行入口已升级为 [第二轮整包排程](../agent-tasks/wave-02/README.zh-CN.md)：A 负责可信交付/产品仓储/工作台，B 负责独立运行时/Catalog/首个 Driver，主 Agent 负责问题中心/应用入口/集成。每人一个接口检查点后持续推进，最后整包交付。下文首轮 G0 模板仅供历史追溯，不再作为当前派工。

日期：2026-11-07。资源：当前会话为主 Agent，另有两个开发 Agent。交付仓库已确定为用户 fork；本机工作目录和最新开工入口见根 [START-HERE](../START-HERE.zh-CN.md)。本文件保留整体排程，直接派工使用根 agent-tasks 下的两个任务文件。

## 1. 推荐分工

| 角色 | 首轮职责 | G0 后第一项正式任务 | 长期职责 |
| --- | --- | --- | --- |
| 主 Agent（当前会话） | 公共契约、验收 schema、bootstrap 模板、汇总 G0 | WP-01 核心 + WP-16 分阶段集成 | 契约、核心规则、应用入口、跨模块验收 |
| Agent A | 独立提取 superagent core、原测试与依赖验证 | WP-02 存储/事务/Effects | 数据持久化；随后工作区验证、UI、运维 |
| Agent B | 隔离验证 Node/pnpm/SQLite binding 与恢复行为 | WP-03 Supervisor/Runner/DriverKit | 运行时；随后 Catalog、原生 Driver |

首轮 A/B 是 WP-00 内部委派的两个子任务，主 Agent 仍是 WP-00 owner。不是提前启动依赖 G0 的正式实现包。两个子任务独立目录、独立 package/lock，可同时工作。

角色按职责安排，与具体模型品牌无关。若某个 Agent 明显擅长 UI，可以在下一波交换 UI 任务；公共契约、迁移与根配置仍维持单 owner。

## 2. 首轮路径所有权

所有路径相对于当前方案仓或由主 Agent 明确指定的试验工作目录。原仓 `src/`、用户原项目与原生 agent 账号配置均为只读。

| 角色 | 允许编辑 | 不得编辑 |
| --- | --- | --- |
| 主 Agent | `packages/contracts/`、`tools/bootstrap/`、`docs/adr/bootstrap/`、WP-00 的 RFC；方案整合文档 | A/B 的未交接试验源码 |
| Agent A | `tools/reuse-spike/core-extraction/` | 原 `src/`、B 的试验、公共 types、根 package/lock、正式 core/storage |
| Agent B | `tools/reuse-spike/platform/` | 原 `src/`、A 的试验、公共 types、根 package/lock、正式 storage/runtime |

每位 Agent 的报告和 fixtures 一起放在自己的目录。发现公共契约问题先写本包报告，由主 Agent 修改唯一来源。禁止从三处分别复制并修改一套公共 types。

## 3. 共同基线和工作方式

主 Agent 将方案与开工指令作为共同 Git 基线提交到用户 fork，并从该基线创建 A/B 的 worktree。各 Agent 开始时记录当前 HEAD 为 base；未提交改动不会自动出现在别的 worktree。原有 `ARCHITECTURE-NOTES.zh-CN.md` 是用户本机笔记，不随手纳入或改写。

推荐一人一个 branch/worktree，共享同一个基线。A/B 仅在各自路径提交；主 Agent review 后逐个集成。根 lockfile 只有主 Agent 操作。首轮独立试验在自己的子目录中维护 package 和 lock，避免竞争根依赖。

若暂时直接共用一个目录，也必须严格按上述路径写文件；其他 Agent 工作期间不执行全仓格式化、清理、reset 或切分支。共享目录更容易误包含未完成改动，因此正式实现优先 worktree。

## 4. 可直接发给 Agent A 的首轮指令

```text
你负责个人 Agent 助理方案 B 的 G0 子任务 A：superagent core 独立提取验证。

参考仓为同一 fork 的当前 checkout；本机 Agent A 工作目录是 /Users/hh/Desktop/joker/superagent-agent-a，分支 codex/g0-core-extraction。以根 agent-tasks/agent-a.md 为首轮完整指令。
先读 product-spec/README.md、02-architecture-and-reuse.zh-CN.md、tasks/WP-00.md 和 three-agent-dispatch.zh-CN.md。
先核对主 Agent 提供的共同基线 commit，不假设新 worktree 已包含未提交文档。

你唯一可写目录是 tools/reuse-spike/core-extraction/，包括其中的 package、lock、源码副本、测试、README 和报告。
原 src/、原 tests/、公共契约、根配置、正式 packages/orchestrator-core 与其他 Agent 目录均只读。

工作目标：
1. 从上游固定 commit 8c32a9dc5d72c033816c6a8110b37f40cf94fba4 提取最小 core slice；保留 MIT、版权和来源 manifest。
2. 复制并对齐 tests/core-engine.spec.ts、tests/stage.spec.ts 到隔离试验。只调整必要路径/测试宿主，不改原领域规则来迎合测试。
3. 使用独立最小依赖运行原 144-test baseline，记录真实结果；原仓通过不能代替提取目录通过。
4. 检查 runtime 和 TypeScript type import graph，证明无需 @deepseek-ai/*、Cordis 或原插件根入口；不能只搜索一层 import。
5. 标明后续 completion gate、reportAssignment、candidate generation 所需最小扩展位置，先给建议和失败用例，不提前实现正式 WP-01。

验收：独立试验可重复运行；测试结果、命令、版本/lock、导入图、提取 manifest 与许可证齐全。若失败，报告最小阻塞链和修正建议。
禁止创建第二套 Work 状态机、修改原项目、读取凭据、改根 lockfile 或实施正式数据库迁移。

交接提交：你的 commit、改动路径、执行命令与结果、CORE-01 证据、剩余阻塞；报告写在自己的目录。
交接后等待主 Agent 的 G0 结论，再转入正式 WP-02。
```

## 5. 可直接发给 Agent B 的首轮指令

```text
你负责个人 Agent 助理方案 B 的 G0 子任务 B：隔离运行基线与 SQLite 可用性验证。

参考仓为同一 fork 的当前 checkout；本机 Agent B 工作目录是 /Users/hh/Desktop/joker/superagent-agent-b，分支 codex/g0-platform-validation。以根 agent-tasks/agent-b.md 为首轮完整指令。
先读 product-spec/README.md、05-reliability-and-operations.zh-CN.md、09-technology-and-evidence.zh-CN.md、tasks/WP-00.md 和 three-agent-dispatch.zh-CN.md。
先核对主 Agent 提供的共同基线 commit，不假设新 worktree 已包含未提交文档。

你唯一可写目录是 tools/reuse-spike/platform/，包括独立 package/lock、探针、临时数据库和报告。
不修改系统默认 Node、用户原生 agent 安装/账号/profile、根配置或其他 Agent 目录。

工作目标：
1. 核对本机 runtime/OS/arch；区分已安装 Node 24.21.0 和拟议 Node 24.22.2，拟议 pnpm 11.7.0/better-sqlite3 13.0.3。需要测试拟议 runtime 时使用隔离目录，不全局升级。
2. 在隔离 package 验证 binding 实际安装/加载、prebuild 与实际 SELECT sqlite_version()。平台只报告实际测到的组合，其他架构标 NOT_TESTED。
3. 在临时 SQLite 数据上验证 WAL、外键、唯一约束、事务 rollback、嵌套 savepoint、同连接 atomic effect/receipt；不实现生产 Store。
4. 做最小 backup→新目录 restore→integrity/foreign_key 检查，注明该试验尚未覆盖产品 artifacts、native runner 和完整恢复。
5. 输出 runtime/admission 建议、可重跑命令、兼容风险和 release manifest 草案；拟议组合失败就提交事实与替代建议，不静默换 binding。

验收：OPS-01 的 G0 运行组合证据、真实 binding 的最小事务/备份探针结果；所有 PASS/FAIL/SKIPPED/NOT_TESTED 如实记录。
禁止真实模型任务、凭据读取、原生 profile reset、生产 DB 操作、正式存储/调度引擎和根 lockfile 修改。

交接提交：你的 commit、改动路径、环境/版本、实际命令、探针结果、阻塞和建议；报告写在自己的目录。
交接后等待主 Agent 的 G0 结论，再转入正式 WP-03。
```

## 6. 主 Agent 同时做什么

1. 将公共草案收敛为单一运行时 schema 来源，生成 TS/JSON，补合法/非法与旧消费者 fixtures。
2. 冻结身份/版本、原生问题与答案、候选失效、完成 gate 和公共错误语义；不在三个分支分别定义。
3. 按用户已确定的 fork 根 packages/apps/tools 落点，准备 bootstrap 模板和根配置集成方式。
4. Review A/B 的真实证据，汇总 CORE-01、DATA-01、OPS-01 的 G0 适用断言；确认版本与合同 hash。
5. G0 通过后发出共同基线 commit 和下一轮任务；未通过时只修具体阻塞，无关准备可以继续。

## 7. 后续三人排程

| 波次/出口 | 主 Agent | Agent A | Agent B |
| --- | --- | --- | --- |
| G0 | 公共契约、bootstrap、汇总 | core 提取试验 | 平台/SQLite 试验 |
| G1 | WP-01 + WP-16 骨架集成 | WP-02 持久化/Effects | WP-03 Runner/DriverKit/Supervisor |
| G2 前半 | WP-05 QuestionBroker；开始 WP-10 应用 | WP-04 工作区/验证；随后 WP-11 UI fixtures | WP-06 Catalog；随后 WP-07 Codex 接入 |
| G2 完整闭环 | 完成 WP-10、Reasoner 与纵向验收 | WP-11 真实 UI 联调、错误/重开流程 | 完成首个真实 Driver、权限/取消/恢复 |
| G3 | WP-13 明确决定/上下文，产品回归 | WP-12 CLI/诊断/备份/发行 | 首个 Driver 稳定性；开始第二协议 |
| G4 | 集成回归、兼容矩阵与扩展成本评估 | UI/运维缺口和新增能力状态 | WP-08 ACP/DSH，随后 WP-09 ZCode |

Codex 是默认首个纵向目标；若 DSH 或 ZCode 更早通过所有真实门槛，可以调整首个 Driver，保持其余分工。三个 Driver 可以做只读研究，但正式实现优先完成一条真实链路。

同一角色承担多个包表示先后推进，不表示忽略依赖同时开工。WP-10 可用 fixture 开始，正式接受仍须完成 WP-04/05/06 等依赖。不要同时让主 Agent 实现多个高风险模块并承担全部 review。

G5 学习实验、G6 CAC 放到稳定闭环之后。G0 通过后按原 [任务包](tasks/README.md) 的完整指令和验收执行。

## 8. 每轮怎么收敛

每位 Agent 汇报：共同基线/本包 commit、拥有路径、完成行为、真实命令、caseId→evidence、未测/阻塞和下游使用方式。主 Agent review 后合入，广播新的共同基线；下游依赖已接受提交，不依赖另一个分支的未提交代码。

当一个角色被依赖阻塞时，优先做自己模块的负例、fixtures、文档或 review；不要占用别人的源码路径“顺手补一下”。变更公共语义由主 Agent 处理，迁移由 Agent A 的 WP-02 处理，根依赖和组合根由主 Agent 的 WP-16 处理。
