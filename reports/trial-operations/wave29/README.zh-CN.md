# H wave-29：current selected source、可信出生与原交付支持

2026-11-15，`codex/g4-trial-operations`，固定 `2d1e494` 后合并 `origin/main 79525b6`（H 当前 `5a4aea9`）。本目录是 wave-29 原始材料；wave28 旧 d95/cb4 selected 材料按原时间范围保留，不贴 current。

H 不是 release/native 权威；E 独立 required，B/I 自己修实现。

## 六个结果

| 结果 | 内容 | 位置 |
| --- | --- | --- |
| H4 | current I/B committed source 三回调消费者 | `selected-current/` |
| H8 | registered birth/exact args/UNKNOWN/fresh signal 工具 | `procguard-v2/` |
| H12 | I CAS/fresh/namespace/prune 与 B service 实际回调/guard 差异 | `selected-current/i.json`、`b.json` |
| H16 | 原 A/Broker 正常链与同 ID ACK 窗口 | `delivery/` |
| H20 | currentCandidate/manual accept/2/4 works + 1fbaf94 包 | `delivery/`、`package-1fbaf94/` |
| H24 | 原始材料、指南、状态 | `../wave29-status.json`、`docs/internal-trial/` |

测试（本机实跑）：`tests/operational-soak/*.case.mjs` + `{recovery,channel,selected,procguard,delivery}` → **41/41**（preflight 9、machinecheck 5、soak 6、hardening 4、recovery 3、channel 3、selected 旧3+current 3、procguard 旧2+guard2 2、delivery 1）。

## H1–H4：current source

| 角色 | 实际选中 | 说明 |
| --- | --- | --- |
| I | commit `861c03edf9e77c5c250fab59a02103ebb93e56c3`（branch `codex/g5-coordinator-channel`） | 当前 worktree 含未提交编辑；H 只从该 commit `git archive` 物化 attach-channel+contracts 到本次新根，物化字节复验后才 import |
| B | commit `1930278ca56e9b82a638907af87c2727b63105f7`（branch `codex/g1-runtime`） | B 已 import 同一 current I attach-channel blobs；H 物化 `apps/runner/src` + 所需 packages src，运行实际 `serveRunner` |
| main | H `5a4aea9f…` 的 `coordinator-channel.ts` blob | 共享 schema |

错误 root（另一 owner 分支）、无效 commit 在 consumer 前 REFUSED；consumer 后重核 selected commit/blobs/物化字节。默认不再硬 pin 旧 089/d95/cb4；docs-only HEAD 前进不影响已选 commit 的有效性。

**current I 12/12**：fact/ack-failed/payload/allow/deny、fresh-intent 修复（同一 business command.id 两次 intent 使用不同 frame.id；旧 allowed 不再 resolve 新 intent）、queue namespace（fact 与 payload 同字面 id 不串）、timeout settlement prune、CAS/generation、old lease、capacity、close。`freshIntentFixed=true`，旧 I defect 在本 commit 上关闭。

**current B 6/6（含一个finding）**：实际 B `serveRunner` 三回调、duplicate receipt/ack-failed、payload、external allow/deny 全通过；**sink-only native hook 仍在 `externalGuardCalls=0` 下自动允许**（`B29-SINK-ONLY-NATIVE-HOOK-AUTOBYPASS`），未改 B，原 owner 需接 main/Broker fresh guard。B ordinary normal 交付不是恢复。

材料：`selected-current/report.json` sha256 `87542eaf…`；`source.json` `d4ca7a06…`；`i.json` `c3082b79…`；`b.json` `9d35f692…`；`materialized.json` `1efc6135…`。

## H5–H8：registered birth / exact args / UNKNOWN

`procguard-v2/report.json`（sha256 `1d6f6dc0…`）：

- 出生同时绑定 spawn args、child 自己写出的 `process.argv/pid/ppid/uid/cwd` 与 OS start/uid；root/config/operation 与 spawn 精确值一致，**不是 prefix/includes**；
- 纯控制先于任何 live：plain record（无注册 handle）→ `not_registered`；missing birth/argv、prefix root/operation、foreign uid、recycled start、sibling pid 全部拒绝；ps unknown 观察 → `unknown_observation` 且零信号；
- `waitGone` 只在 owned child exit 或明确 ps not-found 时为 gone；ps 权限/解析失败保持 UNKNOWN，不返回 gone；
- live 只对本次注册 probe：正常 TERM、忽略 TERM 后 **fresh 再核** KILL、sibling 自身 TERM、UNKNOWN 观察后正常 TERM；own signals 5，foreign 0。
- 旧 wave28 guard 材料保留；B 旧 unsafe 脚本仍未采用新 helper，不运行。

## H9–H16：原数据与 ACK 窗口

原 controlled ProductRuntime/Broker/A Store/Verifier 当前路径：

- normal question/answer `native_applied` → `currentCandidate` gen3 → manual `accept_candidate` → `delivered` 4 artifacts；`WorkView.work.id` 正确；
- 错误 candidate generation → `rejected`（`verification_failed`）；
- answer 同 commandId 重放同一 receipt；冲突 version 拒绝；
- **begin 同 commandId 重放**同一 receipt、同一 Work、`workCount=1`；
- accept 同 commandId 重放同一 receipt；
- 真实 B/I 通道重绑后的原 Work/answer/SIGKILL 与 recovered candidate/accept：**NOT_REACHED**，未用 JSON 合成 A 结果。

材料：`delivery/report.json` `393449a1…`、`delivery.json` `930b09d3…`。

## H17–H18：candidate/accept 与 slot

current normal 已如上；2/4 controlled works 全部 delivered、`view.work.id` 匹配、begin 帧 2/4、queue 0、resource quiescent。fixture 无 slot-cap 配置，attemptId 在 receipt 投影不可得（null/unknown）；native 2/4 slot 资源集 **NOT_REACHED**。

## H19：精确包

1fbaf94 包：tar `daee1a94…`，6826 regular + 23 links = 6849，closure `c2920614…`；build `2d94a7c31ef97b57`，source `1fbaf940…`，schema 18。预检 32 PASS/1 UNKNOWN/0 FAIL；machinecheck 46 PASS/3 UNKNOWN/0 FAIL；包命令实际执行，新根无 state 写入。材料 `package-1fbaf94/…`（preflight `66a2c765…`，machinecheck `bb7fdbad…`）。只读输入，不是 E installed/release。

## H22：保留的短观察

wave28 的 20 秒 slow 原始材料保留（39 poll timeout、50 SSE 事件、0 socket）；本轮新增的是 source/guard consumer，不是 HTTP 场景，未重复 40 分钟。真实产品 readonly/SSE 目标 **NOT_REACHED**。

## 明确未达

- 同 Runner 双 client 经 B 实际 route、SIGKILL 原 Work/question 恢复、recovered candidate/accept：**NOT_REACHED**；
- B sink-only guard 缺 main/Broker fresh guard，仍自动允许；需 B/main 实现，H 未改；
- native 2/4 slot 资源集、真实 vendor/native、真实产品 readonly/SSE：未测；
- 旧 wave28 selected d95/cb4 结论仅保留历史时间范围，不贴 current。

## 给 B / I / main / F / G / E

- **B**：`b.json` 是 current `serveRunner` 三回调/sink-only finding；guard 必须在写前接 main/Broker fresh 决策，不能用 sink 自批。
- **I**：`i.json` 是 current module 12 项；fresh intent/namespace/prune 已过，可作回归向量。
- **main**：current source 绑定/物化/错误 root-commit 拒绝可直接复用；WorkView 用 `view.work.id`。
- **F/G**：fixture/controlled layer 明确；错误仍是 `REFUSED <code>`；无产品指标。
- **E**：raw 文件 sha256 可核；H verdict 不是 required/release。

## 限制

- 进程内/自有 fixture，模块与 B service 物化为证据；无 daemon、用户 state/credential/profile、真实 CLI/model/native；无产品 SIGKILL；
- 物化是只读证据/导入，不是第二实现/coordinator/ledger/gate；
- 旧 data/profile/tar/ledger 与 12 实例未触碰。
