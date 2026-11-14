# J 报告：可复用项目任务/检查声明配方（wave-27）

日期：2026-11-14。分支 `codex/g5-project-recipes`，工作树 `/Users/hh/Desktop/joker/superagent-agent-j`，基于 `ca01e17`（fetch 后已与 `origin/main` 一致）。

机读状态见 [wave27-status.json](wave27-status.json)。本文说明实际交付、可复跑的验证、以及明确**未达**的范围。

## 1. 判读结论

- 交付了**可编译、可测试、可复跑**的三层：纯 typed catalog、只读 facts 读取器 + CLI、草稿到 `create_work` 命令候选的接线。
- fixture 与 native 配置明确区分：fixture 配置只产出 fixture profile，草稿不出现 native 字样；native 配置也不继承 fixture readiness；显式 profile 选择不会被替换。
- 三配方（缺陷回归修复 / 有限范围变更 / 既有检查验证跟进）在真实配置上产出完整 `draft`，缺能力输入产出 `needs_input` 或 `unsupported`，并带 provenance、配置 revision、facts 摘要与 `authorization: "none"`。
- 所有建议只引用**当前配置里已存在**的项目、scope 路径、profile 与已登记检查；scope 只能收窄，`externalActions` 恒为空。
- 没有安装、运行、注册任何项目命令/检查，没有模型或原生调用，没有 SQL/账本/新执行生命周期。
- **未达**：main 的 App/HTTP 组合、F 的实际表单、E 的独立验收、monorepo 成员枚举、包管理器版本探测、任何 installed/native 结论。草稿不是执行，也不是检查通过的证明。

## 2. 实际验证（本机，Node 24.21.0）

| 命令 | exit | 结果 |
| --- | --- | --- |
| `pnpm --dir packages/contracts build` | 0 | 复用既有依赖（未改动） |
| `pnpm --dir packages/project-recipes typecheck` | 0 | strict / exactOptionalPropertyTypes |
| `pnpm --dir packages/project-recipes test` | 0 | 41 tests / 41 pass / 0 fail |
| `pnpm --dir packages/project-recipes build` | 0 | `dist/`（不提交） |
| `./node_modules/.bin/tsc -p tools/project-recipes/tsconfig.json` | 0 | CLI/读取器/测试同等严格 |
| `node --test tools/project-recipes/test/*.case.ts` | 0 | 29 tests / 29 pass / 0 fail |
| `node packages/project-recipes/examples/preview-consumer.ts` | 0 | draft + needs_input + draft；生成的 `create_work` 过公开 schema |
| `node agent-tasks/product-wave-27/verify.mjs` | 0 | `PASS_TEN_AGENT_DISPATCH_STATIC_ONLY`（静态结构/预算/所有权） |

CLI 行为（真实执行）：

| 场景 | exit | 观察 |
| --- | --- | --- |
| `--facts` + `--paths src/parser.ts` | 0 | `draft`，revision 已计算 |
| `--kind scoped_change`（无路径） | 3 | `needs_input scope_paths_required` |
| facts 指向不存在项目 | 4 | `unsupported project_unknown` |
| 缺少 `--facts/--root` | 2 | usage |
| facts 文件不存在 | 5 | `refused [unreadable]` |
| `--output` 指向已有文件 | 5 | 原文件字节不变 |

## 3. 交付物

| 路径 | 内容 |
| --- | --- |
| `packages/project-recipes/src/facts.ts` | `project-facts/1`：名字/摘要/计数/封闭枚举，无脚本正文、无绝对路径 |
| `packages/project-recipes/src/catalog.ts` | 三配方目录 v1 + 内容摘要 |
| `packages/project-recipes/src/match.ts` | 确定性 matcher（无时钟/环境/文件/网络） |
| `packages/project-recipes/src/draft.ts` | `project-recipe-draft/1` + revision 校验 |
| `packages/project-recipes/src/preview.ts` | `CreateWorkFields` / `toCreateWorkCommand` / 过期保护 |
| `packages/project-recipes/examples/preview-consumer.ts` | 可运行消费者样例（自检） |
| `tools/project-recipes/metadata.ts` | 有界只读观察（NOFOLLOW/fstat/预算/白名单） |
| `tools/project-recipes/cli.ts` | CLI：0/3/4 结果，2 用法，5 拒绝；`--output` 只新建 |
| `docs/project-recipes/README.zh-CN.md` | 支持范围、事实来源、CLI、码表、故障矩阵、成本/隐私、兼容、复跑 |
| `docs/project-recipes/main-integration.zh-CN.md` | main/F 具体接线与 lock importer |

## 4. 交给 main 的一件事

J 不修改根 `pnpm-lock.yaml`。main 运行 `pnpm install` 时需要新增 `packages/project-recipes` importer（内容见 [main-integration](../../docs/project-recipes/main-integration.zh-CN.md) 第 1 节；`@personal-agent/contracts: workspace:*`、`zod 4.4.3`、`@types/node 24.10.0`、`typescript 6.0.3`）。在该 importer 合入前，本工作树内的类型检查/测试依赖已建立的本地 link，`--frozen-lockfile` 会认为 lock 过期。

## 5. 边界与不变项

- 未触碰：`pnpm-lock.yaml`、根 `package.json`、`packages/contracts/`、`apps/`、A/B/C/D/E/F/G/H/I 任何路径。
- 未触碰用户资源：十二服务 5180–5191 / 8796–8807、state/profile/tar/ledger、B 旧 report+b16、C lock、E runs 与日志。
- 自动真实 vendor/model/native 调用 0；B cap4 UNKNOWN 未花；E pilot 未重置/未补样。
- 静态检查 PASS 不等于 runtime/native/release 准入；69/100 与 50.8% 未变。
