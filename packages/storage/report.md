# WP-02 报告：事务存储、Effects、Outbox 与数据迁移

- **分支**：`codex/g1-storage-effects`（本报告随本轮 commit 提交；commit 见 `git log -1`）
- **Base**：`700c0dd`（`feat(g0): freeze shared contracts and accept integrated bootstrap`）；修复轮已合入 `origin/main` 至 `2cf047a`
- **拥有路径**：`packages/storage/`、`packages/effects/`、`docs/adr/storage/`、`docs/rfcs/WP-02/`
- **契约身份**：`@personal-agent/contracts` v1.0.0，apiMajor 1，schemaHash `74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`（G0 冻结）
- **环境**：`reports/environment.txt` — Node v24.21.0、pnpm 11.7.0、darwin/arm64、better-sqlite3 13.0.3、SQLite 3.53.4

## 0. 修复轮（主 Agent G1 评审反馈，2026-11-07）

评审输入：`agent-tasks/g1-agent-a-review.md`、`docs/adr/core/g1-integration-review.md`。三项阻断项已修复，并用主 Agent 的官方复现脚本验证：

| 评审项 | 修复 | 证据 |
| --- | --- | --- |
| **A-LOCK-INITIALIZATION**：空锁文件被第二实例抢走；stale 接管存在 probe→unlink→create 竞争 | 所有权改为数据库单行 `writer_claim` 的原子 claim / CAS takeover / 条件 release（迁移 v2）；锁文件降级为**建议性面包屑**，以“完整内容 + `link`”原子创建、由 claim 胜者原子 rename 替换；空/损坏/未知内容一律 fail closed（`unknown` verdict），不再当作死亡证据；无 registry 时不接管；成功后置失败（注册/面包屑）会释放 claim | `test/writer-lock.case.ts` 8 个用例（含空文件窗口、两个并发 stale 接管者、旧持有者 release 不删新锁、注册失败清理）；官方复现脚本 **A-LOCK-INITIALIZATION = PASS**（"Refused unknown ownership"） |
| **A-ASYNC-TRANSACTION**：`atomic` 接受 Promise，RELEASE 早于其完成 | `atomic` 检测 thenable 后在 call site **同步抛 TypeError**，先回滚 savepoint 再抛出；异步续段的 rejection 被观察（不产生 unhandled rejection）；导出 `SyncOperation<T>` 供类型化调用点约束（泛型 `Repositories.atomic` 适配器无法在类型层加 Promise 禁令而不误伤泛型透传，运行时拒绝是硬保证） | `test/uow.case.ts` 异步负例（`rejectedSynchronously=true`、残留行 0）；官方复现脚本 **A-ASYNC-TRANSACTION = PASS**（`{"rejectedSynchronously": true, "persistedRowsAfterFailure": 0}`） |
| **接口与归属**：接入公共 core 类型、保留完整 JSON（尤其 completion）、不剥离未知字段 | `DomainStore` 保持对聚合 JSON 的泛型；新增 `test/core-binding.case.ts` 用**公共** `@personal-agent/orchestrator-core` 的 `Repositories/Ticket/Thread/Trigger/Decision` 类型做编译期结构绑定 + 运行时 completion/未知字段完整往返；RFC-01 标记 **RESOLVED**（主 Agent 结构适配器，无第二 domain-model 包） | `core-binding.case.ts`；主 Agent `check-core-sqlite.mjs`：**178/178** core 测试在真实 `ProductStore` 上通过（144 原始 + 34 personal），typed binding 通过 |
| 归属与依赖 | 公共兄弟包改为 `workspace:*`（contracts/effects），新增 core devDependency；删除局部分包 lock 与嵌套 `pnpm-workspace.yaml`；根 lock 更新作为 main 集成步骤（不写入功能分支提交） | `packages/storage/package.json`；根 workspace 安装后各包可独立 typecheck/test/build |

本轮实际结果：storage **44/44**、effects **8/8**、两包 typecheck/build 通过、core-on-SQLite **178/178**；官方复现脚本的 A/MAIN 三项全 PASS，B 五项 FAIL 属 runtime owner 范围（`reports/g1-review-repros-observed.txt`）。旧 34 个测试全部保留且通过。

## 0.2 修复轮 2（G1 跟进评审，2026-11-07）

跟进输入：`agent-tasks/g1-followup-review.md`、`tools/bootstrap/review-g1-followup.mjs`、`docs/rfcs/WP-01/0001-runtime-ingress-store.md`。

| 评审项 | 修复 | 证据 |
| --- | --- | --- |
| **A-ASYNC-AFTER-AWAIT**：async 函数在 await 后仍写库（`rowsWrittenAfterRollback=1`） | `UnitOfWork.atomic` 在**调用之前**拒绝原生 async 函数（`[object AsyncFunction]`，含 bound/double-bound async），函数体根本不启动，因此没有 await 后的续段；保留“普通函数返回 thenable → 同步抛错 + 回滚”的防御；JSDoc 明确“把异步工作藏在闭包里”是禁止用法，且不能宣称回滚能取消已运行的 continuation | `test/uow.case.ts`：native async 未启动（`began=false`）、bound async 同样拒绝、plain-thenable 同步写入回滚；官方跟进脚本 **A-ASYNC-AFTER-AWAIT = PASS**（`{"rejectedSynchronously":true,"callbackBegan":false,"rowsWrittenAfterRollback":0}`） |
| **SAVEPOINT 抛错时 nesting/回调栈清理** | `SAVEPOINT` 成功后才递增 depth/占用回调槽；打开失败不改变任何状态；失败路径统一恢复 depth、丢弃该层回调；回调异常不掩盖原始错误 | `test/uow.case.ts` 故障注入用例（首次 SAVEPOINT 抛错 → `nesting=0`，随后事务正常且 afterCommit 只触发一次） |
| **生产 ingress 存储**（RFC 0001：A 提供 binding/history/resource/immutable payload 存储） | 迁移 **v3** 新增 `runtime_bindings`（按 attempt 的完整 binding JSON 历史）、`runtime_current`（ticket→当前 attempt，和历史分离）、`runtime_authority`（启用的合同版本，供 current-authorization）、`ingress_payloads`（内容寻址的不可变 JSON 载荷）。`RuntimeBindings` 强制 binding 身份不可变、ended 不可复活；`ImmutablePayloads` 以 canonical JSON 写入 ArtifactStore（文件与记录先于返回完成），读取时校验 artifact 与记录摘要；`canonicalJson/canonicalDigest` 与 coordinator 的 `jsonDigest` 一致 | `test/ingress-stores.case.ts`（历史/current/重开、身份不可变、ended 终态、authority 启停、payload 不可变与摘要）；`test/ingress-compat.case.ts`（与主 Agent 的 `IngressBinding`/`ImmutablePayloadReader` 类型兼容 + digest 一致性，含 unicode/嵌套/数组/null） |
| 本轮结果 | storage **54/54**（原 44 个保留）、effects **8/8**、typecheck/build 通过；官方跟进脚本 **PASS_FOLLOWUP_INVARIANTS**（A 与 B 共 5 项全 PASS）；原评审脚本 A-LOCK-INITIALIZATION / A-ASYNC-TRANSACTION / MAIN-SYNC-BRIDGE 仍 PASS | `reports/` 下 test/typecheck/两个复现脚本原文 |

## 0.3 批次 1（g1-agent-a-runtime-state.md）：绑定与当前授权不变量

输入：`agent-tasks/g1-agent-a-runtime-state.md`（base `5281e84`）。迁移号 **v4**。

| 要求 | 实现 | 证据 |
| --- | --- | --- |
| `setCurrent` 拒绝别的 Ticket 的绑定 | 读取 binding 校验 `ticketId` 严格相等 | `test/runtime-state.case.ts`：跨 Ticket 指针拒绝（含反向） |
| current 不能回退旧 epoch、不能复活 ended | 与当前指针尝试比较 `fenceEpoch`：更低 → 拒绝；相同但不同 attempt → 拒绝（歧义）；相同 attempt → 幂等 no-op；ended → 拒绝成为 current | 旧 epoch 回退、同 epoch 歧义、ended 目标、幂等重试用例 |
| 每 Ticket epoch 单调、状态单调 | state 只允许 active→stopping→ended；stopping 不得回 active；ended 终态（ended→ended 幂等） | 状态矩阵用例 |
| 资源只能追加、identity/ownership 不可替换或删除 | 更新时已登记资源必须仍以相同 ownership 出现；允许追加 | 追加/删除/改 ownership 三例 |
| 同 Work 只能一个有效合同；切换需同事务禁旧启新；同 Work/revision 不同 digest 冲突 | `enable` 先判 re-issue digest 冲突，再判同 Work 已有 enabled revision（要求同事务先 disable）；DB 层加唯一部分索引与 (work_id,revision) 唯一索引；`disable` 保留历史；新增 `current(workId)`/`history(workId)` 读取 | 双合同拒绝、同事务切换、撤销后 reopen 仍 false、历史读取 |
| 用新 migration，v1–v3 checksum 不改写，升级兼容 | v4 仅新增两个唯一索引；测试锁定 v1–v3 checksum 常量，并用 `applyMigrations(registry=v1..v3)` 造 v3 库再以 ProductStore 升级，验证数据保留且新不变量生效 | checksum 冻结用例；v3→v4 升级用例（integrity 通过） |
| 失败事务中 pointer/授权一起回滚 | 所有方法在调用者事务内执行；失败事务用例 | `a failed transaction rolls the current pointer and authority back together` |

本轮结果：storage **60/60**（原 54 项全部保留），typecheck/build 通过。

## 0.4 批次 2（g1-agent-a-runtime-state.md）：运行观察与可恢复证据

输入同上；迁移号 **v5**。

**对外接口**（组合根使用，无需私有 SQL）：

```ts
store.observations.record({ fact, payload, disposition, payloadSha256 })   // 必须在 ingress 事务内
store.observations.get(factId)
store.observations.forAttempt(attemptId, limit?)        // 事实级证据，按提交顺序
store.observations.forResource(resourceRef, limit?)      // 资源级证据（审计）
store.observations.summarize(attemptId): AttemptObservationSummary
// { attemptId, observations, last?, cancel: { observed, acknowledged },
//   resources: [{ resourceRef, observations, last, exit: { observed, exitCode?, signal? },
//                 writer: { observed, status? }, quiescence: 'observed_quiescent' | 'unknown' }] }
```

| 要求 | 实现 | 证据 |
| --- | --- | --- |
| 持久化 RuntimeObservation/ResourceObservation，消费严格 RuntimeFactPayload 与原 factId/payloadRef | `record` 接收 contracts 的 `CriticalFact` + `RuntimeFactPayload`（由 `parseRuntimeFactPayload` 解析），保存 factId/payloadRef/宿主记录的 payload SHA-256/合同/epoch/disposition/规范化 detail；物理 payload（`runtime.exited`、`writer.observed`）按资源落行 | `test/observations.case.ts`：业务事实一行、无资源行；`get/forAttempt/forResource` |
| 与 FactReceipts/core mutation/events/effects 共用 UnitOfWork | `record` 断言 `nesting ≥ 1`（必须在 ingress 事务内）；失败事务用例中 pointer/授权/receipt/observation/event/effect 一起回滚 | `observations must be recorded inside the ingress transaction and roll back with it` |
| 按 attempt/resource 记录观察与来源；cancel ACK、parent exit、writer quiescence 分开，不能互相推断 | 事实行带 provenance；`summarize` 把 cancel（dispatch 级）、exit（每资源）、writer（每资源）独立暴露；`quiescence` 仅在最新 writer.observed 显式 `quiescent` 时为 `observed_quiescent`，exit 或 cancel 后仍为 `unknown`；后续非 quiescent 观察会撤销该状态 | `cancel acknowledgement, process exit and writer quiescence stay independent facts` |
| 旧/ended attempt 的物理观察可保存，但不能改变新 attempt 的资源或恢复授权 | 观察只写观察表，不触碰 bindings/current/authority；用例在旧 attempt ended、新 attempt current 后记录旧物理观察，断言 current、资源集与授权不变，且新 attempt 摘要不含旧事实 | `an old attempt physical observation is stored without touching the new attempt, pointer or authority` |
| 提供组合根读取/归约接口，不让主 Agent 用私有 SQL | `summarize/forAttempt/forResource/get` 为公开 API；生产字段归本包，wire 数据来自 contracts | `composition fixture: the public ports accept one fact transaction and reduce its evidence`（演示 stored-ingress 的调用形状与幂等重放） |
| 不按超时/缺 PID 释放资源，不制造物理成功 | 库层没有任何 release API；只记录与归约；未知 attempt/未登记资源/ownership 不符一律拒绝（fail closed） | 分离用例 + `physical observations refuse an unknown attempt or an unregistered or differently-owned resource` |

本轮结果：storage **66/66**（批 1 的 60 项全部保留）、effects 8/8、core-on-SQLite 178/178、ingress 18/18 与 7/7、跟进复现脚本 5/5 仍 PASS。主 Agent 接线方式：在 `stored-ingress.ts` 的 `applyBusiness/applyPhysical` 中把现有的 `events.append` 观察替换为 `store.observations.record({ fact: input, payload, disposition, payloadSha256: payloadDigest })`（`payloadDigest` 即 ingress 已计算的 canonical 载荷摘要）；读取用 `store.observations.summarize(attemptId)`。

## 1. 交付物

| 交付物 | 位置 |
| --- | --- |
| 队列算法包（QueueStore 端口 + 合并/有序/退避/Later/unknown-send 停靠） | `packages/effects/` |
| 存储包（单连接 UoW、域表、收据、事件、SQLite 队列、调度台账、outbox、答案、工件、备份、writer lock、迁移） | `packages/storage/` |
| 单一迁移入口与全部产品表 | `packages/storage/src/migrations.ts`（`MIGRATIONS`，version 1） |
| 真实故障窗口测试与恢复证据 | `packages/storage/test/crash.case.ts` + `test/crash/worker.mjs` |
| 数据库/备份格式与 repository 文档 | `packages/storage/README.md`、`docs/adr/storage/ADR-000-transactional-storage.md` |

对外 interface（与 WP-02 要求一致）：同连接 `UnitOfWork`/`DomainStore`/`SQLiteQueueStore`、`CommandReceipts`/`FactReceipts`、`EventLog` 游标、产品 repository ports（channels/answers/artifacts/dispatch）、`backupDatabase`/`verifyDatabase`、`applyMigrations`、`WriterLock`。

## 2. 实际命令与结果

所有命令在各自包目录执行：

| 包 | 命令 | 结果 |
| --- | --- | --- |
| storage | `pnpm install` | PASS — better-sqlite3 13.0.3 预编译加载，qlite 3.53.4；局部 `pnpm-workspace.yaml` 记录 `allowBuilds: better-sqlite3: false` |
| storage | `pnpm typecheck` | PASS（`tsc -p tsconfig.json`，含 tests） |
| storage | `pnpm test` | **PASS 34/34**（`reports/test-output.txt`） |
| storage | `pnpm build` | PASS（`tsc -p tsconfig.build.json` → `dist/`，可加载） |
| effects | `pnpm typecheck` / `pnpm test` / `pnpm build` | PASS — **8/8**（`packages/effects/reports/test-output.txt`） |

## 3. 验收映射（WP-02 负责的适用断言）

| ID | 结果 | 覆盖与证据 |
| --- | --- | --- |
| DATA-01 | **PASS（继承 + 消费）** | storage 消费 `@personal-agent/contracts` v1.0.0（`CommandReceipt`/`DurableReceipt`/`AnswerDelivery`/`NativeDispatch` 类型），无私有副本；G0 的 schema 检查不重复声明 |
| DATA-02 | **PASS** | `test/uow.case.ts`：跨 domain/receipt/queue/event/dispatch/answers 的单一事务，末步抛错全部回滚；`test/crash.case.ts`：真实子进程在 commit 前/后 SIGKILL，重开 DB 快照一致，重放同 commandId 要么全量应用一次、要么去重 |
| DATA-03 | **PASS** | `test/receipts-events.case.ts`：同 commandId+digest 去重（不重复 apply/effect/event），异 digest 抛 `CommandConflict`；fact 同构；`test/queue-effects.case.ts` 无重复队列行 |
| DATA-04 | **PASS** | `test/uow.case.ts`：同连接、嵌套 savepoint、内层回滚保留外层、外层回滚丢弃全部、afterCommit 仅在真实提交触发且回滚层级丢弃回调 |
| DATA-05 | **PASS** | `test/artifacts.case.ts`：temp→fsync→rename 后引用才存在；digest 校验读取；宽限期内不删、过期后只删无引用与 tmp 文件，被引用文件永不删除 |
| DATA-06 | **PASS** | `test/migrations.case.ts`：全新库应用并记录 checksum；重开幂等；body 被改/版本有洞/未来版本/未知库/上游应用库（`kv` 标记）全部拒绝；失败的迁移整体回滚、同一版本号可重试，不跳过 |
| DATA-07 | **PARTIAL（storage 侧 PASS，集成 NOT_TESTED）** | `test/outbox-answers.case.ts`：答案按 ID+digest 只记录一次；`(answer_id, target_binding_id)` 主键保证每 target 至多一条投递通路；恢复读取逐 target 状态；expired 不被复活。QuestionBroker 的 commit 与 answer effect 同事务、恢复后逐 target 精确——属 WP-05，本包已提供存储材料，集成证据 NOT_TESTED |
| DATA-08 | **PARTIAL（storage 侧 PASS，集成 NOT_TESTED）** | `test/receipts-events.case.ts`：事件与变更同事务、seq 无洞（回滚不消耗序号）、`after(cursor)` 分页。snapshot/SSE 一致性与 Work 投影重建属 WP-10，NOT_TESTED |
| REL-01 | **PASS** | `test/crash.case.ts` 两个真实退出窗口：commit 前 → 无 receipt/无半接单，同命令重放完整应用一次；commit 后 → receipt 与 effect 均已持久，重放去重、继续原 effect 而非重建工作 |
| REL-02 | **PASS（分类接线）/ 真实 native NOT_TESTED** | `test/dispatch-ledger.case.ts` + `test/queue-effects.case.ts`：`not_sent` 才可重发；`written`/`indeterminate` 阻断并等待 reconcile；unknown send 的队列行停靠且跨重启不重发；`markWritten` 先于物理写出。真实 Driver 的写出/回执语义属 WP-03/WP-07，NOT_TESTED |
| REL-03 | **PASS** | `test/writer-lock.case.ts`：第二实例 `in_use` 拒绝；子进程被 SIGKILL 后锁为 `stale` 可安全接管；活 PID + 未知 nonce 判为 `suspect_pid_reuse`，拒绝接管且不改写锁文件 |
| OPS-03 | **PASS（存储层）** | `test/backup.case.ts`：WAL 活跃时用在线 backup API 生成快照，恢复副本 `integrity_check=ok`、`foreign_key_check=0`、schema 一致；打开恢复库不自动派发业务（队列仍 pending）。被引用的 artifact 文件与 journal 的完整打包属 G3 发行环节，NOT_TESTED |

未测项不冒充：native runtime、Driver、完整 E2E、跨平台（仅 darwin/arm64 实测）、Node 24.22.2 拟议发行组合（OPS-01 归 Agent B，本轮用本机 24.21.0 + 已证 binding）。

## 4. 限制与已知取舍

- 单进程单 writer（savepoint + 单连接）；多实例需要乐观版本与第二写者授权，超出首版。
- 队列的 running 集合是内存态：崩溃后行保持 due 并重放，因此每个 handler 必须幂等（沿用上游不变量）。
- `Work`/`contracts`/`questions`/`runtime_bindings`/`writer_leases` 等表不在 v1：由对应 owner（WP-01/03/05）向 storage owner 提交迁移请求，保证单一迁移入口；任何模块不得私开 DB writer。
- 停靠行对同一 `(kind, key)` 的再入队免疫，必须由 reconcile 先 `cancel`——reconcile 的消费方（WP-03/WP-05）尚未实现。
- `DomainStore` 对 JSON 路径的结构耦合见 RFC-01。

## 5. 未决 RFC

- `docs/rfcs/WP-02/RFC-01-domain-type-binding.md`：请 WP-01 发布 core `Repositories` 与本存储的绑定，并建议用提取出的 144-test core 套件跑 SQLite 后端，让字段路径重命名变成测试失败而不是生产扫描错误。

## 6. 下游接手

- WP-10 以 `ProductStore` 为唯一写入口组装 ApplicationService：`uow.atomic` 包命令，`commands.record` 去重，`queue.enqueue` 排 effect，`events.append` 记事件；打开恢复库时不要调用 `Effects.start()`，先走 reconcile。
- WP-03/WP-05 通过 storage owner 追加迁移号；`DispatchLedger` 是 native send 状态的唯一记录点。
- WP-16 集成根 workspace 时，把两个包的 `file:` 依赖改为 workspace 链接，并保留各自 `reports/` 证据。
