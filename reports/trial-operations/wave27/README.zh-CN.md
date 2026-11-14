# H wave-27：合法三 consumer、实际 bridge 回调与恢复支援

2026-11-14，`codex/g4-trial-operations`，合并 `origin/main ca01e17`（main 实源 `967dc0c`）。本目录是 wave-27 原始材料；wave-25/26 的 301/601、60/30 秒样本、392/24 次预期断流与旧 27/27 原样保留，不因本轮重跑或改绿。

H 不是 grant/release 权威；E 独立 required，I/B 自己实现与修复。

## 五个结果

| 结果 | 内容 | 位置 |
| --- | --- | --- |
| H4 | 合法三类 frames + 实际 fact/payload/write 回调 | `tests/operational-soak/channel/`、本目录 `channel-input/` |
| H8 | receipt/unknown、payload、guard 正反与 I/B adapter 契约场景 | `frames.json`、`consumer-allow/deny.json` |
| H12 | 同 Runner/双 client/SIGKILL 的诚实范围与可复用故障输入 | 本文件 + `tests/operational-soak/recovery/` |
| H16 | 新风险短时 HTTP/SSE 观察与去敏材料 | 本目录 `runs/` |
| H20 | 20 阶段状态、原始索引与同事交接 | `../wave27-status.json`、`docs/internal-trial/` |

测试（本机实跑）：`node --test tests/operational-soak/*.case.mjs tests/operational-soak/recovery/*.case.mjs tests/operational-soak/channel/*.case.mjs` → **30/30**（preflight 9、machinecheck 5、soak 6、hardening 4、recovery 3、channel 3）。

## H4/H8：合法 frames 与真实回调

`channel-input/frames.json`：

- 共享 `CoordinatorChannel` 3 类合法请求（fact / payload-read / native-write-intent）与 4 类合法回复（receipt / ack-failed / payload / write-admission），producer 为完整 attempt tuple + runnerIdentityRef/source；
- 9 个请求负例（错 source/attempt/correlation/v2/缺 id/额外字段/begin 假冒/foreign producer 等）与 5 个回复负例全部由共享 schema 拒绝，`sends=0`、`executes=0`；
- generation 0→1→2、CAS 冲突、旧 lease 回复/关闭、late/timeout/closed/capacity/indeterminate 记为契约场景。

`channel-input/consumer-allow.json`（真实 B `serveRunner` stdio bridge v1，确定性 fixture driver）：

- fact：3 个 `fact` 帧；2 个同 factId 复用同一 A durable receipt（`seq` 相同）；1 个 `ack-failed` 被 driver 捕获；
- payload：真实 `payload-read` 帧与回复，显式读取成功 1 次（另有 3 次 spool 读取同链路）；
- write guard：1 个 `native-write-intent`，allow 后 `admittedWrite=true`；
- deny：同一链路回 `write-admission=false`，`admittedWrite=false`、理由为拒绝；
- `modelCalls=0`、`vendorTurns=0`、`signalsSent=0`，进程内无 daemon/SIGKILL。

材料哈希：

| 文件 | sha256 |
| --- | --- |
| `channel-input/report.json` | `5a5becb23ed11cdac8586546b97918bb2af87a2307ce7f82e9aa5f474fe212be` |
| `channel-input/frames.json` | `2f4b2a84380d4c0dd83cf13ff241c13416f2b609172af0091a08f4dbdc498896` |
| `channel-input/consumer-allow.json` | `e402d2560757755a906027c543fba3da8ab9de861d7ea10afd28a1d0a3c657c4` |
| `channel-input/consumer-deny.json` | `f355fa4a1aa16406295c56a82bfd2c33b9c96193072c64dcc56e4b976290f971` |

## H12：同 Runner / SIGKILL 的诚实范围

以下未执行、未模拟、未声称通过，也没有创建第二 coordinator/ledger/gate：

- `CoordinatorChannel`/attach-channel 实际模块（I 子树在本 checkout 不存在）；
- generation/CAS 实际绑定、旧 lease 隔离、late reply、close race、capacity 强制执行；
- 同 Runner 双 client 重绑、clientA 断开/clientB 接原 child；
- SIGKILL 后原 question/answer/target/attempt 恢复、原 Work 人工接受、2/4 资源。

已有可复用输入保留：`tests/operational-soak/recovery/` 的原 ProductRuntime/Broker/A Store normal（Work/attempt/question/answer/native_applied）、5 条合法 journal、7 个 journal 负例、已准入 inspect/cancel port 的 5 个故障；`channel-input/` 的三类 frames 与 actual callback 计数。B/I 实现模块后可直接把这两组材料作为正控/负控。

## H13/H14：新风险短时观察

只新增一个 30 秒 fixture 场景（HTTP 500 + SSE 500），不重跑 40 分钟：

- 实际 30.005 s，`COMPLETED_WITH_OBSERVED_DEFECT`；readiness 62 次全部 500；SSE 149 次连接均 `http_status` 断开；0 事件；211 次预期失败；socket/连接归还 0；
- `trial-verify-run` 复核 `CONSISTENT`（31 样本，last 30004 ms，hash 匹配）；
- 材料：`runs/20261114T172938-30s-mixed-server-error/run.json` sha256 `6a4be7f4b9520294be16cd0c8bdc28db041806a72d68a59430809fe6a2d68220`；check sha256 `f487041f5c4e57344eb2ad821eafa6262bf5e41b9c52d422ec14bc862212d8bd`。

**真实产品 readonly/SSE 观察：NOT_REACHED。** 本轮没有显式提供且独立证明自有的 product 地址/token/root/包 tuple；H 不启动/停止/迁移，也不借用户十二服务或凭据补样。

## 给 I/B/F/G/E

- **I/B**：`frames.json` 是共享 schema 的合法帧与拒绝边界；`consumer-*.json` 是 actual 回调计数。I 实现 attach-channel 后，用 generation/CAS/late/close/capacity 场景做正反；B 可用同一帧做统一 dispatch/receipt ACK/payload/guard 对照。H 未改 I/B 源码，也不创建替代实现。
- **F**：错误仍是 `REFUSED <code>: <message>`；用户流程见 `docs/internal-trial/README.zh-CN.md`，不要求理解 generation/lease。
- **G**：`report.json`/`run.json` 标注 layer=fixture、coverage=fixture-only；不包含产品指标或收益结论。
- **E**：原始文件按 sha256 可核；H 的 `OK`/`CONSISTENT`/计数不是 required 或 release 凭证。

## 限制

- stdio bridge v1 与同进程 fixture；不是 attach-channel、daemon、业务恢复或 48 h soak；
- receipt/payload/guard 观察不授予执行/恢复权限；unknown 保持 unknown；
- 无模型/vendor/native/CLI/profile/credential，无 SIGKILL、无全局发现、无十二服务参与；
- 运行字节未变不要求 D 重冻；H 不签准入。
