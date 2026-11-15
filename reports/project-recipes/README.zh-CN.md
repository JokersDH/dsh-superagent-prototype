# J 报告：项目任务/检查声明配方

工作树 `/Users/hh/Desktop/joker/superagent-agent-j`，分支 `codex/g5-project-recipes`。

- 当前（wave-28）机读状态：[wave28-status.json](wave28-status.json)
- 历史（wave-27）机读状态：[wave27-status.json](wave27-status.json)

---

# wave-28（2026-11-15）

起点 `46020ff2`，合并 `origin/main`（wave-28 派工，`ea82d8f`）后按 `agent-tasks/product-wave-28/agent-j-project-recipes.zh-CN.md` 推进。

## 1. 修复的实际缺陷

独立验收记录（`reports/releases/wave28-admission/experience-recipes.json`，`J28-ORIGINAL-SCOPE-CONSUMER-COMPATIBILITY`）指出两个问题，本轮都已关闭：

1. **尾斜杠与 `.` 被误拒**：原应用的合作 scope 常见 `['src/']`、`['.']`，旧 matcher 的前缀判断把它们当非法条目。
2. **子路径草稿不可用**：旧 matcher 用前缀包含，`['src']` grant + `['src/file.ts']` 选择会产出 schema-valid 的 `draft`，但同配置的真实 `createProductApplication` 以 `forbidden: Scope exceeds the configured project grant` 拒绝。

根因是语义取错：原 `scopeWithin`（`packages/questions/src/validation.ts`、`packages/context/src/paths.ts`）是**声明原子包含**——`scope.allowedPaths.every(path => grant.allowedPaths.includes(path))`，逐字比较，不是前缀/glob。

现在的规则（`packages/project-recipes/src/scope.ts`）：

- 草稿的 allowed 原子必须是配置已声明的原子（逐字），`src/` 与 `src` 不同，`src/file.ts` 不是 `src/` 的更小形式；
- 配置的排除原子必须全部保留（只能增加）；
- `externalActions` 只能子集（恒为空）；`expiresAt` 不得晚于 grant；
- `.`、尾斜杠等原字符串逐字保留；
- 需要更小范围 → 走原配置授权流程，配方不新增授权原子。

## 2. 双向验证（source + controlled）

`tools/project-recipes/test/actual-application.case.ts` 用真实 `ProductStore`（临时 SQLite）+ 真实 `createProductApplication`，同一配置下：

| 场景 | 结果 |
| --- | --- |
| 草稿（`src/` 或 `.`）→ `create_work` → `dispatch` | `recorded`，返回 workId |
| 强制把 `src/file.ts` 直接送 Application | `rejected`，`error.code = forbidden`，消息 `Scope exceeds the configured project grant` |
| 验收场景：grant `['src']` + 选择 `['src/file.ts']` | matcher `needs_input: scope_path_outside_allowed` |
| 验收场景：grant `['src']` + 选择 `['src']` | `recorded` |
| 整链：授权根 → observer facts → 同配置 draft → preview 字段 → `dispatch` | `recorded` |
| 配置里移除 `src/` 原子后再请求 | `needs_input`，provenance 记录新 revision |

## 3. 只读事实模块（单一实现）

`tools/project-recipes/metadata.ts` 已删除，读取器移入 `packages/project-recipes/src/observe.ts`，CLI 与 main 共用一个实现：

```ts
const observer = createProjectFactsObserver({ rootFor: (projectId) => registeredRoots.get(projectId) })
const { facts, notes } = observer.observe({ projectId, observedAt })
```

- `observe()` 入参没有 path：公开请求无法指定任意根；未登记项目 → `root_not_registered`。
- 边界不变：绝对根、白名单名字、`O_NOFOLLOW`+`fstat`、256 KiB/4 MiB/12 文件/8 MiB、只解析 `package.json`、锁文件只哈希、不读 home/env/凭据、不执行 scripts 或 `--version`。
- 拒绝不回显明文；根被替换、文件缺失/截断、超限都在边界拒绝。

## 4. 实际验证（本机，Node 24.21.0）

| 命令 | exit | 结果 |
| --- | --- | --- |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.json` | 0 | strict |
| `node --test packages/project-recipes/test/*.case.ts` | 0 | 61 tests / 61 pass |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.build.json` | 0 | dist |
| `./node_modules/.bin/tsc -p tools/project-recipes/tsconfig.json` | 0 | strict |
| `node --test tools/project-recipes/test/*.case.ts` | 0 | 20 tests / 20 pass |
| `node packages/project-recipes/examples/preview-consumer.ts` | 0 | 三种状态自检 |
| `node agent-tasks/product-wave-28/verify.mjs` | 0 | 静态派工校验 |
| `npm pack --dry-run` | 0 | 34 files / 36,643 bytes（仅 `dist/` + `README.md`） |

CLI 实测：

| 场景 | exit | 观察 |
| --- | --- | --- |
| `--paths src/` | 0 | `draft` |
| `--paths src/file.ts` | 3 | `needs_input scope_path_outside_allowed` |
| `--paths src`（配置声明 `src/`） | 3 | `needs_input scope_path_outside_allowed` |
| `--kind scoped_change`（无原子） | 3 | `needs_input scope_paths_required` |
| 缺 `--facts/--root` | 2 | usage |
| facts 文件不存在 | 5 | `refused [unreadable]` |

真实应用消费者的构建闭包（一次性，不触碰根 lock）：`effects`、`orchestrator-core`、`storage`、`questions`、`application` 的 `tsconfig.build.json`。

## 5. 日常流程观察（J22，零模型）

用本轮 CLI 对**一个真实授权的 monorepo 根**（本工作树自身，只读）做观察：

- 观察结果：`pnpm` 管理、workspace/monorepo 声明、TypeScript 标记、声明脚本名，`provenance.source = authorized_metadata`。
- 配合一份受控配置（`allowedPaths: ['packages/']`）得到 `draft`：goal 文案、`packages/` 原子、`tests` criteria、`profile-native` 四项由模板预填；人工基线需要逐项手写这四类字段。
- 这只是一次字段级观察：没有用户研究，不声称节省时间/提升质量，也未运行任何被 BLOCKED 的试点。

## 6. 未达与分层

| 层 | 状态 | 说明 |
| --- | --- | --- |
| source | PASS | 库/CLI/测试/构建见上表 |
| controlled | PASS（受控配置） | 真实 Application + 临时 Store；只做 `dispatch` 记账，无真实模型/原生 |
| installed | NOT_REACHED | 未产出也未准入安装包；`npm pack --dry-run` 只列内容 |
| native | NOT_APPLICABLE | 真实 vendor/model/native 调用 = 0 |
| value | NOT_CLAIMED | 不声称效率/收益 |
| activation | NOT_REACHED | main 未接 HTTP/App，F 未接表单（`unadmittedJRecipesDefaultEnabled=false`） |

main/F 未消费的部分：main 尚未发布 recipe 的 HTTP/表单入口，F 的呈现适用性是 F 自己的 finding（`F28-UNQUALIFIED-RECIPE-DISPLAY-ADMISSION`）；E 的独立断言未新增或修改。

## 7. 交给 main 的一件事

J 不修改根 `pnpm-lock.yaml`。main 运行 `pnpm install` 时需新增 `packages/project-recipes` importer（内容见 [main-integration](../../docs/project-recipes/main-integration.zh-CN.md) 第 1 节）。合入前请用 `tsc`/`node --test` 形式复跑，`pnpm --dir …` 会改写根 lock。

边界不变：未安装/运行/注册任何项目命令或检查，未写 SQL/账本，未启动模型/原生，未触碰十二服务与用户 state；只提交自有四类路径。

---

# 历史：wave-27（2026-11-14）

起点 `ca01e17`，交付三层：纯 typed catalog（三配方）、只读 facts 读取器 + CLI、草稿到 `create_work` 命令候选。当时 42 库 / 30 tools 测试通过，`reports/project-recipes/wave27-status.json` 记录逐阶段证据。

wave-28 修正了当时的 scope 语义（前缀→声明原子）并把读取器上移为 runtime export；wave-27 的数字与结论按当时 source 保留，不重标。
