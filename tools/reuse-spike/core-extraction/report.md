# G0-A 提取与验证报告

- **分支**：`codex/g0-core-extraction`（本报告随本轮 commit 一并提交；commit 见 `git log -1`）
- **Base**：`f5c5754ec979fbee1d51c187cf0a5b7198e27477`（`f5c5754 docs: add Scheme B architecture and three-agent development baseline`）
- **工作目录**：`/Users/hh/Desktop/joker/superagent-agent-a`（fork 的独立 worktree）
- **唯一写入路径**：`tools/reuse-spike/core-extraction/`
- **环境**：`reports/environment.txt` — node v24.21.0、pnpm 11.7.0、Darwin arm64、上游 commit `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`

## 1. 方法

1. `scripts/extract.mjs --write` 用 `git show 8c32a9d:<path>` 把 18 个文件（15 个 `src/core/*.ts`、2 个测试、`LICENSE`）逐字节写入本目录；spike 布局镜像上游路径，**core 与测试零修改**。
2. `source-manifest.json` 记录每个文件的上游路径、SHA-256、字节数与改动说明（全部 `verbatim`）。
3. `scripts/extract.mjs`（默认模式）三向核对：manifest digest ↔ `git show` 实时 digest ↔ 磁盘文件 digest。

## 2. 实际命令与结果

所有命令在 `tools/reuse-spike/core-extraction/` 内执行，输出原件在 `reports/`：

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 安装 | `pnpm install` | PASS — devDependencies 仅 `@types/node@22.20.0`、`typescript@6.0.3`、`vitest@4.1.8`（与上游根 repo 版本一致），生成独立 `pnpm-lock.yaml` |
| 来源验证 | `pnpm extract` | PASS — 18/18 字节一致（`reports/extract-verify.txt`） |
| 类型图 | `pnpm typecheck` | PASS — `tsc --noEmit` 零错误（`reports/typecheck-output.txt`） |
| import 闭包 | `pnpm graph` | PASS（`reports/import-graph-output.txt`、`reports/import-graph.json`） |
| baseline | `pnpm test` | PASS — **144/144 通过**（`reports/test-output.txt`） |

测试结果原文：

```text
 ✓ tests/stage.spec.ts (31 tests) 2ms
 ✓ tests/core-engine.spec.ts (113 tests) 59ms
 Test Files  2 passed (2)
      Tests  144 passed (144)
```

与原仓基线的差异：**无**。数量一致（144），语义一致（测试文件与 core 均为上游字节副本）。

## 3. Import graph 结论

`scripts/import-graph.mjs` 从三个入口（core 库入口 + 两个测试）做**传递闭包**（不是一层 grep）：解析每个静态 `import`/`export … from`（含跨行子句，按 `import type`/`export type` 区分 type-only 边），相对路径解析到具体文件后继续下钻，断言不逃出本目录、外部模块仅限白名单。

| 入口 | 闭包文件数 | 外部模块 |
| --- | --- | --- |
| `src/core/index.ts` | 15 | `node:crypto` |
| `tests/core-engine.spec.ts` | 16 | `vitest`、`node:crypto` |
| `tests/stage.spec.ts` | 16 | `vitest`、`node:crypto` |

- 运行时边 46 条、type-only 边 27 条；两类边解析出的闭包同为这 15 个 core 文件。
- **无** `@deepseek-ai/*`、无 Cordis、无原插件根入口（`src/index.ts`）、无原 app Store（`src/app/store.ts`）——它们不在闭包内；core 只通过 `ports.ts` 接口（`Policy`/`Assessor`/`Executor`/`Outbox`/`Repositories`）与外界解耦。
- 旁证：`tsc --noEmit` 在只装了 @types/node/typescript/vitest 的隔离包里通过（类型图解析无需任何 DSH 包）；vitest 实际执行了全部代码（运行时图无缺环）。

## 4. CORE-01 验收映射

| 项 | 要求 | 结果 |
| --- | --- | --- |
| CORE-01 given | 固定上游 commit 的最小 core 和两个测试文件 | PASS — commit `8c32a9d`，18 文件 SHA-256 见 manifest |
| CORE-01 when | 在独立 package 运行并检查 runtime/type import graph | PASS — 独立 package/lock 实跑；传递闭包见第 3 节 |
| CORE-01 expected | 144-test baseline 保留且无 DSH 宿主依赖；MIT/来源齐全 | PASS — 144/144；`node:crypto` 是唯一 core 外部依赖；LICENSE + manifest 齐全 |
| CORE-01 evidence | 独立命令/lock/import graph/测试报告，不接受原仓报告替代 | 本目录 `reports/` + `pnpm-lock.yaml`，命令见第 2 节 |

结论：**CORE-01 = PASS**（范围：本隔离试验）。

## 5. 阻塞与限制

无阻塞。限制（如实申报，均不削弱 CORE-01）：

- 只在 macOS arm64 / node 24.21.0 / pnpm 11.7.0 实测；其他平台未测（NOT_TESTED）。
- 未运行原仓 `pnpm check` 的其余测试（panel、sources、bundle-patch 等）——它们测的是扩展层，不在提取范围。
- 本试验不构成 native/产品兼容证据；OPS-01、DATA-01 及一切 runtime/DB/E2E 项 NOT_TESTED。

## 6. 后续产品所需的最小扩展点（仅建议与失败用例，本轮不实现 WP-01）

对应 [03-契约与数据](../../../product-spec/03-contracts-and-data.zh-CN.md) §3.2，以下改动都保持「legacy 模式下 144-test baseline 原样通过」这一硬约束。

### 6.1 可信完成 gate（`completionMode` + `confirmCompletion`）

- **现状锚点**：`ready`/`dropped` 报告在 `Assignments.report` 内**立即结束** Ticket——`src/core/assignments.ts:129-132` 计算出 `outcome` 后直接 `this.tickets.end(...)`；`Tickets.end`（`src/core/tickets.ts:345`）是唯一结束点。
- **最小改造**：`EngineOptions`（`src/core/part.ts`）增加 `completionMode: 'legacy' | 'verified' | 'human_review'`；`verified`/`human_review` 下 `ready` 不再直接 `end`，改为记录当前候选（见 6.3）并把阶段投影为待验证；新增 `Engine.confirmCompletion(ref)`，并像 `engine.ts:261-270` 的既有角色 Pick 一样加一个仅供可信 verifier 的 `EngineForVerification`，内部核对当前 Assignment、候选未失效、必备证据齐全后**复用现有 `Tickets.end`** 完成。
- **失败用例（须新增测试）**：
  1. `confirmCompletion` 引用已被顶掉的 candidateGeneration → 拒绝（新增 `UserError`，如 `staleCandidate`）；
  2. 对已 ended 的 Ticket confirm → 显式拒绝，不静默 no-op；
  3. worker/Executor 路径调用 confirm → 类型层（角色 Pick）与运行时双重拒绝；
  4. `legacy` 模式下全部现有 `ready`→`end` 行为不变 → 原 144 基线不改一行照常通过；
  5. `verified` 模式下 `ready` 报告**不**结束 Ticket（新增显式测试，锁死分歧点）。

### 6.2 `reportAssignment`（带绑定的 additive 报告入口）

- **现状锚点**：`Engine.report(ticketId, report)`（`src/core/engine.ts:239` → `src/core/assignments.ts:99`）只绑定 ticketId，Assignment 在 `assignments.ts:110` 用 `runningAssignment(ticket) ?? latestAssignment(ticket)` **推断**；同文件其他 Executor 回调（`started`/`delivered`/`turnEnded`/`deliveryFailed`）都带 assignmentId 并经 `running()` 守卫（`assignments.ts:136-139`），`report` 是唯一例外。
- **最小改造**：给 `report` 增加显式 `assignmentId`（后续产品加 `reportId` 幂等键），经 `running()` 同款守卫拒绝非当前 Assignment 的报告。attemptId/fenceEpoch/contractRef 的完整 fence 在产品 Supervisor 事务桥内核对，core 只承诺 Assignment 级绑定。
- **失败用例（须新增测试）**：
  1. 报告指向已 ended/被替换的 assignmentId → `UserError`（现状：会静默合并进**新** Assignment 的状态，这是 attempt fencing 前必须堵上的洞）；
  2. `retry` 后旧 worker 迟到的报告（带旧 assignmentId）→ 拒绝，不污染新 Assignment；
  3. 相同 `reportId` 重放 → 幂等 no-op，不重复触发 Attention 撤回/Outbox 消息；
  4. 未知 ticketId → 保留现有 `UserError`。

### 6.3 candidate generation（候选失效）

- **现状锚点**：core 无候选概念；候选诞生点即 `assignments.ts:122` 的 `assignment.report = { state, summary, at }`（`ready` 时），最接近的 UI 钩子是 `ticketStage` 的 `{ stage: 'person', action: 'review' }`（`src/core/stage.ts`）。
- **最小改造**：在 `ready` 落点记录 `candidateGeneration`；在新 Input 送达（`Tickets.addInput`/`wake`）、`Tickets.retry`（新 Assignment）、会恢复执行的原生答案、影响该 Ticket 的策略变更处 bump generation；`confirmCompletion` 与 Verification/CompletionProposal 一律绑定当前 generation。
- **失败用例（须新增测试）**：
  1. generation 被 bump 后 `confirmCompletion` → `staleCandidate` 拒绝；
  2. 绑定旧 generation 的验证/提案 → 即使 artifact digest 相同也过不了 gate；
  3. `retry_assignment` 必须使既有候选失效（03 §7）；
  4. generation 作用域（per-Assignment vs per-Ticket）是 WP-01 的 ADR 决策点：per-Assignment 在 retry 时天然失效，per-Ticket 跨 retry 存活但需显式 bump——两者都要对用例 1-3 各测一遍。

## 7. 下游接手方式

- G0 结论由主 Agent 汇总；若通过，WP-01 以本目录的 `src/core/`（= 上游 `8c32a9d` 字节副本）为起点搬运到 `packages/orchestrator-core/`，连同第 6 节扩展点一起走 ADR；`pnpm-lock.yaml` 与本报告随目录交接。
- 任何人可用 README 的五步命令在本 checkout 复验全部证据；复验 provenance 需本地 git 历史含 `8c32a9d`（fork `main` 默认满足）。
- 本轮产物不影响仓库其他路径；未改根配置、未动其他 Agent 目录。
