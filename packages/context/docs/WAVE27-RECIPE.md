# 第二十七轮 Agent C：精确运营变换、A content proof 与 ce64 当前包

2026-11-14，基线 merge `b9b7340`（`origin/main` `ca01e17`，main channel `0068`；RFC 0069）。
C 仅改 context/proposals/knowledge/routing；真实 vendor model/native 0；未改 UI/HTTP/SQL/root lock/E 断言。
wave26 的完整身份、manifest 同次调用、合法消息/artifact drift 拒绝与 a826 双格式正向保留。

## 1. 去掉 event_log 整表豁免（C2/C3/C4）

wave26 target proof 曾允许整个 `event_log` family 变化；这会放过唯一追加的 `work.accepted` 业务事件。
本轮改为：

- 使用 A 官方 `restoreWorkflowSnapshot`（真实 workflow v1/v2 restore，写 `personal-restore/1` report，
  含 `workflow-content/2` digest/collections/artifact inventory）；
- 使用 A `verifyRestoredSnapshot(target, {sourceStateRoot, protocol, snapshotDigest, contentDigest, artifacts})`
  作为独立 basis；`basis` 与 `artifactCoverage` 必须都是 `independent`；
- target 允许的差异只有 `subject.dataRoot`；**没有 family 名称豁免**。A 的 content/2 仅省略其版本化声明的
  根本地 `coordinator_instances`/`writer_claim` 与真实 FTS shadow 表，不省略 `event_log`；
- 所以唯一追加的 `work.accepted` event、合法用户消息、被替换 artifact 字节都改变 content digest/artifact
  inventory，在 HTTP 前失败。

实测：v1/v2 两个 A restore 各自独立 report/content digest；正确启动/读取/停止后再次 proof 仍成功
（只读启动不改变 A 的内容证明）；business event、message、artifact 三个单变量 drift 各自
`target_subject_mismatch`。

## 2. 同包双格式与当前 ce64（C5–C12）

- 同一真实 Store 产出 default v1、explicit v2 快照；各自用 A restore 到独立新根；
- 每个根有独立 `--target-protocol/--target-snapshot-digest/--target-content-digest/--target-artifacts`；
- driver 同一次执行：A manifest → target proof（A verify 独立 basis）→ 完整 package identity →
  HTTP 原 Work/question/answer/delivery、候选、frozen 来源、readiness → 只读 422 → 精确 stop；
- 精确 `ce64fc1` 包（tar SHA `8c36aaeb…`，build `d4b1780d…`，schema18/Node24.21/ABI137）：
  v1/v2 双 A restore 均 verified-flow，readiness `authorization:none`、`recovery_readonly`、
  `development:readonly`、dispatchable/admitted 0、decisions/proposals false；
- a826 的旧正向仍保留；a826 不含 later F App，ce64 是否含 F UI 只按实际包/ E 独立结论记录，C 不声明 UI。

## 3. 故障、时限与工具 API（C13–C17）

- prepare/identity/manifest/target proof/start/HTTP/status/stop 共享总 deadline + cleanupReserve；
  silent peer、半 JSON、入口早退、readiness 超时、SIGTERM 无响应、stop 失败降级保留 bounded 控制；
- 内容/identity/事件三类拒绝相互独立：缺 PID/APIstart → identity；business event → content；
  原根/映射不匹配 → target；不以坏签名同时代表多个负例；
- 公开 driver：`personal-review-driver/2`，新增 target args；status/exit 语义不变
  （verified-flow/reused/refused-verified/observed=0，NOT_REACHED=4，failed=1，usage=2）；
- target proof 输出 `subjectMatches`、A verification basis/content/report、expected snapshot/content/artifacts；
  observed 永不验收，proof 不授执行/启动/发布。

## 4. UI/交接与限制（C18–C20）

- `wave27-ui-input.json` 更新四来源状态、七 reason、partial/withheld、ce64 readiness 与 target proof 语义；
  main/F 已有 UI 只消费数据，C 不改 App/transport/CSS。
- D/E 用 ce64/a826 tar、source、build、schema、entries hash 与 A restore/report/content digest 独立复现；
  installed/release 仍由 E 独立结论，C 工具 verified 不是发布。
- 未测：长期撤权、并发 writer、48h soak、B 业务 attach、private/target/native；G/H/I/J 输入按各自准入。
- 十二服务/state/profile/tar/ledger 与 lock 差异保持；只信号本轮证明出生的精确资源。
