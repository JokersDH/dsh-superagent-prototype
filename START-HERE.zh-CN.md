# 从这里开始：仓库、代码位置和三 Agent 开发

**当前派工入口：[第二轮整包排程](agent-tasks/wave-02/README.zh-CN.md)。** A 连续交付可信验证、产品仓储和工作台；B 连续交付独立运行时、Catalog/策略准备和首个 Driver；主 Agent 做问题中心、应用 API 和纵向集成。每人一个早期接口检查点、一次整包交付，不再每修一项就重新派工。

**个人助理工作台已接入：** 双击 `start.command` 或运行 `pnpm start`，打开 `http://127.0.0.1:5180` 即可使用，无需手动令牌。真实模型主对话、本机记录和模型切换已开放，见 [助手简介](docs/ASSISTANT-GUIDE.zh-CN.md)。停止用 `stop.command`/`pnpm stop`，重启用 `pnpm restart`。工作执行仍使用固定 scratch 子进程、原生问题与验证交付，见 [试用说明](docs/WORKBENCH.zh-CN.md)。A/B 候选准入仍分开验证，见 [最新交接](docs/rfcs/WP-16/0005-candidate-admission-and-workbench.md)；不代表任意仓库自动编码、原生兼容或完整 G2 通过。

主线最新检查点：已实现真实受控子进程的“委托 → 提问 → 回答 → 产物冻结 → 检查 → 接受交付”API 闭环，认证的 `GET /v1/configuration` 供工作台读取真实项目、执行器与验收默认值，`GET /v1/assistant` 只返回安全的模型连接状态。`pnpm check:g2-product` 覆盖 **188 项契约 + 154 项产品及模型适配测试**，实际结果见 [产品检查报告](reports/releases/g2-product.json)。接线见 [配置查询约定](docs/rfcs/WP-16/0004-application-configuration.md)，启动和代码位置见 [产品入口](apps/coordinator/product/README.md)。fixture 子进程不调用模型；主对话独立使用私有模型配置。浏览器产品、独立 Runner 重连和真实 agent 仍分开验收。

## 1. 唯一交付仓库

最新阶段：G0 已按 darwin/arm64 的限定范围验收通过，详见 [G0 主 Agent 交接](docs/adr/bootstrap/g0-main-report.md)。下表的首轮工作目录/分支用于追溯 G0；下一轮各自从集成 main 新开 G1 分支，A 转 WP-02，B 转 WP-03，主 Agent 转 WP-01/16。

G1 进度：正式 core/公共契约和 workspace 已交付，core 178 项及契约 183 项测试通过；[G1 核心交接](docs/adr/core/g1-core-handoff.md) 明确接口与剩余联调。整体 G1 尚未通过，等待 A 的存储和 B 的运行时接线。

历史恢复检查点（2026-11-08）：主线持久登记、恢复编排和队列接线 **56 项通过**，含 6 个真实 SIGKILL 窗口。其完整范围见 [登记恢复交接](docs/adr/core/g1-registered-recovery-handoff.md)。本轮已进一步复验并接入 A/WP-04，旧任务单仅保留历史追溯；当前仍执行 wave-02 整包。新增产品 SIGKILL 场景证明“不重复 begin、保留不确定状态”，没有将其当成独立 Runner 存活重连证据。

[JokersDH/dsh-superagent-prototype](https://github.com/JokersDH/dsh-superagent-prototype) 是后续方案 B 的交付仓库。架构、试验和正式实现都提交到这个仓库。

- `origin`：你的 fork，用于 fetch/push。
- `upstream`：DeepSeek 官方仓库，仅用于跟踪原型更新。
- `main`：主 Agent review 后集成的基线。
- `codex/g2-workspaces-verification`：Agent A 当前开发分支。
- `codex/g1-runtime`：Agent B 当前开发分支。
- 两个 `codex/g0-*` 分支保留为历史试验证据，不作为当前开发入口。

分支是同一仓库的开发线；本机 worktree 是各开发线的独立目录。它们共享 Git 对象和远程地址，各有自己的工作文件。修改不会自动出现在另一个目录，必须通过 commit 和集成流转。

## 2. 代码在哪里

| 路径（相对仓库根） | 内容 | 当前状态 |
| --- | --- | --- |
| `src/` | 原始 DeepSeek superagent 原型源码 | 已有，不作为新产品直接运行宿主 |
| `src/core/` | 待验证提取的 Ticket/Assignment 领域核心 | 已有；G0 先证明独立提取 |
| `tests/` | 原型测试，包含 core baseline | 已有 |
| `docs/`、`prompts/`、`skills/` | 上游原型文档和模型资产 | 已有 |
| `product-spec/` | 完整架构、契约草案、17 个任务包、83 条验收要求 | 已有设计，不等于产品已实现 |
| `agent-tasks/` | 当前三人的直接开工指令 | 已有 |
| `tools/reuse-spike/core-extraction/` | Agent A 的隔离提取源码、测试、lock、报告 | CORE-01 已独立复核通过 |
| `tools/reuse-spike/platform/` | Agent B 的运行时/SQLite 探针和报告 | 补齐漏交 helper 后，G0 平台探针独立复核通过 |
| `packages/contracts/` | 公共运行时 schema/生成类型/JSON Schema/版本哈希 | G0 v1 已实现，183 项测试和独立 package 检查通过 |
| `apps/coordinator/runtime-ingress.ts` | 事实严格准入、身份/去重和单事务 interface | 已通过 25 项测试；生产 binding/IPC 仍待接线 |
| `apps/coordinator/stored-ingress.ts` | 实际仓储/事实回执/core 的组合适配 | 新增 5 项受控进程集成测试通过；完整恢复待下一批 |
| `apps/coordinator/recover-facts.ts` | 原载荷恢复、严格预检、幂等事实重放 | 恢复 9 项通过（含两个 SIGKILL）；不重启原生业务 |
| `apps/coordinator/runner-link.ts`、`resource-barrier.ts` | 本机认证查询/取消，可信完整资源清单与事务屏障 | 17 项通过（含独立进程重连）；生产 Runner daemon/注册仍待接线 |
| `apps/coordinator/runner-registry.ts`、`reconcile-runner.ts`、`recovery-effects.ts` | 持久可信登记、稳定取消意图、恢复编排、现有队列接线 | 合计 56 项通过，含 6 个 SIGKILL；实际 AttemptRunner daemon 接入待完成 |
| `packages/orchestrator-core/` | 正式提取及最小扩展后的 core | 已实现第一批：legacy 144 + 新守卫 34 项测试 |
| `packages/storage/`、`effects/`、`execution/`、`driver-kit/`、`testing/` | 持久化、队列、运行时基础与受控测试 | 已有实现与分范围验收；完整运行时/产品数据仍在推进 |
| `packages/workspaces/`、`verification/` | 可信交付模块 | A `8f1e60a` 后端已复验并接入；30 项测试及既有准入探针通过 |
| `packages/questions/`、`application/` | 问题中心和确定性应用 | 已有 SQLite/API 接线和受控产品集成；分别 14/11 项模块测试 |
| `packages/catalog/`、`policy-preparation/`、`drivers/` | 执行器接入 | B 候选独立验收；不能将协议 fixture 当作已安装原生 agent 兼容证据 |
| `apps/coordinator/product/` | 真实受控子进程、问题和验收组合入口 | 新增 14 项集成场景；真实 loopback HTTP 可通过 smoke 脚本执行 |
| `apps/coordinator/`、`apps/runner/` | 新产品组合适配与受控运行基础 | 组合模块已实现；真实产品进程入口本轮接线 |
| `apps/console/`、`apps/cli/` | 网页工作台、CLI | 工作台本轮启动；CLI/发行后续推进 |

**落点已确定：新产品在这个仓库根目录增加 `packages/`、`apps/`、`tools/`，不再另建产品仓库。** 根 workspace/package 配置由主 Agent 单独集成；G0 试验使用自己的子目录 package，不先改原插件运行方式。

## 3. 本机三个工作目录

| 角色 | 本机目录 | 当前分支/目标 | 当前整包 |
| --- | --- | --- | --- |
| 主 Agent（当前会话） | `/Users/hh/Desktop/joker/superagent` | `main` 为集成目标，实施用 `codex/*` | 问题中心、确定性应用/API、独立集成 |
| Agent A | `/Users/hh/Desktop/joker/superagent-agent-a` | `codex/g2-workspaces-verification` | 可信交付、产品仓储、工作台 |
| Agent B | `/Users/hh/Desktop/joker/superagent-agent-b` | `codex/g1-runtime` | 独立 Runner、Catalog/策略、首个 Driver |

这三个是同一个 fork 的三个 checkout。没有把你的 CAC 仓库搬进来，也没有将本机的 node_modules、凭据或模型会话作为共享材料。

## 4. 如何让另外两个 Agent 开始

在 Agent A 的工具里打开 `/Users/hh/Desktop/joker/superagent-agent-a` 作为项目/工作目录，然后发送：

```text
继续本轮 Agent A 整包。工作目录是 /Users/hh/Desktop/joker/superagent-agent-a，分支 codex/g2-workspaces-verification。
保留已有改动，fetch 并合并最新 origin/main，读取 AGENTS.md、agent-tasks/wave-02/README.zh-CN.md 和 agent-tasks/wave-02/agent-a.zh-CN.md。
连续完成可信交付、产品仓储和工作台，不在旧修复后停下。提交一次后端接口检查点后继续 UI，最后统一交付。
只提交拥有路径并 push 自己分支；根 lock、公共 schema 和 main 由主 Agent 管理。
```

在 Agent B 的工具里打开 `/Users/hh/Desktop/joker/superagent-agent-b`，然后发送：

```text
继续本轮 Agent B 整包。工作目录是 /Users/hh/Desktop/joker/superagent-agent-b，分支 codex/g1-runtime。
保留已有改动，fetch 并合并最新 origin/main，读取 AGENTS.md、agent-tasks/wave-02/README.zh-CN.md 和 agent-tasks/wave-02/agent-b.zh-CN.md。
连续完成 Journal、实际 Runner 服务、Catalog/策略和首个 Driver，不在旧修复后停下。提交一次运行时接口检查点后继续后续步骤，最后统一交付。
只提交拥有路径和明确提取例外并 push 自己分支；根 lock、公共 schema 和 main 由主 Agent 管理。
```

两人可立即并行；未通过部分的生产验收仍保留，fixture 下游开发不等待完整上线。主 Agent 按 [整包任务](agent-tasks/wave-02/main.zh-CN.md) 推进公共部分。转发任务入口即可，无需复制历史对话。

## 5. 每个人怎么上传

每人按实际改动显式暂存拥有文件，提交前用 `git diff --cached --name-only` 核对范围。不要将根 lock 的临时安装差异、凭据、DB、依赖和未交接代码带入提交。Agent A 只 push：

```sh
git push -u origin codex/g2-workspaces-verification
```

Agent B 只 push：

```sh
git push -u origin codex/g1-runtime
```

主 Agent 消费检查点 commit，复验后分段集成 main。A/B 提交检查点后继续各自整包内的独立工作，不等待每个小修复的确认，也不自行合并彼此分支或改别人路径。

## 6. 本轮交付出口

- A：可信完成边界与应用仓储可集成，工作台的委托/问题/停止/交付/恢复场景可操作。
- B：实际独立 AttemptRunner、verified Journal、接入与策略 gate、首个 Driver 协议 fixture 可集成。
- 主 Agent：问题中心、应用/HTTP 与统一 G2-Demo-Fake 纵向验收；有真实环境和授权预算后才升级 native preview。

完整要求、接口、检查点和后续范围见 [本轮排程](agent-tasks/wave-02/README.zh-CN.md)。旧 G0 材料在 [bootstrap 交接](docs/adr/bootstrap/g0-main-report.md)；历史设计分工保留在 product-spec，不再作为本轮开工模板。

## 7. 其他机器上的 Agent

同机可以直接使用已准备的两个 worktree。其他机器先 clone 你的 fork，再 checkout 对应远程分支；以该机器的 clone 目录为工作目录，读取相同任务文件。

```sh
git clone https://github.com/JokersDH/dsh-superagent-prototype.git
cd dsh-superagent-prototype
git switch --track origin/codex/g2-workspaces-verification
```

Agent B 使用 `origin/codex/g1-runtime`。已有 checkout 保留当前工作并合并 main，不重新执行示例 checkout 覆盖工作。提交/push 使用该机器自己的正常 GitHub 权限，不复制本机 token。
