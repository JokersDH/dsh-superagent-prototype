# 合法零模型恢复输入（B/main 可复用）

2026-11-14，wave-26 H 第三结果。目录：`tests/operational-soak/recovery/`。

这不是第二 coordinator、第二 ledger、第二授权权威，也不是 B 的实现替身。它只把**合法输入**摆到 B/main 已拥有的组件前：

| 复用组件 | 用途 |
| --- | --- |
| `apps/coordinator/product/runtime.ts` `createControlledProduct` / `FIXTURE_CHECK` | 原 ProductRuntime/Application/QuestionBroker，受控 fixture 执行器（本地 Node 脚本） |
| `packages/storage` `ProductStore` | 原 A Store/UoW 与公开读取集合（works/questions/answers/commands/events） |
| `apps/runner/src/file-journal.ts` `FileCriticalJournal` / `decodeBuffer` / `encodeRecord` | 原 journal producer/reader，不另造帧格式 |
| `packages/execution/src/recovery-transport.ts` `serveRunnerRecovery` / `connectRunnerRecovery` | 已准入 B recovery port（仅 inspect/cancel） |

## 入口

```bash
# 产生一个完整合法包（新目录，0600 报告）
node tests/operational-soak/recovery/produce.mjs --out <新目录>

# 用原公共 reader 复核该包
node tests/operational-soak/recovery/read.mjs --run <produced-root>
```

退出：`0` 正例/负例全部按预期，`1` 有未预期差异，`2` 参数/材料拒绝。

产物：

| 文件 | 内容 |
| --- | --- |
| `normal.json` | 真实 Work/Attempt/Question/Answer/native_applied tuple、factSource、executor、modelCalls=0、vendorTurns=0 |
| `journal/critical.ndjson` | 由原 producer 追加的 5 条合法事实（turn.ended / answer.observed / candidate.observed / runtime.exited / usage.observed） |
| `journal.json` | journal 摘要（bytes/sha256/lastSeq/kinds/digests）与 7 个负例（partial tail、digest 翻转、seq gap、长度前缀、payload kind 不符、缺 factId、record size 限制），每个都 `sends=0, executes=0` |
| `recovery-port.json` | 已准入 port 的 positive inspect/cancel 与 5 个故障（auth_failed、foreign_subject、changed_socket_identity、timeout、stale_proof） |
| `read.json` | 原公共 reader 的逐项检查（work/question/answer receipt/delivery native_applied/journal/foreign source） |
| `report.json` | 汇总：subject、entry 路径、正反结果、`businessResume: NOT_REACHED`、limits |

## B/main 绑定方式

- journal 事实绑定：`expectedSource = normal.factSource`，`expectedAttempt = normal.attempt`（ticket/assignment/attempt/fenceEpoch + contract）；任一不符由 `readJournalFacts` 拒绝，`sends=0`；
- recovery port：`connectRunnerRecovery(endpoint, { attempt: normal.attempt, runnerIdentityRef: 'fixture-runner-identity', source: normal.factSource })`；端点来自 `serveRunnerRecovery` 的 socketIdentity（dev/ino）；
- 正常链的 `question.targets[0]` 是完整 AttemptRef，`deliveries[0].status === 'native_applied'`；
- 所有事实来自原 API 路径，不是手写 SQL，也不是 receipt-only 服务。

## 明确未达

- **业务重连/attach/begin/deliver/answer 通道：NOT_REACHED。** 本目录没有业务路由，不模拟“已恢复”；
- **SIGKILL/跨进程原问答恢复：NOT_REACHED。** 包内是同进程 fixture；不启动 daemon、不发送任何信号；
- **原 Work 人工接受/2/4 资源：NOT_REACHED。**
- 不修改 B runtime、main guard、A SQL；不新增空方法或绕过授权；不读取个人 state/profile/credential。

## 零模型与安全边界

- `executor=controlled_fixture`：固定本地 Node 脚本，`modelCalls=0`、`vendorTurns=0`、`nativeProfile=null`；
- 新私有 fixture 根 + 一个短 `/tmp` 自有 socket/credential 目录（结束时删除），不触碰十二用户服务；
- journal/port 故障只产生协议拒绝与计数，不产生发送或执行；
- 报告中的 home 前缀脱敏为 `~`；`state/`、`project/` 是可重建材料，默认不入报告目录。

## 复现

```bash
node tests/operational-soak/recovery/produce.mjs --out /tmp/recovery-$(date +%s)
node tests/operational-soak/recovery/read.mjs --run /tmp/recovery-<同一个目录>
node --test tests/operational-soak/recovery/recovery.case.mjs
```
