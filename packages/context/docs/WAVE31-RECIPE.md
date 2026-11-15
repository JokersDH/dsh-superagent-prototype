# 第三十一轮 Agent C：可靠历史、完整普通流与准确 RC/R2 恢复

2026-11-15，基线合并 `50f8d5d2`（`origin/main` `8deda18d`；RFC 0080/0081/0082）。
C 仅改 context/proposals/knowledge/routing；真实 vendor model/native 0；未改 UI/HTTP/SQL/root lock/E 断言。
wave30 的 1fba 双恢复、模板流、严格 facts 保留原 scope；`829RC` 冻结字节/verdict 不变。

## 包一：可靠历史与来源审计（C1–C4）

新 consumer `packages/context/tools/wave31-completion-history.mjs`：

- 组合 A 的 per-ticket 覆盖（`completion.coverage.{reviews,verifications,acceptances}`、
  `limits.perTicket:50`）与本地 `--limit/--offset`；`state` 为
  `complete|truncated_local|truncated_source`，只有 A 完整且本地未截断才叫 complete。
- `availableKnown` 仅当源完整为 true；源截断时 `available:null`，paging 不能把截断变完整；
  unclassified 继承 verification 源覆盖；`--limit 0` 不再被当作完整空历史。
- 多 attempt：A 按 `runtime_bindings.attempt_id` 解析历史 binding；旧 review 保留 canonical，
  `currentLink:historical_attempt` 与 `currentEligibility:historical_only`，当前资格仍归 ProductCompletion。
- 实测：51 条额外 verification 触发源截断（返回 50、`truncated_source`），本地 limit 小于完整源为
  `truncated_local` 并给 nextOffset；跨页无丢/重复；foreign project `missing` exit 1。
- 集成 browse（`main-personal-history-browse-flow`）：history/evidence/evidence-history/frozen
  context/sources/decision revoke 都指向同一原始事实；撤销后 frozen bytes 不变、history 不变。

## 包二：两项目日常普通流（C5–C8）

- `main-personal-template-lifecycle`：preview 取消不建 Work；编辑 goal 后仍走原 create_work；
  检查引用是登记 check 而非 package 脚本文本；配置 revision 变化使旧 preview 失效；跨项目 400。
- `main-personal-check-retry`：项目 A 真实问题/回答/native_applied/接受；项目 B 失败检查的
  accept 返回 `rejected/verification_failed`，不产生 acceptance；修正后的新 Work 有独立身份和接受。
- `main-personal-audit-observation`：frozen context/sources/evidence 原样可审；7/30 天
  `/v1/insights` 与 `/v1/insights/export`（`usage-observation-download/1`、display-only
  `numericValues:false`、sha256 自校验、无 root/token）；过期 Scope 的 context preview 拒绝且不建 Work。
- `main-personal-two-project-reopen`：同一 Store 重开后两项目 works/conversations/evidence/facts
  保留；preview 只读；同 commandId 改 body 被拒（另一 immutable request），不替换原 Work。

## 包三：RC 与 R2 恢复（C9–C11）

- `829RC`：tar `04926739…`、source `82ee5b8f…`、build `8296720d8a25f38c`（不可变）。
- R2：tar `405ecd02…`、source `c0a1f897…`（含 `303b2c6a` 为祖先的 merge）、build
  `4dcd28f758bbb265`；schema18/Node24.21/ABI137；含 project-recipes、usage-observation、
  usage-insights，console bundle 含 `/v1/insights` 读取；entrypoints 无私有路径。
- `main-personal-package-r2-dual`：同一原 Store v1/v2 分别 A restore 到两个新根，同 manifest/
  target proof 后包内 prepare/start/readiness/HTTP/STOPPED；readonly 422；target-only 合法消息
  漂移独立 `target_subject_mismatch` 拒绝（fresh restore 后只追加一条消息）。
- `main-personal-package-faults`：错误 target snapshot digest 在有界时间内 failed/exit1，
  包实例 STOPPED，manifest/log 材料保留，无模型调用。
- E verdict 仍 ce64；R1/R2 与旧 1fba/1ba 分层，未互相贴结果；live B/I 与 private/target/native
  NOT_REACHED（C 不造 coordinator/ledger）。

## 命令与证据

- context 129 / proposals 41 / knowledge 133 / routing 44 = 347 PASS（knowledge `--test-concurrency=1`）。
- 四包 strict tsc、`pnpm -r build` 通过；TAP 见 `packages/context/reports/wave31-*.tap`。
- 未测：长期撤权、并发 writer、48h soak、live B/I、private/target/native、F UI、E release。
- 十二服务/state/tar/ledger 与 lock 差异保持；只信号本轮证明出生资源。
