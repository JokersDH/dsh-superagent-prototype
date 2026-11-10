# 第三轮派工：产品 UI、完整能力与内部试用准备

后续新工作改按 [第四轮任务包](../product-wave-04/README.zh-CN.md)；本页保留历史范围、归属和预算，不再作为新任务入口。

基线 `origin/main` / `c3f018e`，日期 2026-11-10。用户明确有 A/B/C/D/E 五个外部开发 Agent。主线负责主对话中心的新工作台与公共集成；五个包均为正式分工，优先级为 UI+功能补齐 → 内部试用迁移发行 → CAC。先读 [路线与真实能力矩阵](../../docs/roadmap/product-wave-03.zh-CN.md)，不得把旧 final 报告当完整产品通过。

## 包和拥有路径

| 角色 | 任务入口 | 唯一拥有范围 |
| --- | --- | --- |
| 主线 | [main](main.zh-CN.md) | `apps/console/`、`packages/contracts/`、`packages/application/`、`packages/questions/`、`apps/coordinator/`、root 配置/锁、跨模块集成和共享文档 |
| A | [日常工作流](agent-a-workflows.zh-CN.md) | `packages/storage/`、`packages/workflows/`；唯一生产迁移 owner |
| B | [原生控制恢复](agent-b-runtime.zh-CN.md) | `apps/runner/`、`packages/drivers/codex-native/`、`packages/driver-kit/`、`packages/testing/`、`tests/native-acceptance/` |
| C | [上下文、提案与决定](agent-c-assistant.zh-CN.md) | `packages/context/`、`packages/proposals/`、`packages/knowledge/` |
| D | [发行与迁移](agent-d-delivery.zh-CN.md) | `apps/launcher/`、`tools/distribution/`、`packages/portability/` |
| E | [独立产品验收](agent-e-acceptance.zh-CN.md) | `tests/product-acceptance/`；不改生产实现 |

本轮归属取代旧 wave-02/native-mvp 对上述路径的并发安排。主线在 B 接手期间停止并发修改 Runner/Driver 等 B 拥有源码；主线只消费检查点和做 coordinator 组合。生产 SQL 仅 A 修改；C/D 经 A 公开 port 消费，不另开 writer。E 拥有目录内的测试不由主线并发改写。

## 工作目录

- A 继续 `/Users/hh/Desktop/joker/superagent-agent-a` / `codex/g2-workspaces-verification`，保留已有环境模块与提交历史。
- B 继续 `/Users/hh/Desktop/joker/superagent-agent-b` / `codex/g1-runtime`，保留现有验收候选与预算历史。
- C 使用 `/Users/hh/Desktop/joker/superagent-agent-c` / `codex/g3-assistant-context`。
- D 使用 `/Users/hh/Desktop/joker/superagent-agent-d` / `codex/g3-local-distribution`。
- E 使用 `/Users/hh/Desktop/joker/superagent-agent-e` / `codex/g3-product-acceptance`。

C/D/E 的 worktree 已由主线从派工检查点 `85922fd` 创建，并已 push 同名远程分支、设置各自 upstream。目录可直接打开；开工时仍先合并最新 `origin/main`，以消费后续 UI/公共接口。A/B 原目录及现有改动保留。不要自行在 primary 或他人目录开工，也不要为准备 worktree 改动其它分支。

每人先保存当前自己的改动，再 `git fetch origin`、合并最新 `origin/main`。不 reset、clean、force-push，不切换其它 worktree 的分支。合并主线已验收产品路径时不得把旧候选覆盖回来。包内新增依赖请求交主线生成唯一 root lock；安装产生的临时锁差异不提交。

## 启动和交付约定

1. 读取当前 AGENTS、START-HERE、product-spec/README、本页和自己的任务。任务包含五个连续阶段，提交第一个检查点后继续整包，不逐缺陷停工。
2. 每包先写自有 RFC/interface 缺口及消费 fixture；需要公共 DTO 时由主线定义/生成，不能复制私有替代类型。包内合法领域类型可以存在，但不能冒充公共协议或另建 Work 生命周期。
3. 至少一次早期稳定检查点和一次整包交付。显式暂存拥有文件，只 push 自己分支；主线独立复验后集成。
4. 自有 `reports/execution-status.json` 记录阶段、commit/base、实际命令/证据、阻断和下一项。未运行原生的 fixture 结果保持 fixture；接口/schema/截图都不证明 native 兼容。
5. 模块未接线时继续独立消费/fixtures/负例；产品缺陷给 owner 最小复现。用户不在不代答用户真实权限/需求问题；测试可回答自己的隔离无害场景。
6. 全部可执行项完成或仅剩明确外部阻断时提交交接后结束，不无限轮询、空转或重复计费。

## 模型和环境预算

主线本 UI/规划轮 0 原生模型任务；A/C/D 0。B 新功能包经用户下发后最多 4 个显式小型原生任务，必须保留旧历史，按实际 attempt/begin 和未知发送记账，不能用换 commandId 偷重跑。E 默认 0；稳定后的单独发布复验可提出最多 1 个有界任务的需求，未经用户明确下发不执行。所有默认回归使用本机 controlled fixture / mock SDK，不发送模型请求。

不停止/重启现有 5180/8796 或 5181/8797 用户服务。每个写入、故障、迁移测试用自己的临时项目/state/端口并验证进程归属。凭据、账号 home、native session、数据库、node_modules、缓存和构建目录不进入 Git。

## 依赖和验收出口

| 检查点 | 可立即并行 | 正式接受依赖 |
| --- | --- | --- |
| 主线 UI | 现有公开 API + 同 schema fixture | 现有真实导入/委托/问题/交付不能退化 |
| A 工作流 | 仓储/迁移、搜索、版本设置和读索引 | 主线公共 DTO/命令与组合 |
| B Runtime | 受控 Driver/进程/恢复、原生预算内探针 | 主线确定性接线与独立证明 |
| C 助理能力 | 有界上下文、提案/决定领域规则及 fixtures | A 持久 port + 主线 reasoner/HTTP/命令组合 |
| D 发行迁移 | 构建布局、first-run、bundle manifest、路径/负例 | A 一致快照 port + 稳定 UI/关键产品流程 |
| E 验收 | harness、失败自测、现有产品回归、浏览器 | 新接口到达后只复验受影响面；native 另列 |

本轮退出是可日常使用并可交内部人员本机试用的候选版本；完整 G2/G3 是否通过按门槛证据逐项判断。第二执行器和 CAC 暂不占用 E，后置路线记录在整体文档。
