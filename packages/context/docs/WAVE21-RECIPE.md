# 第二十一轮 Agent C：双格式个人来源审阅与可解释 Scope 收缩

2026-11-13，基线 merge `7a0780f`（`origin/main` `a92bb9e`，main 标准启动身份 `f856fa5`）。
C 只改 context/proposals/knowledge/routing；真实 vendor model/native 0；未写 SQL/HTTP/第二确认/LLM loop。
本轮不重修已过的 personal 单链，而是在同一真实数据上补 **v1/v2 两格式实际个人恢复** 与
**合法窄 Scope/排除路径的真实 `scope_changed`/`partial`**，以及每例独立归因的拒绝矩阵。

## 1. 固定数据链（C1，不重复手造）

`packages/knowledge/test/main-personal-dual-format.case.ts` 复用真实链：

- 受控正常产品：`create_work` → 真实 Broker question → `answer_question` → delivery
  `native_applied` → accept → Work `delivered`；权限问答只有 anchored/`question_answer_display`。
- 同一 Store：真实 SDK 候选 + **已确认 proposal 回执** + selected-context frozen binding。
- 原候选 `payloadDigest`、frozen `bundleDigest`、binding scope 与 source ids 在恢复前捕获。

## 2. 两格式实际个人恢复（C2）

同一 Store 产出默认 v1（13 族）与显式 v2（21 族），各自 verify：

| 格式 | 恢复 root | 启动入口 | 结果 |
| --- | --- | --- | --- |
| `workflow-snapshot/1`+`workflow-evidence/1` | `restored-v1` | 标准 `tools/dev/start.mjs --discussion-only --review-restored-scope` | 真实 personal API/Vite，读到原候选/history/frozen 原文/Work/native；业务 422 |
| `workflow-snapshot/2`+`workflow-evidence/2`+`familySetVersion 2` | `restored-v2` | 实际 `demo.ts --discussion-only --assistant --review-restored-scope` | 同样读取原身份与 Work/native；候选 prepare 422 |

两 root 各自持有自己的 `personal-restore/1` marker、自己的 `api.key`/`action.key` 和自己新生成的
`restored-personal-review/1` 文件；v2 不是只 create/verify，也不是拿 v1 的个人结果顶替。

## 3. 合法窄 Scope 与排除路径（C3）

CLI 生成合法签名文件：

```sh
node tools/dev/review-restored.mjs --state <restored> --project <id> \
  --allow-path src/narrow/ --output <new-600.json>
node tools/dev/review-restored.mjs --state <restored> --project <id> \
  --allow-path src/ --exclude-path .git --exclude-path src/secret/ --output <new-600.json>
```

真实 personal 进程读取结果（不是模块替代）：

| 数据 | 宽 selection | 窄 selection / 新排除 |
| --- | --- | --- |
| `GET /v1/messages/:id/candidates` | 200，原 `payloadDigest`，`executable:false` | 200，`candidates:[]`，`rejected:[{reason:'scope_escalation'}]` |
| `GET /v1/context/history` | 200，1 条原 entry | 200，1 条原 entry |
| `GET /v1/messages/:id/context/sources` | `verified`，含原冻结文本 | `scope_changed`，sources 为空（不把缺内容说成完整） |
| `GET /v1/works/:id` / deliveries | `delivered` / `native_applied` | 仍只读可见 |
| 业务 POST | 422 | 422 |

C 侧新增**纯投影** `packages/context/src/restored-review.ts`：

```ts
explainRestoredReviewScope({ bindingScope, selection, sourcesState, frozenSourceIds, readableCandidates, readableHistory, readableWorks, readableDeliveries })
→ { protocol:'restored-review-scope/1', state, scopeChanged, partial, reasons, withheldSourceIds, readable, authorization:'none' }
```

窄允许路径得到 `state:'scope_changed'`、`partial:true`、`reasons:['selection_narrowed']`、
`withheldSourceIds` 等于原冻结来源；新增排除得到 `reasons:['exclusion_added']`。该投影只解释
HTTP 实际数据，`authorization` 恒为 `none`，不会把选择或读取变成执行 grant。

## 4. 每例独立拒绝归因（C4）

`main-personal-dual-format.case.ts` 的第二个 case 对每个变化使用**自己的**新 Store/marker/key/
有效签名文件，先做正对照（`loadRestoredReview` 成功），再只改一个字段：

| 单独变化 | 结果 |
| --- | --- |
| 外部 source 增加 held 行 / marker 内容 | forbidden（签名仍有效，绑定不再匹配） |
| signature 被替换 | forbidden |
| `stateRoot`（带新合法签名） | forbidden（真实 root 绑定） |
| `machineDigest`（带新合法签名，模拟别的 host） | forbidden |
| principal（带新合法签名） | forbidden |
| 请求 scope 改变但沿用旧签名 | forbidden |
| 过期、0644、symlink、FIFO、缺文件 | forbidden |
| 未知 project / `../outside` / externalActions / `executable:true` | prepare 显式拒绝 |

不再在同一坏 Store 上累加失败；main 原独立矩阵保持自己的 scope，本包不把它称为新的生产漏洞。

## 5. 标准启动一致性与回执（C5/C6）

- `tools/dev/start.mjs` 实际启动后 health `restoredReviewDigest` 与 `workbench.json` 一致；
- 同一文件再次 start 打印原 `consoleURL`，`workbench.json.pid` 不变；
- 缺 selection、另一有效窄 selection、`--restart` 均 exit 1；
- 另一 selection 同时带 `--port` 或 `--require-login` 仍先报“只读恢复选择与本次请求不同”，
  不进入 build/stop，PID 不变；
- 原已确认 proposal token 与旧 context token 重放均 422，provider 仍原 2 次；
- 宽 selection 下 frozen body/`bundleDigest` 与源 root 完全一致，不被 live 源替换；
- source inspect/prepare/confirm 仍 `not_granted`/`startupAvailable:false`，target 目录不创建。

## 6. reader 成本与边界（C8）

- 只读审阅返回 1 条 history、候选/source DTO 均 <64KiB（实际断言），不做全库正文扫描；
- 复用既有 600 字节文件、8 候选/长文本与 10000 history 的边界测试，不新增扫描器；
- 未跨 await 持 SQL 事务（读取均走 main/A 的同步端口），未写第二确认或新 ledger；
- provider 0 次新调用，queue held 数保持 1。

## 7. D/E 可参数化消费步骤（C7，source-only，不认证旧包）

参数：`INSTALL_ROOT`（安装根）、`STATE`（restored state，含 `state.sqlite`、`artifacts/`、
`restore-report.json`）、`CONSOLE_PORT`、`API_PORT`、`MODEL_CONFIG`、`REVIEW_FILE`（新 600 文件）。

```sh
# 1. 当前恢复库必须已验证（personal-restore/1 + schema18 等由安装器自己校验）
# 2. 生成本次选择（使用包内 tools/dev/review-restored.mjs；新文件，已有文件不会覆盖）
node "$INSTALL_ROOT/tools/dev/review-restored.mjs" --state "$STATE" --project <id> \
  --allow-path src/ --output "$REVIEW_FILE"

# 3. 标准启动（或包内等价 personal entry）
cd "$INSTALL_ROOT" && PA_MODEL_CONFIG="$MODEL_CONFIG" pnpm start --discussion-only \
  --state "$STATE" --port "$CONSOLE_PORT" --api-port "$API_PORT" \
  --review-restored-scope "$REVIEW_FILE"

# 4. 断言
#    GET /v1/health -> mode=personal, startupMode=recovery_readonly,
#      restoredReviewDigest == 包内同一函数的文件摘要
#    GET /v1/messages/:id/candidates -> 200, executable:false, authorization:none
#    GET /v1/context/history?projectId= -> 200
#    GET /v1/messages/:id/context/sources -> verified（宽）或 scope_changed（窄）
#    POST /v1/assistant/candidates/prepare、/v1/commands、/v1/assistant/context/send -> 422
#    held queue 不变；provider 请求数不变；target 目录不创建
```

consumerEntry（本次实测）：`tools/dev/start.mjs`、`apps/coordinator/product/demo.ts`、
`tools/dev/review-restored.mjs`、`apps/coordinator/product/restored-review.ts`；
源提交为 C 本轮 branch HEAD（见 status `sourceCommit`）。**package subject 由 D 的实际 tar/hash/build
提供，E 必须绑定同包 consumer 字节**；本包的 source 通过不认证旧 D 包，也不能用 source checkout
为旧包补 installed 结果。

## 8. 限制

- 实测入口为 `start.mjs`（标准 personal API+Vite）与 `demo.ts`（第二 root/窄/排除）；未跑 D launcher。
- 恢复仍是真实 v1/v2 产品库/artifacts 复制 + 真实 marker，不是完整安装/升级矩阵。
- 窄 selection 下候选被 `scope_escalation` 拒绝是正确行为，不是“缺候选”；frozen 原文按
  `scope_changed` 不展示，也不冒充足够。
- 无 private permission、target 启动、queue 消费或 vendor native；权限问答未被普通模型复用。
