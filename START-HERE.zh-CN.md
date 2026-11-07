# 从这里开始：仓库、代码位置和三 Agent 开发

## 1. 唯一交付仓库

最新阶段：G0 已按 darwin/arm64 的限定范围验收通过，详见 [G0 主 Agent 交接](docs/adr/bootstrap/g0-main-report.md)。下表的首轮工作目录/分支用于追溯 G0；下一轮各自从集成 main 新开 G1 分支，A 转 WP-02，B 转 WP-03，主 Agent 转 WP-01/16。

G1 进度：正式 core/公共契约和 workspace 已交付，core 177 项及契约 183 项测试通过；[G1 核心交接](docs/adr/core/g1-core-handoff.md) 明确接口与剩余联调。整体 G1 尚未通过，等待 A 的存储和 B 的运行时接线。

[JokersDH/dsh-superagent-prototype](https://github.com/JokersDH/dsh-superagent-prototype) 是后续方案 B 的交付仓库。架构、试验和正式实现都提交到这个仓库。

- `origin`：你的 fork，用于 fetch/push。
- `upstream`：DeepSeek 官方仓库，仅用于跟踪原型更新。
- `main`：主 Agent review 后集成的基线。
- `codex/g0-core-extraction`：Agent A 首轮分支。
- `codex/g0-platform-validation`：Agent B 首轮分支。

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
| `packages/orchestrator-core/` | 正式提取及最小扩展后的 core | 已实现第一批：legacy 144 + 新守卫 33 项测试 |
| `packages/storage/`、`effects/`、`execution/` 等 | 新产品各后端模块（均位于 packages 下） | 按后续任务包实现 |
| `apps/coordinator/`、`apps/runner/`、`apps/console/`、`apps/cli/` | 新产品后台、受控 Runner、网页、CLI | 按后续任务包实现 |

**落点已确定：新产品在这个仓库根目录增加 `packages/`、`apps/`、`tools/`，不再另建产品仓库。** 根 workspace/package 配置由主 Agent 单独集成；G0 试验使用自己的子目录 package，不先改原插件运行方式。

## 3. 本机三个工作目录

| 角色 | 本机目录 | 分支 | 首轮任务 |
| --- | --- | --- | --- |
| 主 Agent（当前会话） | `/Users/hh/Desktop/joker/superagent` | `main`（集成基线） | 公共契约、bootstrap、G0 汇总与 review |
| Agent A | `/Users/hh/Desktop/joker/superagent-agent-a` | `codex/g0-core-extraction` | core 提取和独立测试 |
| Agent B | `/Users/hh/Desktop/joker/superagent-agent-b` | `codex/g0-platform-validation` | 隔离运行组合、SQLite 事务与备份探针 |

这三个是同一个 fork 的三个 checkout。没有把你的 CAC 仓库搬进来，也没有将本机的 node_modules、凭据或模型会话作为共享材料。

## 4. 如何让另外两个 Agent 开始

在 Agent A 的工具里打开 `/Users/hh/Desktop/joker/superagent-agent-a` 作为项目/工作目录，然后发送：

```text
你负责这个 fork 的 G0-A。工作目录是 /Users/hh/Desktop/joker/superagent-agent-a。
读取 AGENTS.md、START-HERE.zh-CN.md 和 agent-tasks/agent-a.md，按任务文件实施。
先核对当前分支为 codex/g0-core-extraction；只编辑 tools/reuse-spike/core-extraction/。
完成后测试、只提交自己的文件，push 到 origin 的同名分支，报告 commit、命令、结果和证据路径。
不要改公共契约、根依赖和其他人的目录，不要合并或推送 main。
```

在 Agent B 的工具里打开 `/Users/hh/Desktop/joker/superagent-agent-b`，然后发送：

```text
你负责这个 fork 的 G0-B。工作目录是 /Users/hh/Desktop/joker/superagent-agent-b。
读取 AGENTS.md、START-HERE.zh-CN.md 和 agent-tasks/agent-b.md，按任务文件实施。
先核对当前分支为 codex/g0-platform-validation；只编辑 tools/reuse-spike/platform/。
完成后测试、只提交自己的文件，push 到 origin 的同名分支，报告 commit、命令、结果和证据路径。
不要改公共契约、根依赖和其他人的目录，不要合并或推送 main。
```

两个工作可以立即并行，不依赖尚未冻结的生产契约。主 Agent 同时按 [主 Agent 任务](agent-tasks/main.md) 推进公共部分。你只需要选对目录并发出对应任务，不需要把整段历史对话再发给他们。

## 5. 每个人怎么上传

Agent A 在自己的目录执行：

```sh
git add -- tools/reuse-spike/core-extraction/
git commit -m "test(g0): validate independent core extraction"
git push -u origin codex/g0-core-extraction
```

Agent B 在自己的目录执行：

```sh
git add -- tools/reuse-spike/platform/
git commit -m "test(g0): validate isolated runtime and sqlite"
git push -u origin codex/g0-platform-validation
```

提交前检查 staged files，临时 DB、依赖、原生会话和凭据不能提交。每个 Agent 应给自己的目录增加合适的局部 ignore 规则或将临时文件放在系统临时目录。命令是交付流程，不能在没有实现时制造空提交。

主 Agent fetch 两个分支，review commit 和证据，再选择性集成到 main；通过后 push main。A/B 不自行合并彼此分支，也不在等待期间修改别人的路径。

## 6. 本轮完成标准

- A：独立 core/test package 可运行，原 144-test baseline 在提取目录执行，runtime/type import graph 不依赖 DSH 宿主，保留 MIT/provenance。
- B：拟议组合在隔离环境实际加载，SQLite 版本、事务/savepoint/回滚/备份恢复有真实结果；未测 OS/arch 不算通过。
- 主 Agent：公共 schema 单一来源、合法/非法 fixtures、生成类型和版本锁，汇总真实证据，给出 G0 结论。

G0 通过后：主 Agent 转 WP-01/16，A 转 WP-02，B 转 WP-03。后续完整顺序见 [三人排程](product-spec/three-agent-dispatch.zh-CN.md)。

## 7. 其他机器上的 Agent

同机可以直接使用已准备的两个 worktree。其他机器先 clone 你的 fork，再 checkout 对应远程分支；以该机器的 clone 目录为工作目录，读取相同任务文件。

```sh
git clone https://github.com/JokersDH/dsh-superagent-prototype.git
cd dsh-superagent-prototype
git switch --track origin/codex/g0-core-extraction
```

Agent B 使用 `origin/codex/g0-platform-validation`。提交/push 需要该机器有你授予的正常 GitHub 权限；不把本机 token 复制进仓库。
