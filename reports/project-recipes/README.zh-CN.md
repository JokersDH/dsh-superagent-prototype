# J 报告：项目任务/检查声明配方

工作树 `/Users/hh/Desktop/joker/superagent-agent-j`，分支 `codex/g5-project-recipes`。

- 当前（wave-34）机读状态：[wave34-status.json](wave34-status.json)
- 历史（wave-33）：[wave33-status.json](wave33-status.json)
- 历史（wave-32）：[wave32-status.json](wave32-status.json)
- 历史（wave-31）：[wave31-status.json](wave31-status.json)
- 历史（wave-30）：[wave30-status.json](wave30-status.json)
- 历史（wave-29）：[wave29-status.json](wave29-status.json)
- 历史（wave-28）：[wave28-status.json](wave28-status.json)
- 历史（wave-27）：[wave27-status.json](wave27-status.json)

---

# wave-34（2026-11-16）

起点 `f6a1bf59`，合并 `origin/main`（`6b306514`，合并为 `d8aca213`；含 `23d5a98e` 的原回调与 support 下载）后执行两个连续工程包、每包三个完整成果。

## 包一：日常项目到原交付

| 成果 | 证据 |
| --- | --- |
| 普通 Node/npm/pnpm 声明适用性 | 三形态 × 三 kind；缺 atom → `needs_input`、未知项目 → `forbidden`；缺锁文件给可行动 note，不推断命令；脚本只是名字数据 |
| 两原项目完整交付与失败回路 | `two-project-delivery.case.ts`（preview→create→check/candidate→ready→accept→delivered→artifact bytes→reopen）＋ `fail-recovery.case.ts`（缺失 atom 改正后交付；同 commandId 换 body 冲突；配置 revision 变化后旧 apply 失效并重读；A/B 切换互不串用） |
| 可解释重验 | `draftCurrency()` 的封闭 reason code（配置版本/schema/revision/项目移除、facts 无效/变化/未来/过期、expiry、clock）＋ `observationComplete`；`assertDraftCurrent` 共用同一政策 |

真实负例都先有合法正向再证拒绝：候选未就绪前不接受、跨项目候选拒绝、**合法 accept 之后**同一候选才是 stale；检查 FAIL 的 oracle 在受控 fixture 下不可达，未冒充已测（E/main 拥有真实 oracle）。

## 包二：迁移、重开与同版本交付

- **重识别**：同 id 新 root 内容变 → `changed`；同内容新 root → `current` 且报告明确「根身份由调用方核对」；不同 id 同内容 → `reidentified` 且 changes 为空、旧建议不可复用；无 root → `unbound`；越权根 → 错误而非 unbound。
- **非空恢复后重新登记**：`restore-continuity.case.ts` 关闭并重开同一非空 state → 旧 Work/候选/全部 artifact 字节按原 project id 可核；把搬迁树登记为新 id → 新项目获得自己的 draft，旧 draft 跨 id 直接 `stale`，rebind 报 `reidentified`。真实 A/D 备份恢复字节属外部，未冒充。
- **同版本交接**：`describeProjectRecipes()` 增加 `capabilities`（`match`/`preview-fields`/`observe`/`rebind`/`describe`），旧包缺能力可被消费者识别；CLI `--describe` 输出同一描述。

## 实际验证

| 命令 | exit | 结果 |
| --- | --- | --- |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.json` | 0 | strict |
| `node --test packages/project-recipes/test/*.case.ts` | 0 | 98 tests / 98 pass |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.build.json` | 0 | dist |
| `./node_modules/.bin/tsc -p tools/project-recipes/tsconfig.json` | 0 | strict |
| `node --test tools/project-recipes/test/*.case.ts` | 0 | 43 tests / 43 pass |
| `node --test tests/integration/project-recipes.case.mjs` | 0 | main 真实链路 5/5 |
| `node tests/integration/project-recipes-browser.mjs reports/project-recipes/wave34-browser` | 0 | 9/9，clean source `ab9eef2d`，2 个人工接受 |
| `node agent-tasks/product-wave-34/verify.mjs` | 0 | 静态派工校验 |
| `npm pack --dry-run` | 0 | 42 files / 50,270 B |

合并 main 后必须重跑 `pnpm -r --workspace-concurrency=2 run build`，否则旧 contracts dist 缺新导出会让 main 导入失败（构建产物过期，不是模板回归）。

## 已进 main / 仅候选 / 安装

- 已在 main：wave-30 J 五源、0073/0077 预览与原表单、`23d5a98e` 原回调/support（main-owned）、发行构建列表含 `project-recipes`。
- 仅候选：`rebind.ts`、`module.ts` 的 capabilities 与 `--describe`、`draftCurrency` 结构化原因、三个新消费者测试。
- 未安装：R1 829（`82ee5b8f` / `8296720d8a25f38c` / tar `04926739…`）原样保留；R2 后继 source `ab9eef2d` + dist + pack 列表，**tar/ZIP 未创建**。

分层：source/controlled PASS；installed NOT_REACHED；native 0；recovered NOT_REACHED；value 不声称。

## 余项

main 重导入 `rebind.ts`/`module.ts`/`preview.ts`/`match.ts`；D 在整合运行字节确定后冻结后继；E 绑定同一 tar；A/D 真实备份恢复 cohort 与 E 独立断言不在本包。

---

# 历史：wave-33（2026-11-16）

起点 `0c67e3b7`，合并 `origin/main`（wave-33 派工 `e05ee8d8`，合并为 `7d6d099c`；含 `fc38bf65` 的登记 runner port 与工作台消费者）后执行三个完整成果。

## 1. 成果一：生产项目声明与三类委托

- 既有 main 入口（registry → preview → 原表单 → `create_work`）未重做；`first-user.case.ts` 证明纯 Node/npm/pnpm 三形态 × 三 kind 全部 draft，且每个项目一次原 `create_work` recorded。
- 负例：未声明 atom → `needs_input`（`fields: null`）；从未导入的项目 → `forbidden`，不借别的项目凑可用。
- CLI 输出收紧：draft 与迁移报告的新文件都是 **0600 + O_EXCL**，已存在/不可写即拒绝，绝不覆盖；迁移模式现在也支持 `--output`。
- `rebind`/`reidentified` 仍**仅候选**（origin/main 无 `rebind.ts`），main 接入只需一次调用：`rebindRegisteredProject({ previous, observedAt, roots: { rootFor: id => readers.rootFor(id) } })`。

## 2. 成果二：两个原项目的原产品交付

`two-project-delivery.case.ts`（真实 `createProductRuntime`，npm + pnpm 两个独立根、各自 registry id 与 scope）：

- preview → `create_work` → 产品自有 fixture 尝试 → `check`/`currentCandidate` 就绪 → **ready 之后**才 `accept_candidate` → `delivered`。
- 交付后 Work 属于原 project id，全部 artifact 字节经 store 可读；关闭并重开同一 state 后仍能复核 delivered Work 与 artifact。
- 负例顺序诚实：候选就绪前根本不提供 accept（早试被拒，不算 stale）；跨项目候选被拒；**合法 accept 之后**再重放同一候选才是 stale 拒绝。
- 分层：controlled fixture 协议；真实 vendor/model/native 仍 0；B/I 原恢复与 2/4 槽归还不属于本块，保持 NOT_REACHED，未用 fixture registry 或新 Work 替代。

## 3. 成果三：迁移重识别与同一版本交接

- `reidentified`（搬目录后新 id）给 `previousProjectId` 与字段差异，旧建议不复用；同 id 换 root 为 `changed`，旧草稿 `stale_inputs`；无登记根为 `unbound`，不猜路径。
- 新增 `describeProjectRecipes()`：contracts/catalog 摘要/issue 与 preview 错误词表/版本的可比较描述，供 D 冻结与 E 绑定同一 tar；描述里没有路径、凭据或授权。
- CLI `--previous-facts` 报告可写新文件（0600、不覆盖）。

## 4. 实际验证

| 命令 | exit | 结果 |
| --- | --- | --- |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.json` | 0 | strict |
| `node --test packages/project-recipes/test/*.case.ts` | 0 | 85 tests / 85 pass |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.build.json` | 0 | dist |
| `./node_modules/.bin/tsc -p tools/project-recipes/tsconfig.json` | 0 | strict |
| `node --test tools/project-recipes/test/*.case.ts` | 0 | 38 tests / 38 pass |
| `node --test tools/project-recipes/test/two-project-delivery.case.ts` | 0 | 两项目交付/产物/重开/负例全过 |
| `node --test tests/integration/project-recipes.case.mjs` | 0 | main 真实链路 5/5 |
| `node tests/integration/project-recipes-browser.mjs reports/project-recipes/wave33-browser` | 0 | 9/9，clean source `5cd59215`，2 个人工接受 |
| `npm pack --dry-run` | 0 | 42 files / 48,781 B |

## 5. 已进 main / 仅候选 / 安装

| 项 | 状态 |
| --- | --- |
| wave-30 J 五源、0073/0077 预览与原表单、发行构建列表含 `project-recipes` | 已在 main |
| `rebind.ts`、`module.ts`、CLI `--previous-facts`/私有输出、两个消费者测试 | **仅候选** |
| R1 829（`82ee5b8f` / `8296720d8a25f38c` / tar `04926739…`） | 未修改、未安装 |
| R2 后继 | source `5cd59215` + dist + pack 列表；**tar/ZIP 未创建** |

分层：source/controlled PASS；installed NOT_REACHED；native 0；recovered NOT_REACHED；value 不声称。

## 6. 余项

main 重导入 `rebind.ts`/`index.ts`/`module.ts`；D 按 contracts → project-recipes 构建并冻结后继；E 对 R1 用 829 精确 tuple、对 R2 用 D 冻结的同一 tar；F 呈现与 E 独立断言不在本包。

---

# 历史：wave-32（2026-11-16）

起点 `b25bf228`，合并 `origin/main`（wave-32 派工 `58b4e4c8`，合并为 `345fb72c`；含 `b72e935d`/`1498b07a` 的打包工作）后执行 `agent-tasks/product-wave-32/agent-j-project-recipes.zh-CN.md` 的整块结果：**普通 Node/npm/pnpm 项目导入后拿到可应用模板字段并走完原交付流程**。

## 1. 整块结果

新增 `tools/project-recipes/test/first-user.case.ts`，在真实 `createProductRuntime` 组合上验证：

| 场景 | 结果 |
| --- | --- |
| 三种普通项目形态（`ensureStarterProject` 纯 Node、npm 单包、pnpm 单包）经 `NativeProjectRegistry` 导入 | 观察到的 manager 分别为 `none`/`npm`/`pnpm` |
| 每个项目 × 三个 kind 通过 coordinator 的 `projectRecipePreview` | 9 次 `draft`，`fields.projectId` 始终是导入项目本身，profile/atom/criteria 来自当前服务端字段 |
| 每个项目一次原 `create_work` | 3 次 `recorded`（原 Application 校验 scope/criteria/profile） |
| 未声明 atom（`test/`） | `needs_input`，`fields: null` |
| 从未导入的项目 | `forbidden`，不会借用别的项目 |
| 迁移重绑 | 同 id 换 root → `changed`；搬目录后重新登记生成新 id → `reidentified`（带 `previousProjectId` 与字段差异），旧建议不复用，新身份仍能生成自己的 draft |

## 2. 迁移语义修正（本轮实现增量）

main 的 registry id 是 `project-${digest(path)}`，所以搬目录后重新登记会得到**新项目 id**。此前 `foreign` 直接拒绝，导致迁移无法核对；现在：

- `reidentified`：给出 `previousProjectId` 与元数据差异（供迁移核对），但**旧建议不可复用**；CLI 以 exit 5 明示「身份已变化」。
- 同 id 指向新 root（main 的重绑映射）仍是 `changed`，`previewInputs` 判旧草稿 `stale_inputs`。
- 报告依旧只有 digest/时间/字段名，无绝对 root、凭据或授权。

## 3. 实际验证

| 命令 | exit | 结果 |
| --- | --- | --- |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.json` | 0 | strict |
| `node --test packages/project-recipes/test/*.case.ts` | 0 | 82 tests / 82 pass |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.build.json` | 0 | dist |
| `./node_modules/.bin/tsc -p tools/project-recipes/tsconfig.json` | 0 | strict |
| `node --test tools/project-recipes/test/*.case.ts` | 0 | 36 tests / 36 pass |
| `node packages/project-recipes/examples/preview-consumer.ts` | 0 | 三态自检 |
| `node --test tests/integration/project-recipes.case.mjs` | 0 | main 真实链路 5/5 |
| `node tests/integration/project-recipes-browser.mjs reports/project-recipes/wave32-browser` | 0 | 8/8，clean source `7a164c57`，2 个人工接受 |
| `npm pack --dry-run` | 0 | 38 files / 47,298 B |

wave-32 目录没有 `verify.mjs`，本轮静态检查只有 `dispatch.json` 计划本身，已在状态中注明；`pnpm -r build` 在合并 main 后必须重跑（exit 0），否则旧 contracts dist 缺导出会让 main 导入失败。

## 4. 已进 main / 仅候选 / 安装

| 项 | 状态 |
| --- | --- |
| wave-30 J 五源（facts/freshness/预算/omissions）与 0073/0077 预览、原表单、`create_work` | **已在 main** |
| `tools/distribution/build.mjs` 已包含 `project-recipes` | **已在 main 的发行闭包列表** |
| `rebind.ts`、`reidentified` 语义、CLI `--previous-facts`、first-user 测试 | **仅候选**（origin/main 无 `rebind.ts`） |
| R1 829（`82ee5b8f` / `8296720d8a25f38c` / tar `04926739…`） | 未修改、未安装；E 独立验收 |
| R2 后继包 | source `7a164c57` + dist + pack 列表；**tar 未创建**，D 冻结、E 绑定同一 tar |

分层：source/controlled PASS（真实 registry+preview+原 Application，三种形态）；installed NOT_REACHED；native 0；recovered NOT_REACHED（未用 fixture registry 替代）；value 不声称。

## 5. 余项与最小依赖

- main：重导入 `rebind.ts` 与 `index.ts`，并把 `--previous-facts` 纳入发布说明。
- D：按 contracts → project-recipes 顺序构建，纳入后继运行闭包并冻结 tar。
- E：对 R1 用 829 精确 tuple；对 R2 用 D 冻结的同一 tar。
- F/E 自身呈现与独立断言不在本包，未修改。

---

# 历史：wave-31（2026-11-15）

起点 `e6400429`，合并 `origin/main`（wave-31 派工 `8deda18d`，含 `303b2c6a` 观察导出/运行时检查点）后按 `agent-tasks/product-wave-31/agent-j-project-recipes.zh-CN.md` 执行三个连续交付包、每包四个完整成果（共 12 项）。

## 1. 三条发行线的准确状态

| 线 | 状态 |
| --- | --- |
| R1（829 固定包） | **只读核对、未修改**。source `82ee5b8f`、build `8296720d8a25f38c`、tar `04926739…`（20481470 B / 6849 项）；R1 源码含 0073/0077 预览链与 wave-29 模板层，缺 wave-30/31 的 future/clock/expiry/omissions/limits 与迁移对比。`r1-baseline.case.ts` 直接从 git 对象核对，不装、不冻、不改 R1 |
| R2（当前 source 与后继包） | 运行时 source `ecc81446`；`dist` 构建 0；`npm pack --dry-run` 38 文件 / 47,157 B；**tar 未创建**，由 D 在确定运行字节后冻结，E 绑定同一 tar |
| R3（迁移/长用/支持） | 新增只读迁移对比：`rebindRegisteredProject` / `reobserveProjectFacts` / CLI `--previous-facts`，输出 `current/changed/unbound/foreign` 与字段级变化 |

## 2. 包一：当前 facts/config/声明基线

- **J1** R1 事实来源：`r1-baseline.case.ts`（3 项）从 R1 source 断言 8 个 src、0073/0077 消费链与 endpoint 存在，并断言 R1 **没有** `observedMs > nowMs`、`omissions`、`validateMetadataLimits`、`project_scope_expired`。
- **J2** freshness/content/config：时间总是被核（不传 `now` 用真实时钟）；future/stale/invalid clock、未知/损坏配置、过期 scope、旧 draft 全部拒绝；同内容重观察可复用（82 库测试覆盖）。
- **J3** 三 kind 与原 scope/check/profile：只用已声明 atom、已启用 profile、已登记 check；blocked/readonly/unknown、缺 check、过期 scope、错项目/foreign atom 不被静默丢弃；脚本只是名字数据。
- **J4** 真实预览/确认：main 的 5 项集成测试 5/5；main 的 8 项工作台浏览器流程在 clean source `ecc81446` 上 8/8、两个 controlled work 被明确接受。**R1 已安装包的预览/确认仍是 E-owned、J 未安装 → NOT_REACHED**。

## 3. 包二：当前 source 的三 kind 实际项目

- **J5** observer：NOFOLLOW、lstat/open 的 inode+size、读后 size/mtime、根变更、普通文件/白名单、预算与 limits 校验（22 项）。
- **J6** 配置重用/失效：配置 schema/revision/project/profile/check/expiry 与 facts/catalog/字段身份全部参与；goal 编辑只改 goal；hash 不是授权。
- **J7** 两项目三 kind：同一真实 Application 内 3×2 全部 `dispatch recorded`；main 集成测试到达两个原候选与人工接受；preview/取消零业务写。
- **J8** 可打包模块：build 0、pack 38 文件 / 47,157 B、dist 导入闭包只允许内建/contracts/zod/兄弟模块；root deps/lock/importer 未改。

## 4. 包三：迁移项目与同事支持

- **J9** 迁移重绑：`rebindRegisteredProject({ previous, observedAt, roots })` → `unbound`（无登记 root，不猜路径）/`foreign`（旧观察属于别的项目）/`current`（内容未变）/`changed`（列出 manager/lockfile/workspace/scripts…）；报告只有 digest/时间/字段名，无绝对 root、凭据或授权。
- **J10** 迁移后的模板/检查适配：manager、lock、workspace 变化后旧草稿 `stale_inputs`，新树生成新建议；旧 grant/check revision 不复用；未知语言/布局/版本保持 needs_input/unsupported。
- **J11** 长用 CLI：`--previous-facts` 只读对比模式（0 current/changed、3 unbound、5 foreign/拒绝、2 参数冲突），拒绝与 `--facts/--kind/--paths/--output` 混用；错误脱敏、原项目不变。
- **J12** 三包交接：本状态与文档。

## 5. 实际验证

| 命令 | exit | 结果 |
| --- | --- | --- |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.json` | 0 | strict |
| `node --test packages/project-recipes/test/*.case.ts` | 0 | 82 tests / 82 pass |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.build.json` | 0 | dist |
| `./node_modules/.bin/tsc -p tools/project-recipes/tsconfig.json` | 0 | strict |
| `node --test tools/project-recipes/test/*.case.ts` | 0 | 33 tests / 33 pass |
| `node packages/project-recipes/examples/preview-consumer.ts` | 0 | 三态自检 |
| `node --test tests/integration/project-recipes.case.mjs` | 0 | 5/5 |
| `node tests/integration/project-recipes-browser.mjs reports/project-recipes/wave31-browser` | 0 | 8/8，clean source `ecc81446`，2 个人工接受 |
| `node agent-tasks/product-wave-31/verify.mjs --workspaces` | 0 | 静态派工校验 |
| `npm pack --dry-run` | 0 | 38 files / 47,157 B |

合并 main 后必须重建 workspace（`pnpm -r --workspace-concurrency=2 run build`，exit 0），否则旧 contracts dist 缺 `UsageObservationDownloadSchema`，main 集成测试会在导入期失败——这是构建产物过期，不是模板模块回归，已按此记录。

## 6. 分层与未达

| 层 | 状态 |
| --- | --- |
| source | PASS（82 库 / 33 工具 / strict / build / example / 派工校验） |
| controlled | PASS（真实 Application 3×2；main 5 集成；main 8 浏览器 clean source） |
| installed | NOT_REACHED（未装 R1 tar、未产出 R2 tar；E 独立验收） |
| native | NOT_APPLICABLE（真实 vendor/model/native = 0） |
| value | NOT_CLAIMED |
| activation | PASS_PRODUCT_PATH_CONTROLLED |
| recovered | NOT_REACHED（B/I 原恢复/native 不在本包，未用普通工作冒充） |

## 7. 交接

新增公开：`rebindRegisteredProject`、`reobserveProjectFacts`、`compareProjectFacts`、`changedFields`、`RebindReportSchema`、`REBIND_FIELDS`、`RebindError`；契约 `project-facts-rebind/1`。重导入改动文件：`src/rebind.ts`、`src/index.ts`。main 仍持有 root/锁/HTTP/App/表单，D 冻结 R2 tar，E 绑定同一 tar。

---

# 历史：wave-30（2026-11-15）

起点 `bd027a44`，合并 `origin/main`（wave-30 派工 `6f385a54`，含 0076/0077 工作台组合）后按 `agent-tasks/product-wave-30/agent-j-project-recipes.zh-CN.md` 执行四个完整子系统成果。main 本轮按 `bd027a44` 原字节更新了我 5 个 src，并在预览里使用 `factsContentDigest` 与服务端时间；本轮只改 J-owned 缺陷，不重造 HTTP/matcher。

## 1. 通用 freshness 与输入兼容（P2 关闭）

wave-30 复核指出：`assertDraftCurrent` 只测「过去」，同内容但 `observedAt` 在未来（如 2099）仍能通过 `now` 校验。现在的规则：

- **时间总是被核**：不传 `now` 时使用真实时钟，调用方无法靠省略 `now` 假装已核当前；未来观察或超过保留期（默认 60 分钟）都被拒绝。
- `now` 无法解析、`maxFactsAgeMs` 负数/小数/NaN/Infinity → `invalid_clock`。
- 当前配置用公开 schema **重新解析**：版本不支持、结构损坏、项目被移除 → `stale_inputs`（`configuration`），不再只信任 `revision` 字符串。
- 生成阶段：项目授权 `expiresAt` 已过 → `needs_input: project_scope_expired`；复用阶段：草稿 scope/配置授权过期 → `stale_inputs`（`staleInputs` 含 `expiry`）。
- 旧草稿（缺 `provenance.facts.contentDigest`）→ `stale_draft_version`，明确要求重新生成。
- 同内容、更新观察时间仍可通过（`contentDigest` 不变）；内容变化仍拒绝。

## 2. 有界读取与版本治理

- `MetadataLimits` 自身被校验：`0`/负数/小数/`NaN`/`Infinity`/超过硬上界（JSON 16 MiB、锁 64 MiB、64 文件、128 MiB）→ `invalid_limits`，不能靠配置预算绕过边界。
- 观察结果新增 `omissions: [{field, reason}]`（`too_large`/`truncated`/`unsupported`/`not_observed`），空列表不再看起来像完整来源。
- `lstat`↔`fstat` 的 `dev/ino/size` 与读后 `size/mtime` 检查、NOFOLLOW、普通文件、根校验、注册 root 全部保留；重复有界读取确定性稳定且只读。
- 未知 stack/manager/版本仍 `needs_input`/`unsupported`；monorepo 不猜成员；只引用已登记 check/profile。

## 3. 三模板到真实多项目消费

- 在一个真实 `createProductApplication` 内，三类模板 × 两个项目全部 `dispatch` `recorded`；跨项目原子 → `needs_input`。
- 同名不同 ID、不同 profile/check/scope、goal 编辑只改 goal：测试覆盖；字段继续通过 main 发布的 `ProjectRecipePreviewInput/Fields/Preview` schema。
- main 的真实链路（HTTP preview → 工作台建议 → 原表单预填 → 创建前重验 → 原 `create_work` → 候选 → 人工接受）本轮独立复跑：Node 集成 5/5，浏览器 8/8（clean source `11bf0d46`，两个 controlled work 被明确接受）。

## 4. 实际验证（本机，Node 24.21.0）

| 命令 | exit | 结果 |
| --- | --- | --- |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.json` | 0 | strict |
| `node --test packages/project-recipes/test/*.case.ts` | 0 | 75 tests / 75 pass |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.build.json` | 0 | dist |
| `./node_modules/.bin/tsc -p tools/project-recipes/tsconfig.json` | 0 | strict |
| `node --test tools/project-recipes/test/*.case.ts` | 0 | 26 tests / 26 pass |
| `node packages/project-recipes/examples/preview-consumer.ts` | 0 | 三态自检 |
| `node --test tests/integration/project-recipes.case.mjs` | 0 | main 真实链路 5/5 |
| `node tests/integration/project-recipes-browser.mjs reports/project-recipes/wave30-browser` | 0 | main 工作台流程 8/8，clean source，2 个人工接受 |
| `node agent-tasks/product-wave-30/verify.mjs` | 0 | 静态派工校验 |
| `npm pack --dry-run` | 0 | 34 files / 41,948 bytes（dist+README） |

## 5. 分层与未达

| 层 | 状态 |
| --- | --- |
| source | PASS（75 库 / 26 工具 / strict / build / example / 派工校验） |
| controlled | PASS（真实 Application 三模板×两项目；main 5 集成；main 8 浏览器 clean source） |
| installed | NOT_REACHED（无安装包；仅 pack 列表） |
| native | NOT_APPLICABLE（真实 vendor/model/native = 0） |
| value | NOT_CLAIMED |
| activation | PASS_PRODUCT_PATH_CONTROLLED（main 实际 HTTP/工作台/原表单已存在并通过；无 installed/native 准入） |

未达：F 的呈现验证（F-owned）、E 独立断言、安装包/native 结论、收益主张。

## 6. main 重新导入时的差异

改动文件：`src/facts.ts`、`src/observe.ts`、`src/draft.ts`、`src/match.ts`、`src/preview.ts`（另有测试/示例/文档）。新增：`facts.omissions`、`validateMetadataLimits`/`MAX_METADATA_LIMITS`、`invalid_clock`/`stale_draft_version`/`StaleInput 'expiry'`、`project_scope_expired`、`invalid_limits`。公开函数签名不变；根依赖/锁、HTTP、App、SQL 未改。main 已用服务端时间调用 `previewInputs`，新逻辑在其路径上等价且更严格（未来/过期时间会被拒绝）。

---

# 历史：wave-29（2026-11-15）

起点 `448a414e`，合并 `origin/main`（wave-29 派工，`79525b6`；含 main `a40232e` 的 0073 接入）后按 `agent-tasks/product-wave-29/agent-j-project-recipes.zh-CN.md` 推进。**本轮不再把 main 的 HTTP/App 标为未实现**：0073 的实际入口已存在，我消费它并独立跑了 main 的集成测试。

## 1. 与 0073 实际契约对齐

- main 的 `POST /v1/projects/:id/recipes/preview` → 原 NewWorkForm 预填 → 创建前重验 → 原 `create_work`，两项目已走到原 Work/check/currentCandidate/manualaccept。
- 我消费 `packages/contracts/src/project-recipe-preview.ts`（不修改它）：`ProjectRecipePreviewInput` 拒绝注入 root/命令/重复原子；我产出的字段通过 `ProjectRecipeFieldsSchema`；合成的 `project-recipe-preview/1`（draft 与 needs_input 两态）通过其 schema。测试：`tools/project-recipes/test/main-contract.case.ts`。
- 独立执行 main 的 5 项真实链路测试：`node --test tests/integration/project-recipes.case.mjs` → 5/5 PASS（含两项目 preview→创建→候选→人工接受）。

## 2. 观察时间与稳定内容分离

`provenance.facts` 现在同时携带：

| 字段 | 含义 |
| --- | --- |
| `digest` | 整份观察（含 `observedAt`） |
| `contentDigest` | 去掉 `observedAt` 的稳定内容摘要 |
| `observedAt` | 本次观察时间（provenance，不是授权） |

- 同字节重读（时间不同）：`contentDigest` 相同，`digest` 不同；内容变化（即使长度不变）：两者都变。
- 复用：`previewInputs` 只比较内容与配置；再观察一次相同内容不会误判过期。传入 `now` 时，超过 60 分钟保留期的观察被拒绝——旧观察不能升级为新的授权。
- 导出 `factsContentDigest`，与 main 未公开公式 `canonicalDigest(facts 去掉 observedAt)` 逐值一致（测试断言），main 后续可替换其内联实现。

## 3. 读取一致性与可编辑目标

- observer 每次打开都比对 `dev/ino/size`（lstat↔fstat），读完后再次比对 `size/mtime`；读取期间被替换或改写以 `replaced` / `changed_during_read` 拒绝，不返回半份内容。白名单、NOFOLLOW、`/`+home 拒绝、预算（256 KiB/4 MiB/12 文件/8 MiB）不变。
- 用户可改写目标：`previewInputs(draft, current, { goal })` / `toCreateWorkCommand(draft, ids, { goal })` 只换 goal 文本，scope/criteria/profile 与草稿一致；空/超长目标 `not_actionable`。
- CLI 与库同一实现：测试断言同一输入的 CLI stdout 与库结果深度相等。

## 4. 实际验证（本机，Node 24.21.0）

| 命令 | exit | 结果 |
| --- | --- | --- |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.json` | 0 | strict |
| `node --test packages/project-recipes/test/*.case.ts` | 0 | 67 tests / 67 pass |
| `./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.build.json` | 0 | dist |
| `./node_modules/.bin/tsc -p tools/project-recipes/tsconfig.json` | 0 | strict |
| `node --test tools/project-recipes/test/*.case.ts` | 0 | 26 tests / 26 pass |
| `node packages/project-recipes/examples/preview-consumer.ts` | 0 | 三态自检 |
| `node --test tests/integration/project-recipes.case.mjs` | 0 | main 真实链路 5/5 |
| `node agent-tasks/product-wave-29/verify.mjs` | 0 | 静态派工校验 |
| `npm pack --dry-run` | 0 | 34 files / 38,991 bytes（dist+README） |

## 5. 日常流程观察（J22，零模型）

对真实授权的 monorepo 根（本工作树，只读）观察一次：`pnpm`、workspace 声明、TypeScript 标记、脚本名；配合受控配置产出 `draft`（goal 文案、`packages/` 原子、配置 criteria、profile），并记录 `contentDigest` 与 `observedAt`。人工基线需要手写这四类字段；本轮不声称时间或质量收益。

## 6. 分层与未达

| 层 | 状态 |
| --- | --- |
| source | PASS（67 库 / 26 工具 / strict / build / example） |
| controlled | PASS（真实 Application 两项目 dispatch；main 集成测试 5/5，fixture 模式） |
| installed | NOT_REACHED（无安装包；仅 pack 列表） |
| native | NOT_APPLICABLE（真实 vendor/model/native = 0） |
| value | NOT_CLAIMED |
| activation | PASS_PRODUCT_PATH_CONTROLLED（main 实际 HTTP/App 已存在并通过其测试；无 installed/native 准入） |

未达：F 的食谱表单呈现验证（F-owned）、E 独立断言、安装包/native 结论、收益主张。

## 7. main 重新导入时的差异

本轮改动的包内文件：`src/facts.ts`、`src/draft.ts`、`src/match.ts`、`src/preview.ts`、`src/observe.ts`（另有测试/文档）。新增公开导出：`factsContentDigest`、`factsContentOf`、`DEFAULT_REUSE_MAX_FACTS_AGE_MS`、`CreateWorkOverrides`（goal-only）。公开函数签名向后兼容（`previewInputs` 第三参可选）；draft schema 增加 `provenance.facts.contentDigest`。根依赖/锁、HTTP、App、SQL 均未改。

---

# 历史：wave-28（2026-11-15）

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
