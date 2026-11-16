# 项目任务/检查声明配方（project-recipes）

日期：2026-11-15（wave-28）。范围：`packages/project-recipes/`、`tools/project-recipes/`、`docs/project-recipes/`、`reports/project-recipes/`。

这是**选择与声明**层，不是执行层。它把「明确观察到/已授权的项目事实 + 当前公开 `ApplicationConfiguration` + 任务类型 + 用户显式选择」变成三种结果之一：完整草稿 `draft`、待补输入 `needs_input`、不支持 `unsupported`。草稿只是数据，必须走应用原有的预览与明确确认；本模块不安装、不运行、不注册任何检查或脚本，不调用模型/agent，不写数据库或账本，也不创建第二套执行生命周期。

---

## 1. 支持范围与 scope 语义（本轮修正）

| 维度 | 支持 | 明确不支持 |
| --- | --- | --- |
| 项目栈 | Node（`package.json`） | Python/Go/Rust/Java 等（`stack_not_node`） |
| 包管理器 | `pnpm`、`npm`；无声明/无锁文件（`none`）也可给建议 | `yarn`、`bun`（`manager_unsupported`） |
| 任务类型 | `regression_fix`、`scoped_change`、`verification_followup` | 其他 kind（调用方用法错误，CLI exit 2） |
| 配置协议 | `application-configuration/1` | 其他版本（`configuration_unsupported_version`） |
| 事实协议 | `project-facts/1` | 其他版本（`invalid_facts`，CLI exit 5） |
| 布局 | 单包；monorepo/workspace 根需显式成员原子 | 自动成员枚举（不解析 `pnpm-workspace.yaml` 内容） |
| 检查 | 只引用配置里已登记的 `checkDefinitionRef` | 从 `package.json` scripts 反推命令、注册新检查 |

### 1.1 Scope 是「声明原子」，不是前缀

原应用（`packages/questions/src/validation.ts`、`packages/context/src/paths.ts`）的 `scopeWithin` 规则：

- `scope.allowedPaths` 的每一项必须**逐字出现在** grant 的 `allowedPaths` 中（`includes`，精确字符串比较）；
- grant 的**每一个** `excludedPaths` 必须仍存在于子 scope 中（排除只能增加）；
- `externalActions` 只能是子集；
- 若 grant 有 `expiresAt`，子 scope 必须有不晚于它的 `expiresAt`。

因此：

| 配置声明 | 选择 | 结果 |
| --- | --- | --- |
| `src/` | `src/` | ✅ 同一原子，原样保留 |
| `src/` | `src` | ❌ 不同原子（尾斜杠属于字符串） |
| `src/` | `src/file.ts` | ❌ 子路径**不是**更小的原子；原 Application 会 `forbidden` |
| `.` | `.` | ✅ 原样保留 |
| `packages/core/src/` | `packages/core/src/` | ✅ |
| 任意 | `/etc/passwd`、`../x`、`a\b`、空串 | ❌ `scope_path_invalid` |

要更小的范围（例如把 `src/` 缩到 `src/file.ts`），必须走**原配置授权流程**（main 的 ProjectSettings/registration），配方不会替你新增授权原子。判定代码在 `packages/project-recipes/src/scope.ts`（`isProjectAtom`、`scopeAtomWithin`），并由 `tools/project-recipes/test/actual-application.case.ts` 在**真实 `createProductApplication`** 上双向验证：matcher 产出的原子被应用接受，被 matcher 拒绝的子路径强行送入应用也会被 `forbidden` 拒绝。

fixture 与 native 的区分由配置决定，本模块不参与判定，但保证不混淆：草稿只记录 `profileId`，不写 readiness、driver 或执行类型；fixture 配置产出 fixture profile 的草稿，native 配置不会继承 `fixture_ready` 字样，显式选择的 profile 也不会被默认值替换（`profile_not_enabled` 直接拒绝）。测试见 `packages/project-recipes/test/compatibility.case.ts`。

三种配方的语义：

| kind | 建议的重点 | scope | criteria |
| --- | --- | --- | --- |
| `regression_fix` | 最小修复 + 回归证据，让已登记检查重新通过 | 必须显式给出更窄的**已声明原子** | 项目默认 criteria 全集 |
| `scoped_change` | 只在列出的原子内做有限变更 | 必须显式给出已声明原子 | 项目默认 criteria 全集 |
| `verification_followup` | 只跟进已有检查结果，不新增能力 | 可用项目全部已声明原子 | 只取已登记的机器检查 |

---

## 1.5 首次使用：导入普通项目到交付

目标：同事把自己机器上的**普通 Node 项目**（纯 Node、npm 单包、pnpm 单包）接入后，拿到可应用的模板字段并走完原确认流程。实际链路（已由 `tools/project-recipes/test/first-user.case.ts` 在真实 `createProductRuntime` 上验证）：

1. **导入项目**：用原产品入口（main 的 ProjectSettings/`NativeProjectRegistry`）登记项目根与显示名；根必须是已有提交的 git 仓库根。登记后项目获得自己的 `project-<digest(path)>` id。
2. **预览三模板**：`POST /v1/projects/:id/recipes/preview`（main 实现）按 `kind`（`regression_fix`/`scoped_change`/`verification_followup`）、当前项目已声明 atoms（如 `src/`）与已启用 profile 返回 `draft` 字段；纯 Node 项目（无 manager/lock）同样可用，只是附「未观察到 packageManager」说明。
3. **应用与编辑**：只有 `draft` 可应用；应用只预填 goal/scope/criteria/profile，用户仍可编辑 goal；未应用的模板不能创建。
4. **明确创建**：创建前 main 会重新读取同一 preview，比较配置 revision、facts 内容摘要、catalog 与字段；变化要求重新应用。之后发送原 `create_work`，由原 Application 再校验 scope/criteria/profile，再走原检查/候选/人工接受。
5. **迁移/重绑**：搬目录或重新登记后，用 `--previous-facts` 或 `rebindRegisteredProject` 对比旧观察；身份变化（新 id）报 `reidentified`，只给迁移差异、不复用旧建议。

限制：只支持 Node/npm/pnpm 单包与显式声明的 monorepo 原子；不安装依赖、不执行 scripts/版本命令、不自动注册检查、不猜成员/父目录；未知语言或布局保持 `unsupported`/`needs_input`。

## 2. 事实（facts）从哪来

只接受两种来源，二者都写进 `provenance`：

1. **注入**（`source: "injected"`）：main 或已有 inspection 已经观察好，直接传入。优先这种方式。
2. **授权只读读取**（`source: "authorized_metadata"`）：`packages/project-recipes/src/observe.ts` 在明确给出的绝对根目录下观察；CLI 与 main 的 runtime port 共用**同一份实现**。

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
- `missing` 列出观察缺口；`omissions` 给出字段级原因（`too_large`/`unreadable`/`unsupported`/`truncated`/`not_observed`），空列表不假装来源完整。缺口不会被补成默认值。
- `provenance.authority` 恒为 `none`：事实是数据，不含执行许可。
- `observedAt` 由调用方给出；`matchRecipe` 用调用方传入的 `now` 判断是否过期（默认 60 分钟），因此结果可复现。

### 2.1 main 应使用的 runtime port（无任意 root）

```ts
import { createProjectFactsObserver } from '@personal-agent/project-recipes'

const observer = createProjectFactsObserver({
  // main 已登记项目 → 根的映射；由 main 自己的 registry/配置提供
  rootFor: (projectId) => registeredRoots.get(projectId),
})
const { facts, notes } = observer.observe({ projectId, observedAt: new Date().toISOString() })
```

- `observe` 的入参只有 `projectId` 与 `observedAt`，**没有 path**：公开请求无法指定任意根。
- 未登记项目 → `MetadataRefused`，`code: "root_not_registered"`。
- 端口协议字符串 `project-facts-observer/1`，可放进 main 的状态输出做版本核对。
- 需要更底层的显式根时用 `observeProjectMetadata({ root, projectId, observedAt })`（CLI 的 `--root` 走这条），仍受同样边界约束。

### 2.3 稳定内容与观察时间

观察结果有两个摘要，含义不同：

| 字段 | 含义 | 用途 |
| --- | --- | --- |
| `provenance.facts.digest` | 整份观察（含 `observedAt`）的摘要 | 标识"这一次观察" |
| `provenance.facts.contentDigest` | 去掉 `observedAt` 后的稳定内容摘要 | 判断草稿是否仍然适用 |
| `provenance.facts.observedAt` | 本次观察时间 | 新鲜度；不是授权 |

- 同一份字节读两次（时间不同）→ `contentDigest` 相同、`digest` 不同；内容变化（即使文件长度不变）→ 两者都变。
- 复用规则：`previewInputs(draft, { configuration, facts, now })` 比较内容，并**总是**核对时间：
  - 传入更新的 `observedAt` 但内容相同不会失效；
  - 观察时间在**未来**、或超过保留期限（默认 60 分钟）都会被拒绝；
  - 调用方不传 `now` 时使用真实时钟，不会因此跳过时间检查；
  - `now` 无法解析或 `maxFactsAgeMs` 非法 → `invalid_clock`，不被当成"当前"；
  - `draft.scope.expiresAt` 已过（或当前配置项目授权已过期）→ `stale_inputs` 且 `staleInputs` 含 `expiry`。
- 当前配置会用公开 schema **重新解析**：未知版本或结构损坏按 `configuration` 过期处理，不信任裸 `revision` 字符串。
- 旧草稿（缺少 `provenance.facts.contentDigest`）按 `stale_draft_version` 明确拒绝并提示重新生成。
- 导出 `factsContentDigest(facts)`，与 main 预览契约里的算法一致（`canonicalDigest(facts 去掉 observedAt)`），由 `tools/project-recipes/test/main-contract.case.ts` 对齐校验。
- 摘要只是观察身份，不是命令 token、批准或执行结果；`authorization` 始终 `none`。

### 2.2 读取边界

- 根目录必须**绝对路径**、已存在、是目录；拒绝 `/`、用户 home、未登记项目。根被替换时读取会拒绝（读完再核对父目录 realpath）。
- 只打开根目录下白名单名字：`package.json`、`tsconfig.json`、`pnpm-workspace.yaml`、`package-lock.json`、`pnpm-lock.yaml`、`npm-shrinkwrap.json`、`yarn.lock`、`bun.lockb`、`pyproject.toml`、`go.mod`、`Cargo.toml`、`pom.xml`、`build.gradle`。不递归、不进子目录。
- 每次都 `O_NOFOLLOW` + `fstat`：符号链接、非普通文件一律拒绝。
- 打开前后比对 `dev/ino/size`，读完再比对 `size/mtime`：文件在读取期间被替换或改写时以 `replaced` / `changed_during_read` 拒绝，不会把不完整的内容当完整事实。
- 默认上限：`package.json` 256 KiB，锁文件 4 MiB，最多读 12 个文件，整次观察 8 MiB；上限本身也受校验：`MetadataLimits` 必须是有限安全整数且在允许范围内，`0`/负数/小数/`NaN`/`Infinity`/超大预算一律 `invalid_limits`，不能靠配置预算绕过边界。
- 只解析 `package.json` 的 JSON；YAML/锁文件只做存在性判断或有界哈希。
- 不读 home、环境变量、`.npmrc`、凭据；不执行 `--version` 或任何项目脚本。

---

## 3. CLI

```sh
# 最小前置（workspace 依赖）：只构建 contracts
pnpm --dir packages/contracts build

# 1) 直接使用已观察事实
node tools/project-recipes/cli.ts \
  --config tools/project-recipes/fixtures/configuration.json \
  --facts  tools/project-recipes/fixtures/facts-alpha.json \
  --now 2026-11-14T12:00:00.000Z \
  --kind regression_fix --paths src/

# 2) 显式授权根目录，按白名单只读观察
node tools/project-recipes/cli.ts \
  --config tools/project-recipes/fixtures/configuration.json \
  --root tools/project-recipes/fixtures/example-project \
  --project project-alpha --paths src/ --now 2026-11-14T12:00:00.000Z

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
| `--paths a,b` / `--exclude c` / `--criteria x,y` / `--profile <id>` | 显式选择；`--paths` 必须是配置**已声明的原子**。给空值是用法错误（exit 2）。 |
| 省略 `--paths` | 表示「没有额外收窄」：`verification_followup` 用项目全部已声明原子；两个需要边界的配方则返回 `needs_input: scope_paths_required`。 |
| `--now <ISO>` | 决定 facts 新鲜度；省略用当前时间（测试与复跑请显式给出）。 |
| `--max-facts-age-ms <n>` | 覆盖默认 60 分钟上限。 |
| `--output <新文件>` | 仅在文件不存在时写入（`O_EXCL`），同时仍把 JSON 打到 stdout。 |
| `--help` / `-h` | 不读取任何文件，也不加载库（workspace 依赖未构建时仍可用）。 |

退出码：

| code | 含义 |
| --- | --- |
| `0` | `draft`（完整建议） |
| `2` | 用法错误（缺参、未知 flag、未知 kind、`--project` 与 facts 不一致） |
| `3` | `needs_input`（可纠正的缺失输入） |
| `4` | `unsupported`（该输入类别不支持） |
| `5` | 输入被拒绝（坏 JSON、缺失文件、符号链接、超限、输出文件已存在、facts 不合法、依赖未构建） |

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
    "selection":     { "digest": "…", "paths": ["src/"] },
    "input": "…"                       // (facts, config revision, kind, selection) 的摘要
  },
  "authorization": "none",
  "notes": ["…"],
  "status": "draft",
  "goal": "…", "scope": { "…": "现有 Scope 形状，原子逐字保留" }, "criteria": [ … ], "profileId": "profile-native",
  "revision": "…"                      // 去掉 revision 后内容的 sha256
}
```

- `authorization` 恒为 `"none"`；没有 token、approval、executable、argv、命令或执行状态字段。
- `revision` 绑定内容：任何字段被改动都会导致 `parseProjectRecipeDraft` 报 `revision_mismatch`。
- `provenance.configuration.revision` 为 `null` 只出现在「配置无法解析/版本不支持」，绝不伪造摘要。
- `needs_input` 与 `unsupported` 用封闭 code 列表表达原因，调用方不必解析自由文本。

### 4.1 结果码表

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
| `workspace_member_required` | needs_input | monorepo 根 + 有限范围配方未给原子 |
| `project_discussion_only` / `project_dispatch_blocked` | needs_input | 只读讨论 / 项目不可派工 |
| `execution_unavailable` | needs_input | 配置声明执行不可用 |
| `profile_required` / `profile_not_enabled` | needs_input | 无默认 profile / 指定 profile 未启用 |
| `project_scope_expired` | needs_input | 项目授权 `expiresAt` 已过期（生成阶段即拒绝） |
| `criteria_machine_required` | needs_input | 所选 criteria 没有必需的已登记机器检查 |
| `criteria_check_unregistered` | unsupported | criteria 引用了未登记检查（防御性） |
| `criteria_selection_unknown` | needs_input | 指定的 criteria id 不在默认集合 |
| `scope_paths_required` | needs_input | 有限范围配方未给原子 |
| `scope_path_outside_allowed` | needs_input | 合法但**没被当前配置声明**的原子（含子路径） |
| `scope_path_invalid` | needs_input | 绝对路径/盘符/反斜杠/`..`/空串等非法原子 |

---

## 5. 接到原确认流程（main/F）

本模块**不做 UI/API**。`packages/project-recipes/src/preview.ts` 提供：

```ts
// 1) 只把 draft 的字段整理成现有 create_work 命令的数据部分
const fields = previewInputs(draft, { configuration, facts })

// 2) 生成一个仍然要过原有校验与确认的命令候选
const command = toCreateWorkCommand(draft, { commandId, conversationId })
```

- `commandId` / `conversationId` / trusted actor / 预览 token 全部由应用提供，本模块不生成。
- 用户可编辑 goal：`previewInputs(draft, current, { goal })` / `toCreateWorkCommand(draft, ids, { goal })` 只替换目标文本，scope/criteria/profile 仍来自草稿；空或超长目标被拒绝（`not_actionable`）。
- `previewInputs` 会比较 `configuration.revision` 与 facts 摘要；不匹配时抛 `PreviewError`，`code: "stale_inputs"`，并在 `staleInputs: ("configuration" | "facts")[]` 里指出**哪一项需要重生成**。
- 模型撰写的 `ProposalPrepare` 路径仍只属于原模型提案（需要 `sourceMessageId`）；项目配方走 `create_work` 草稿路径，不伪造来源消息。
- 已用真实 `createProductApplication` 验证：同配置下 `draft → create_work → dispatch` 返回 `recorded`；强行送入子路径原子会被 `forbidden` 拒绝。
- main 已按 0073 接入（`POST /v1/projects/:id/recipes/preview` + 原 NewWorkForm 预填 + 创建前重验 + 原 `create_work`），并用 `packages/contracts/src/project-recipe-preview.ts` 发布字段契约；本包的字段与该契约逐项对齐（`tools/project-recipes/test/main-contract.case.ts`）。
- 具体接线示例见 [main-integration.zh-CN.md](main-integration.zh-CN.md)。

---

## 6. 成本与隐私预算

| 限制 | 默认值 | 说明 |
| --- | --- | --- |
| 单个 JSON 元数据 | 256 KiB | `package.json`（含边界值，超一字节即拒绝） |
| 单个锁文件 | 4 MiB | 超出则不算摘要并记 `missing.lockfile` |
| 读取文件数 | 12 | 每次观察 |
| 观察总字节 | 8 MiB | 每次观察 |
| facts 新鲜度 | 60 分钟 | 超时 → `needs_input: facts_stale` |
| 脚本名条数 | 512 | 超出截断并记 note |
| 输出集合 | scope ≤256、criteria ≤128、locks ≤5 | 与公开 schema 一致 |

隐私：输出只有项目相对原子、脚本名、摘要与计数；没有 home、环境变量、凭据、锁文件内容或脚本正文。拒绝信息不回显 metadata 正文或 secret。CLI 只在 stderr 打印用户自己给出的绝对路径（`wrote:` / refused target 名）。

---

## 7. 故障矩阵（单变量）

每个负例都从合法基线出发只改一个原因；测试在 `packages/project-recipes/test/*.case.ts` 与 `tools/project-recipes/test/*.case.ts`。

| 改动 | 结果 |
| --- | --- |
| facts 项目不在配置 | `unsupported: project_unknown` |
| 有 `pyproject.toml` 无 `package.json` | `unsupported: stack_not_node` |
| `stack.kind = unknown` | `unsupported: stack_unknown` |
| `packageManager: bun@…` | `unsupported: manager_unsupported` |
| 无声明无锁 | `needs_input: manager_unknown`（观测器给出 `none` 时直接建议并附 note） |
| pnpm + npm 锁并存 | `needs_input: locks_ambiguous` |
| facts 超过 60 分钟 / 时间在将来 | `needs_input: facts_stale`（CLI exit 3） |
| 项目 discussion-only | `needs_input: project_discussion_only` + `execution_unavailable` |
| 指定未启用 profile | `needs_input: profile_not_enabled` |
| 指定不存在的 criteria | `needs_input: criteria_selection_unknown` |
| 选择 `docs`（未声明） | `needs_input: scope_path_outside_allowed` |
| 选择 `src/file.ts`（子路径，非声明原子） | `needs_input: scope_path_outside_allowed`；强行送 Application → `forbidden` |
| 选择 `/etc/passwd` / `../x` / `a\b` / 空串 | `needs_input: scope_path_invalid` |
| monorepo 根未给原子 | `needs_input: workspace_member_required` |
| monorepo 根给了未声明的兄弟成员 | `needs_input: scope_path_outside_allowed` |
| 配置 `protocol` 改为 v2 | `unsupported: configuration_unsupported_version`，`revision: null` |
| 配置 `revision` 非法 | `unsupported: configuration_invalid` |
| 未知 kind | `RecipeInputError: unknown_kind`（CLI exit 2） |
| facts 多余字段/错误协议 | `RecipeInputError: invalid_facts`（CLI exit 5） |
| `package.json` 是符号链接/目录/超限/坏 JSON | `symlink` / `not_regular_file` / `too_large` / `invalid_json`（exit 5） |
| facts 观察时间在未来 / 超过保留期 | `stale_inputs`（`staleInputs: ['facts']`） |
| `now` 无法解析 / `maxFactsAgeMs` 非法 | `invalid_clock` |
| 当前配置版本不支持 / schema 损坏 / 项目被移除 | `stale_inputs`（`staleInputs: ['configuration']`） |
| 草稿 scope 或配置授权已过期 | `stale_inputs`（`staleInputs: ['expiry']`）；生成阶段为 `needs_input: project_scope_expired` |
| 旧版草稿（缺 `contentDigest`） | `stale_draft_version`（重新生成） |
| `MetadataLimits` 为 0/负数/小数/NaN/Infinity/超大 | `invalid_limits`（exit 5） |
| 根是 `/`、home、相对路径、不存在、未登记 | `root_forbidden` / `root_not_absolute` / `root_missing` / `root_not_registered`（exit 5） |
| 读取期间文件被替换 / 被改写 | `replaced` / `changed_during_read`（exit 5） |
| `--output` 指向已存在文件 | exit 5，原文件字节不变 |

未知永远是未知：读取失败不会被当成「项目没有依赖」，缺失字段不会被当成「通过」。

---

## 7.5 迁移/重绑项目（R3）

同事把项目搬到新目录、或在原产品里重新登记后，需要判断「旧建议是否还适用」。`src/rebind.ts` 提供只读对比，不做迁移判定、不写 registry、不携带旧凭据：

```ts
const { facts, report } = rebindRegisteredProject({
  previous,                       // 上一次 project-facts/1（存在任何地方都行）
  observedAt: new Date().toISOString(),
  roots: { rootFor: (id) => registeredRoots.get(id) },  // main 自己的已登记映射
})
// report.status: 'current' | 'changed' | 'unbound' | 'reidentified'
// report.changes: ['stack'|'manager'|'packageJson'|'lockfile'|'workspace'|'scripts'|'languages'|'observation']
```

- `unbound`：当前没有该项目的已登记 root → 只能先走原项目设置/登记流程，**不猜路径**。
- `reidentified`：项目换了身份（搬目录后重新登记会产生新 project id，main 的 registry id 由路径摘要生成）→ 报告给出 `previousProjectId` 与元数据差异供迁移核对，但**旧建议不能复用**，需按新项目重新生成。
- `current`：内容摘要相同（观察时间可以不同）→ 可沿用已生成建议，仍以原确认流程为准。
- `changed`：列出字段级变化（manager/lock/workspace/scripts…），旧草稿由 `previewInputs` 判定为 `stale_inputs`，需用当前配置重新生成。
- 报告只含 digest/时间/字段名/脱敏 note，没有绝对 root、metadata 正文、凭据或授权；`authorization` 恒 `none`。

CLI 迁移对比模式（只读，需显式授权根）：

```sh
node tools/project-recipes/cli.ts --previous-facts /tmp/old-facts.json \
  --root /path/to/new/project --project project-alpha --now 2026-11-15T00:00:00.000Z
```

退出码：`current`/`changed` → 0；`unbound`（未登记/根不存在）→ 3；`reidentified`（身份已变化，仅供迁移核对）或输入被拒绝 → 5；参数冲突 → 2。该模式不接受 `--facts/--kind/--paths/--output`，避免把迁移对比混成生成或写入。

## 8. 兼容、版本与分发

- 支持：`application-configuration/1`、`project-facts/1`、`project-facts-observer/1`、catalog `project-recipes@1`、与 main 的 `project-recipe-preview/1` 字段对齐。
- 未知配置版本 → `unsupported`，并如实记录观察到的协议字符串。
- 未知 facts 版本/多余字段 → 拒绝（`invalid_facts`），因为无法解释其语义。
- 配方目录内容变化必须提升 `RECIPE_CATALOG_VERSION`；每份草稿记录 catalog 版本与摘要。
- criteria 只引用已登记的**检查 ID**；检查的具体 revision 由原 verifier 在执行时记录，本模块不固定 revision，也不判断检查是否通过。
- `MetadataLimits` 有硬上界（`MAX_METADATA_LIMITS`：JSON 16 MiB / 锁 64 MiB / 64 文件 / 128 MiB），超界即拒绝。
- `facts` 增加 `omissions`；旧 facts 缺少它会被拒绝，旧草稿缺少 `contentDigest` 会被 `stale_draft_version` 拒绝。
- 同名不同 ID 的项目不会混用：provenance、projectId、criteria 与 revision 都按真实 ID 区分。

分发 closure（J-owned）：

- 入口：`package.json` `exports["."]` → `dist/index.js` / `dist/index.d.ts`；`files: ["dist","README.md"]`。
- 运行时依赖：`@personal-agent/contracts`（workspace）、`zod`；其余只用 Node 内建模块。
- `npm pack --dry-run` 实测 34 个文件 / 36,643 字节，只含 `dist/*` 与 `README.md`（无 src/tools/tests）。
- `dist` 由 `tsc -p tsconfig.build.json` 生成，不提交。

---

## 8.5 三条发行线（R1 / R2 / R3）

| 线 | 含义 | 本包的准确状态 |
| --- | --- | --- |
| R1 | 固定安装包 `8296720d8a25f38c`（source `82ee5b8f…`，tar `04926739…`，20481470 B / 6849 项，schema18/Node24.21.0/ABI137/darwin-arm64） | **不修改、不重冻**。R1 源码含 wave-29 模板层（`factsContentDigest`、goal 编辑、atom scope），但缺 wave-30 的 future/clock/expiry/omissions/limits 边界；由 `tools/project-recipes/test/r1-baseline.case.ts` 直接从 git 对象核对，报告不冒充 R1 有新能力 |
| R2 | 当前 source 与后继安装包 | 当前分支 source（本报告对应提交）+ `dist` 构建 + `npm pack` 列表；tar 由 D 在确定运行字节后冻结，E 绑定同一 tar |
| R3 | 反复使用与同事支持 | 迁移对比（`rebindRegisteredProject` / CLI 模式）、重复观察稳定性、失败边界与重开回原手动流程 |

## 9. 不做 / 未达

不做：安装依赖、运行项目或检查命令、注册 CheckDefinition、写 SQL/迁移/账本、启动模型或原生 agent、生成 approval token、第二套 runner/verifier/gate/生命周期。

未达（如实记录）：

- main 已接入并在真实产品链路通过（0073/0076/0077：HTTP preview、工作台建议、原表单预填、创建前重验、两项目原 Work/check/candidate/manualaccept；本轮 clean source 8/8 浏览器流程由 main 入口执行）。F 的呈现与 E 的独立断言仍按各自范围，不由本包声明。
- 没有产出安装包或 installed/native 结论；本包的真实 vendor/model/native 调用为 0。
- 不枚举 monorepo 成员（不解析 `pnpm-workspace.yaml` 内容）；只接受显式声明原子。
- 不探测包管理器实际版本（不执行 `--version`）；只记录声明值。
- 不判断测试是否通过、不估算节省的时间。

---

## 10. 复跑

在 main 把 `packages/project-recipes` importer 写进根 `pnpm-lock.yaml` 之前（见 [main-integration](main-integration.zh-CN.md) 第 1 节），直接运行 `pnpm --dir …` 会让 pnpm 顺手改写根 lock。此阶段用下面的直接命令复跑，不触碰 lock：

```sh
# 依赖（workspace 内部包；只构建 contracts，不安装项目依赖）
pnpm --dir packages/contracts build

# 纯库
./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.json
node --test packages/project-recipes/test/*.case.ts     # 82 tests
./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.build.json

# CLI 与真实 Application 消费者（后者需要产品包构建）
./node_modules/.bin/tsc -p tools/project-recipes/tsconfig.json
node --test tools/project-recipes/test/*.case.ts        # 32 tests

# 真实 Application 消费者与 main 集成测试的构建闭包（一次性）
pnpm -r --workspace-concurrency=2 run build
# 或逐个直接构建；main 的集成测试还需要 coordinator/console 依赖的 dist
node --test tests/integration/project-recipes.case.mjs   # main 的 5 项真实链路测试
node tests/integration/project-recipes-browser.mjs reports/project-recipes/wave30-browser  # main 的 8 项工作台浏览器流程（Playwright）

# 端到端样例（draft / needs_input / unsupported）
node tools/project-recipes/cli.ts --config tools/project-recipes/fixtures/configuration.json \
  --facts tools/project-recipes/fixtures/facts-alpha.json --now 2026-11-14T12:00:00.000Z --paths src/
node tools/project-recipes/cli.ts --config tools/project-recipes/fixtures/configuration.json \
  --facts tools/project-recipes/fixtures/facts-alpha.json --now 2026-11-14T12:00:00.000Z --kind scoped_change

# 迁移对比（只读，显式授权根；用 fixture 中的 facts 作为“上一次观察”）
node tools/project-recipes/cli.ts --previous-facts tools/project-recipes/fixtures/facts-alpha.json \
  --root tools/project-recipes/fixtures/example-project --now 2026-11-15T00:00:00.000Z

# 消费者样例（内存内自检，不写文件）
node packages/project-recipes/examples/preview-consumer.ts
```

## 11. 维护

- 新增配方：在 `catalog.ts` 的 `RECIPE_CATALOG` 增加条目并提升 `RECIPE_CATALOG_VERSION`，补一条正例与一条缺能力负例；`catalogDigest()` 会自动变化。
- 新增结果码：先加到 `RECIPE_ISSUE_CODES` 与 `RECIPE_ISSUE_FIELDS`，再在 `match.ts` 用固定顺序产生；测试断言封闭 code，不要断言自由文本。
- scope 语义只能跟随原应用：改动 `scope.ts` 前先看 `packages/questions/src/validation.ts` 与 `packages/context/src/paths.ts`，并跑 `actual-application.case.ts`。
- 读取器新增文件名：先加到 `observe.ts` 的 `METADATA_NAMES`，确认是 JSON 或只需存在性/哈希，再补隐私与上限测试。
