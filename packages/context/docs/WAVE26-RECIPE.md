# 第二十六轮 Agent C：真实恢复内容 proof、当前产品包与有界交付

2026-11-14，基线 merge `4f8e2cd`（`origin/main` `6787bd0`，main F App `a302ddc`；RFC 0066/0067）。
C 仅改 context/proposals/knowledge/routing；真实 vendor model/native 0；未改 UI/HTTP/SQL/root lock/E 断言。
wave25 的完整 PID/API start gate、同次 A manifest 调用、精确 0ede 包 v1/v2 双 restore 与 STOPPED 正向保留。

## 1. 真实恢复内容 proof（C2/C3/C4）

新增 `packages/context/tools/wave26-target-proof.mjs`，在 driver manifest 模式启动 consumer **之前**执行：

1. 用 A 源码/A storage 在 target DB 上重建 manifest（expectation 只把 `dataRoot` 换为目标根）；
2. 比原 manifest 的 protocol/sourceSha/snapshotFormat/ticket/assignment/attempt/epoch/contract、
   question/answer/deliveries/commands/dispatch/observations/requirements/coverage/limits/counts；
3. 逐 family 比较 logical source：
   - **允许** 只有 `subject.dataRoot` 与运行期操作 family `event_log`、`coordinator_instances`、`writer_claim`
     的变化（只读服务启动/审计/写者声明）；
   - 任何业务 family（如 `conversation_messages`、`works`、`answers`）变化 → 拒绝；
4. 比 artifact 集合与每个 target artifact 文件的实际 SHA-256/bytes（不仅 DB 元数据），替换字节被拒绝；
5. restore report 若存在必须是 `personal-restore/1`；report 只是元数据，不代替内容 proof。

输出 `wave26-target-subject-proof/1`：`subjectMatches`、`fingerprintMatches`、
`fingerprintRelation`（exact / allowed-operational-delta / forbidden-delta）、allowed/forbidden family 变化、
artifact 统计与 mismatches。driver 要求 `status:ok && subjectMatches:true` 才继续；否则
`target_subject_mismatch`，不启动 consumer。

实测正例：两次 bundle restore 的 v1/v2 目标在首次启动前 fingerprint 精确相等；服务启动后只出现允许 family
delta，业务字段与 artifacts 仍匹配。反例：目标新增一条合法 user message、同长度替换冻结 artifact 字节，
都在 HTTP 前失败。

## 2. 当前产品包（C9/C10/C12）

精确包 `/Users/hh/Desktop/joker/pa-artifacts/wave25-target/wave25-target-a826b5e.tar.gz`
（SHA `d3e79749426c796085895abc73d76c4b26cd48427d8e6f748155bec00a103f3c`，source `a826b5e…`，
build `fefd932…`，schema18/Node24.21/ABI137）：

- 同次 manifest + target proof + 完整 identity，对 v1/v2 两个真实 restore 根分别 prepare/start/read/stop；
- HTTP 原 Work/question/answer/delivery、SDK 候选、frozen 来源与目标 proof 对回；业务 422；
- `GET /v1/readiness` 真实返回：`authorization:none`、`startupMode:recovery_readonly`、
  `development:readonly`、`execution.unavailable`、`dispatchable:0`、admitted native/controlled 0、
  decisions/proposals false；readiness 只展示配置事实，不是 native/执行授权；
- package 早于 main `a302ddc` 的 F App 集成：**F TrialWorkspace 未包含**，旧 4b 来源 UI 字节只在包内；
  C 不把 F App 或 installed 结论贴到该包。

## 3. 同包正负与故障（C7/C11/C13）

保留 0ede 与 a826 的同包双格式正向；新增/保留独立失效：

| 类别 | 结果 |
| --- | --- |
| target-only 合法 user message | `target_subject_mismatch`（业务 family 变化） |
| 同长度 artifact 字节替换 | `target_subject_mismatch`（artifact SHA） |
| 窄 Scope/新增排除 | `scope_changed`、正文空、candidate 不可读、业务 422 |
| 原 context/confirm token 重放 | 422 |
| 同文件 reuse | REUSED，原 pid/start 保持，不停止 |
| 不同/缺 selection、不同根 | 入口拒绝，原实例不动 |
| owned stop 失败/unknown | failed/非零，保留 review/state/cleanup materials |
| prepare/identity/manifest/start/HTTP/status/stop | 同一总 deadline + cleanupReserve；超时阶段化错误 |

故障单元仍覆盖 silent peer、半 JSON、入口早退、readiness 超时、SIGTERM 无响应升级与 bounded logs。
本机 Node/undici `setTypeOfService EINVAL` 仅在测试子进程用
`NODE_OPTIONS=--no-network-family-autoselection` 规避，不是产品稳定性结论。

## 4. 工具 API 与输出（C14）

`personal-review-driver/2` 新增：

```
--a-worktree --a-module --manifest-db --manifest-expectation --manifest-output --root-map
--replay-context-token --replay-confirm-token --expect-readiness present|absent|any
```

manifest 必填、coverage 必须 complete、root-map 必须 `<original>=<target>`，target 必须通过内容 proof；
输出 `data.manifest`（IDs/counts/fingerprint/coverage/roots）、`data.targetProof`（subjectMatches/family deltas/
artifact 统计）、`data.readiness`、`data.replay`。status/退出码保持：

verified-flow/reused/refused-verified/observed → 0；NOT_REACHED → 4；failed → 1，usage → 2。
observed 永不验收；`packageSubject` 回显不是 installed 授权。

## 5. UI/消费者交接（C15）

`wave26-ui-input.json` 更新四来源状态、七 reason、partial/withheld、真实 readiness 样本与 target proof 语义。
main 已实现来源诊断 UI 与 FTrialWorkspace 四动作；F 只消费数据，C 不改 console。D/E 用 tar/source/build/
schema/entries hash 独立复现；G 未默认接入，任何观察数据不成为质量/执行权。

## 6. 分层与限制

- source、精确 0ede、a826 当前包、installed：分开；installed 仍由 E 独立绑定。
- normal/recovered：只读 snapshot restore；B 业务 attach、private permission、target、native 未测。
- F App 不在 a826 包内（NOT_REACHED）；长期撤权、并发 writer、48h soak 未测。
- 十二服务/state/profile/tar/ledger 与 lock 差异保持；只信号本轮证明出生的精确资源。
