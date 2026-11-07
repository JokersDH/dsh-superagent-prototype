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
