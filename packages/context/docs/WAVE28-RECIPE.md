# 第二十八轮 Agent C：当前 proof consumer 与完整产品数据链

2026-11-15，基线 merge `0a093c1`（`origin/main` `ea82d8f`；RFC 0071/0072）。
C 仅改 context/proposals/knowledge/routing；真实 vendor model/native 0；未改 UI/HTTP/SQL/root lock/E 断言。
wave27 的 event_log 豁免移除、A content/2 proof、ce64 双格式与合法 message/artifact drift 拒绝保留。

## 1. 当前 proof consumer（C2–C4）

driver 的 manifest 模式只接受显式输入，不内置 A/C checkout 默认路径：

```
--a-worktree --a-module --manifest-db --manifest-expectation --root-map
--target-protocol --target-snapshot-digest --target-content-digest [--target-artifacts] [--target-source-root]
```

它调用 A `restoreWorkflowSnapshot`/`verifyRestoredSnapshot`/`workflow-content/2`，要求
`basis=independent` 与 `artifactCoverage=independent`；允许差异仅 `subject.dataRoot`。
`wave28-proof-consumer.json` 记录真实 contract。当前 main/A workspace 尚未把该 proof 模块导出为产品包，
这条公共打包集成分层标 **NOT_REACHED**；tests 使用显式 A worktree，未把用户工作树写成产品默认，也没有
复制 SQL/清单/FTS/事件 policy 或新建确认 authority。

## 2. 原 producer → consumer 与双格式（C5–C8）

同一真实 Store 的 Work/Broker/SDK/候选/确认/context 数据保持；default v1 与 explicit v2 各自
A restore 到新根，report 绑定独立 snapshot/content/artifact；driver 同一次执行以 manifest IDs 读取
HTTP Work/question/answer/delivery，业务 422、held queue 不消费、provider 不增。
原完成事实复用既有 `ProductCompletion`：`main-personal-completion-consumer.case.ts` 从恢复根读取
verificationId/readyAt/eventCursor/artifactDigest 与原 chain 一致、Work delivered；不存在 candidates 表，
也没有新表/平行 ledger/手写 acceptance（acceptanceRef 在 reader 中可为 null，但 Work/Completion 状态由原 gate 证明）。

## 3. 当前产品包（C9–C12）

精确 `1cdab25` 包（tar `dcfda014…`、build `ecffaa6d…`、schema18/Node24.21/ABI137）：
v1/v2 A restore + 同 manifest target proof + package prepare/start/read/stop；
readiness 实测 `authorization:none`、`recovery_readonly`、`development:readonly`、dispatchable/admitted 0、
decisions/proposals false。ce64/0ede 旧范围保留，不贴到新字节；F UI/E release 由其 owner 判定。

## 4. B/I 原事实与完成（C13–C16）

恢复事实 consumer 复用原 ProductCompletion/Work，不造候选表。B/I live callback 未准入 →
**NOT_REACHED**；data-only/普通读取成功不能冒充 live native recovery。源级与包级成功不授
B/private/target/native。

## 5. 故障、身份、容量（C17–C20）

全阶段 budget（prepare/identity/manifest/proof/start/HTTP/status/stop）+ cleanupReserve；
silent peer、半 JSON、早退、readiness 超时、SIGTERM 无响应、stop 失败降级保留；完整 PID/start/API/root/
config/operation/review 与合法 reuse/keep/unknown 材料保持。输出/日志/manifest/artifact bytes 有上限。

## 6. 工具与交接（C21–C24）

`personal-review-driver/2` 支持 source/package、显式 package/data/proof 与 target args；输出区分
verified-flow/reused/refused-verified/observed/NOT_REACHED/failed 与 exit。旧 source 范围兼容；
共享 contract 变更仍需 main；C 不改 J/G/H/I/F 路径。

未测：长期撤权、并发 writer、48h soak、B/I live recovery、private/target/native；
十二服务/state/tar/ledger 与 lock 差异保持；只信号本轮证明出生资源。
