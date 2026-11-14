# 项目任务/检查声明配方（project-recipes）

日期：2026-11-14。范围：`packages/project-recipes/`、`tools/project-recipes/`、`docs/project-recipes/`、`reports/project-recipes/`。

这是**选择与声明**层，不是执行层。它把「明确观察到的项目事实 + 当前公开 `ApplicationConfiguration` + 任务类型 + 用户显式选择」变成三种结果之一：完整草稿 `draft`、待补输入 `needs_input`、不支持 `unsupported`。草稿只是数据，必须走应用原有的预览与明确确认；本模块不安装、不运行、不注册任何检查或脚本，不调用模型/agent，不写数据库或账本，也不创建第二套执行生命周期。

---

## 1. 支持范围

| 维度 | 支持 | 明确不支持 |
| --- | --- | --- |
| 项目栈 | Node（`package.json`） | Python/Go/Rust/Java 等（`stack_not_node`） |
| 包管理器 | `pnpm`、`npm`；无声明/无锁文件（`none`）也可给建议 | `yarn`、`bun`（`manager_unsupported`） |
| 任务类型 | `regression_fix`、`scoped_change`、`verification_followup` | 其他 kind（调用方用法错误，CLI exit 2） |
| 配置协议 | `application-configuration/1` | 其他版本（`configuration_unsupported_version`） |
| 事实协议 | `project-facts/1` | 其他版本（`invalid_facts`，CLI exit 5） |
| 布局 | 单包；monorepo/workspace 根需显式成员路径 | 自动成员枚举（不解析 `pnpm-workspace.yaml` 内容） |
| 检查 | 只引用配置里已登记的 `checkDefinitionRef` | 从 `package.json` scripts 反推命令、注册新检查 |

三种配方的语义：

| kind | 建议的重点 | scope | criteria |
| --- | --- | --- | --- |
| `regression_fix` | 最小修复 + 回归证据，让已登记检查重新通过 | 必须显式给出更窄路径 | 项目默认 criteria 全集 |
| `scoped_change` | 只在列出路径内做有限变更 | 必须显式给出路径 | 项目默认 criteria 全集 |
| `verification_followup` | 只跟进已有检查结果，不新增能力 | 可用项目 scope | 只取已登记的机器检查 |

---

## 2. 事实（facts）从哪来

只接受两种来源，二者都写进 `provenance`：

1. **注入**（`source: "injected"`）：main 或已有 inspection 已经观察好，直接传入。优先这种方式，避免重复扫描环境。
2. **授权只读读取**（`source: "authorized_metadata"`）：由 `tools/project-recipes` 的读取器在**显式给出的绝对根目录**下观察。

`project-facts/1` 只包含名字、摘要、计数和封闭枚举：

```jsonc
{
  "protocol": "project-facts/1",
  "projectId": "project-alpha",
  "observedAt": "2026-11-14T11:55:00.000Z",
  "provenance": { "source": "injected", "provider": "coordinator-project-settings/1", "authority": "none", "scope": "package", "inputs": [] },
  "stack": { "kind": "node", "packageManagerField": "pnpm@11.7.0", "enginesNode": ">=24" },
  "manager": { "kind": "pnpm", "declaredVersion": "11.7.0" },
  "locks": [{ "name": "pnpm-lock.yaml", "digest": "…64 hex…" }],
  "workspace": { "declaration": "none" },
  "scripts": ["build", "test"],
  "languages": ["node", "typescript"],
  "missing": []
}
```

关键语义：

- `scripts` 只有**名字**（排序去重、最多 512 条）；脚本正文从不读取，也不会出现在输出里。
- `locks` 只记录白名单文件名与摘要；锁文件内容不解析。
- `manager: { kind: "unknown" }` 表示「没能确定」，不是「没有」；`none` 才是「确认没有声明也没有锁文件」。
- `missing` 列出观察缺口；缺口不会被补成默认值。
- `provenance.authority` 恒为 `none`：事实是数据，不含执行许可。
- `observedAt` 由调用方给出；`matchRecipe` 用调用方传入的 `now` 判断是否过期（默认 60 分钟），因此结果可复现。

### 读取边界（`tools/project-recipes/metadata.ts`）

- 根目录必须**绝对路径**、已存在、是目录；拒绝 `/` 与用户 home。
- 只打开根目录下白名单名字：`package.json`、`tsconfig.json`、`pnpm-workspace.yaml`、`package-lock.json`、`pnpm-lock.yaml`、`npm-shrinkwrap.json`、`yarn.lock`、`bun.lockb`、`pyproject.toml`、`go.mod`、`Cargo.toml`、`pom.xml`、`build.gradle`。不递归、不进子目录。
- 每次都 `O_NOFOLLOW` + `fstat`：符号链接、非普通文件一律拒绝；读完后再次确认父目录仍是原根（防路径替换）。
- 默认上限：`package.json` 256 KiB，锁文件 4 MiB，最多读 12 个文件，整次观察 8 MiB；超出即拒绝。
- 只解析 `package.json` 的 JSON；YAML/锁文件只做存在性判断或有界哈希。
- 不读 home、环境变量、`.npmrc`、凭据；不执行 `--version` 或任何项目脚本。

---

## 3. CLI

```sh
# 最小前置（workspace 依赖）：只构建 contracts，不安装任何项目依赖
pnpm --dir packages/contracts build

# 1) 直接使用已观察事实
node tools/project-recipes/cli.ts \
  --config tools/project-recipes/fixtures/configuration.json \
  --facts  tools/project-recipes/fixtures/facts-alpha.json \
  --now 2026-11-14T12:00:00.000Z \
  --kind regression_fix --paths src/parser.ts

# 2) 显式授权根目录，按白名单只读观察
node tools/project-recipes/cli.ts \
  --config tools/project-recipes/fixtures/configuration.json \
  --root tools/project-recipes/fixtures/example-project \
  --project project-alpha --paths src --now 2026-11-14T12:00:00.000Z

# 3) 写到新文件（已存在则拒绝，绝不覆盖）
node tools/project-recipes/cli.ts … --output /tmp/recipe-draft.json
```

参数：

| 参数 | 说明 |
| --- | --- |
| `--config <file>` | 必需。公开 `ApplicationConfiguration` JSON 快照；只做 schema 校验。 |
| `--facts <file>` | 与 `--root` 二选一。`project-facts/1` JSON。 |
| `--root <dir>` | 与 `--facts` 二选一。明确授权的绝对项目根。 |
| `--project <id>` | 省略时取 `--facts` 的 `projectId`；若用 `--root` 则要求配置里只有唯一项目。两者不一致直接拒绝（exit 2）。 |
| `--kind <kind>` | 默认 `regression_fix`。 |
| `--paths a,b` / `--exclude c` / `--criteria x,y` / `--profile <id>` | 显式选择；只可在配置允许集合内收窄。给空值（如 `--paths ""`）是用法错误（exit 2）。 |
| 省略 `--paths` | 表示「没有额外收窄」：`verification_followup` 用项目 scope；两个需要边界的配方则返回 `needs_input: scope_paths_required`。 |
| `--now <ISO>` | 决定 facts 新鲜度；省略用当前时间（测试与复跑请显式给出）。 |
| `--max-facts-age-ms <n>` | 覆盖默认 60 分钟上限。 |
| `--output <新文件>` | 仅在文件不存在时写入（`O_EXCL`），同时仍把 JSON 打到 stdout。 |
| `--help` / `-h` | 不读取任何文件。 |

退出码：

| code | 含义 |
| --- | --- |
| `0` | `draft`（完整建议） |
| `2` | 用法错误（缺参、未知 flag、未知 kind、`--project` 与 facts 不一致） |
| `3` | `needs_input`（可纠正的缺失输入） |
| `4` | `unsupported`（该输入类别不支持） |
| `5` | 输入被拒绝（坏 JSON、缺失文件、符号链接、超限、输出文件已存在、facts 不合法） |

`--root` 观察到的 `note:` 走 stderr；stdout 只有一个 JSON 结果。stdout 不含绝对路径、脚本正文或环境材料。

---

## 4. 输出契约

`project-recipe-draft/1`，三种形态共用一个信封：

```jsonc
{
  "protocol": "project-recipe-draft/1",
  "projectId": "project-alpha",
  "recipe": { "id": "regression_fix", "version": 1, "title": "缺陷回归修复", "summary": "…" },
  "provenance": {
    "catalog":       { "id": "project-recipes", "version": 1, "digest": "…" },
    "configuration": { "protocol": "application-configuration/1", "revision": "…", "projectId": "project-alpha" },
    "facts":         { "protocol": "project-facts/1", "digest": "…", "observedAt": "…", "provider": "…", "source": "injected" },
    "selection":     { "digest": "…", "paths": ["src/parser.ts"] },
    "input": "…"                       // (facts, config revision, kind, selection) 的摘要
  },
  "authorization": "none",
  "notes": ["…"],
  "status": "draft",
  "goal": "…", "scope": { "…": "现有 Scope 形状" }, "criteria": [ … ], "profileId": "profile-native",
  "revision": "…"                      // 去掉 revision 后内容的 sha256
}
```

- `authorization` 恒为 `"none"`；没有 token、approval、executable、argv、命令或执行状态字段。
- `revision` 绑定内容：任何字段被改动都会导致 `parseProjectRecipeDraft` 报 `revision_mismatch`。
- `provenance.configuration.revision` 为 `null` 只出现在「配置无法解析/版本不支持」，绝不伪造摘要。
- `needs_input` 与 `unsupported` 用封闭 code 列表表达原因，调用方不必解析自由文本。

### 结果码表

| code | 状态 | 触发条件 |
| --- | --- | --- |
| `configuration_unsupported_version` | unsupported | 配置协议不是 `application-configuration/1` |
| `configuration_invalid` | unsupported | 配置未通过公开 schema |
| `project_unknown` | unsupported | 配置中没有该 `projectId` |
| `stack_not_node` / `stack_unknown` | unsupported | 非 Node 标记 / 无法观察 |
| `manager_unsupported` | unsupported | 声明的包管理器是 yarn/bun 等 |
| `manager_unknown` | needs_input | 无法确定包管理器 |
| `locks_ambiguous` | needs_input | pnpm 与 npm 锁文件并存，或声明与锁文件不一致 |
| `workspace_unknown` | needs_input | 布局未观察 |
| `workspace_member_required` | needs_input | monorepo 根 + 有限范围配方未给路径 |
| `project_discussion_only` / `project_dispatch_blocked` | needs_input | 只读讨论 / 项目不可派工 |
| `execution_unavailable` | needs_input | 配置声明执行不可用 |
| `profile_required` / `profile_not_enabled` | needs_input | 无默认 profile / 指定 profile 未启用 |
| `criteria_machine_required` | needs_input | 所选 criteria 没有必需的已登记机器检查 |
| `criteria_check_unregistered` | unsupported | criteria 引用了未登记检查（防御性） |
| `criteria_selection_unknown` | needs_input | 指定的 criteria id 不在默认集合 |
| `scope_paths_required` | needs_input | 有限范围配方未给路径 |
| `scope_path_outside_allowed` | needs_input | 路径越界、绝对路径、含 `..` |

---

## 5. 接到原确认流程（main/F）

本模块**不做 UI/API**。`packages/project-recipes/src/preview.ts` 提供两件事：

```ts
// 1) 只把 draft 的字段整理成现有 create_work 命令的数据部分
const fields = previewInputs(draft, { configuration, facts })   // 输入已过期会抛 stale_inputs

// 2) 生成一个仍然要过原有校验与确认的命令候选
const command = toCreateWorkCommand(draft, { commandId, conversationId })  // 由应用会话提供 ID
```

- `commandId` / `conversationId` / trusted actor / 预览 token 全部由应用提供，本模块不生成。
- `assertDraftCurrent` 会比较 `configuration.revision` 与 facts 摘要：配置或观察变化后必须重新生成，旧草稿不能拿去提交新作用域。
- 模型撰写的 `ProposalPrepare` 路径仍只属于原模型提案（需要 `sourceMessageId`）；项目配方走 `create_work` 草稿路径，不要伪造来源消息。
- 具体接线示例见 [main-integration.zh-CN.md](main-integration.zh-CN.md)。

---

## 6. 成本与隐私预算

| 限制 | 默认值 | 说明 |
| --- | --- | --- |
| 单个 JSON 元数据 | 256 KiB | `package.json` |
| 单个锁文件 | 4 MiB | 超出则不算摘要并记 `missing.lockfile` |
| 读取文件数 | 12 | 每次观察 |
| 观察总字节 | 8 MiB | 每次观察 |
| facts 新鲜度 | 60 分钟 | 超时 → `needs_input: facts_stale` |
| 脚本名条数 | 512 | 超出截断并记 note |
| 输出集合 | scope ≤256、criteria ≤128、locks ≤5 | 与公开 schema 一致 |

隐私：输出只有项目相对路径、脚本名、摘要与计数；没有 home、环境变量、凭据、锁文件内容或脚本正文。CLI 只在 stderr 打印用户自己给出的绝对路径（`wrote:`）。

---

## 7. 故障矩阵（单变量）

每个负例都从合法基线出发只改一个原因；测试在 `packages/project-recipes/test/negative.case.ts` 与 `tools/project-recipes/test/*.case.ts`。

| 改动 | 结果 |
| --- | --- |
| facts 项目不在配置 | `unsupported: project_unknown` |
| 有 `pyproject.toml` 无 `package.json` | `unsupported: stack_not_node` |
| `stack.kind = unknown` | `unsupported: stack_unknown` |
| `packageManager: bun@…` | `unsupported: manager_unsupported` |
| 无声明无锁 | `needs_input: manager_unknown`（观测器会给出 `none`，则直接给建议并附 note） |
| pnpm + npm 锁并存 | `needs_input: locks_ambiguous` |
| facts 超过 60 分钟 / 时间在将来 | `needs_input: facts_stale` |
| 项目 discussion-only | `needs_input: project_discussion_only` + `execution_unavailable` |
| 指定未启用 profile | `needs_input: profile_not_enabled` |
| 指定不存在的 criteria | `needs_input: criteria_selection_unknown` |
| 路径 `docs`（不在 scope）/ `/etc/passwd` / `src/../etc` | `needs_input: scope_path_outside_allowed` |
| monorepo 根且未给路径 | `needs_input: workspace_member_required` |
| 配置 `protocol` 改为 v2 | `unsupported: configuration_unsupported_version`，`revision: null` |
| 配置 `revision` 非法 | `unsupported: configuration_invalid` |
| 未知 kind | `RecipeInputError: unknown_kind`（CLI exit 2） |
| facts 多余字段/错误协议 | `RecipeInputError: invalid_facts`（CLI exit 5） |
| `package.json` 是符号链接 | 读取器 `symlink` 拒绝（CLI exit 5） |
| `package.json` 超过上限 / 坏 JSON / 不是对象 | `too_large` / `invalid_json` / `not_object`（exit 5） |
| 根是 `/` 或 home / 相对路径 / 不存在 | `root_forbidden` / `root_not_absolute` / `root_missing`（exit 5） |
| `--output` 指向已存在文件 | exit 5，原文件字节不变 |

未知永远是未知：读取失败不会被当成「项目没有依赖」，缺失字段不会被当成「通过」。

---

## 8. 兼容与版本

- 支持：`application-configuration/1`、`project-facts/1`、catalog `project-recipes@1`。
- 未知配置版本 → `unsupported`，并如实记录观察到的协议字符串。
- 未知 facts 版本/多余字段 → 拒绝（`invalid_facts`），因为无法解释其语义。
- 配方目录内容变化必须提升 `RECIPE_CATALOG_VERSION`；每份草稿记录 catalog 版本与摘要，旧草稿不会被误认为新配方。
- 后端缺少可选 facts 字段时给 `needs_input`，不会降级到另一个执行器。
- 建议是数据：不是环境已准备、检查已通过、任务已执行或可计费的证明。

---

## 9. 不做 / 未达

不做：安装依赖、运行项目或检查命令、注册 CheckDefinition、写 SQL/迁移/账本、启动模型或原生 agent、生成 approval token、第二套 runner/verifier/gate/生命周期。

未达（如实记录）：

- 未接 App/HTTP/UI：main/F 尚未把草稿放进实际委托表单；本包只提供可编译的类型与数据。
- 不枚举 monorepo 成员（不解析 `pnpm-workspace.yaml` 内容）；只接受显式路径。
- 不探测包管理器实际版本（不执行 `--version`）；只记录声明值。
- 不判断测试是否通过、不估算节省的时间。

---

## 10. 复跑

```sh
# 依赖（workspace 内部包，不含任何安装/执行）
pnpm --dir packages/contracts build

# 纯库
pnpm --dir packages/project-recipes typecheck
pnpm --dir packages/project-recipes test          # 35 tests
pnpm --dir packages/project-recipes build

# CLI 与读取器
./node_modules/.bin/tsc -p tools/project-recipes/tsconfig.json
node --test tools/project-recipes/test/*.case.ts  # 20 tests

# 端到端样例（draft / needs_input / unsupported）
node tools/project-recipes/cli.ts --config tools/project-recipes/fixtures/configuration.json \
  --facts tools/project-recipes/fixtures/facts-alpha.json --now 2026-11-14T12:00:00.000Z --paths src
node tools/project-recipes/cli.ts --config tools/project-recipes/fixtures/configuration.json \
  --facts tools/project-recipes/fixtures/facts-alpha.json --now 2026-11-14T12:00:00.000Z --kind scoped_change

# 消费者样例（内存内自检，不写文件）
node packages/project-recipes/examples/preview-consumer.ts
```

## 11. 维护

- 新增配方：在 `catalog.ts` 的 `RECIPE_CATALOG` 增加条目并提升 `RECIPE_CATALOG_VERSION`，补一条正例与一条缺能力负例；`catalogDigest()` 会自动变化。
- 新增结果码：先加到 `RECIPE_ISSUE_CODES` 与 `RECIPE_ISSUE_FIELDS`，再在 `match.ts` 用固定顺序产生；测试断言封闭 code，不要断言自由文本。
- 读取器新增文件名：先加到 `METADATA_NAMES`，确认是 JSON 或只需存在性/哈希，再补隐私与上限测试。
