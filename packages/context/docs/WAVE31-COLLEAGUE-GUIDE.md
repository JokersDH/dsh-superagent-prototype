# 同事使用指南：W31 普通流、历史审阅与恢复

适用：内部试用同事（单机 darwin/arm64 · Node 24.21 · SQLite ABI 137）。

## 普通使用（当前 R2 包）
1. `pa first-run --json --install <app> --config-root/--cache-root/--logs-root/--workspace-root …`
2. `pa start … --state <state>`；打开 console，选择已登记项目。
3. 模板/建议只是预填：确认 scope、profile，点击预览→应用→编辑 goal→明确创建；
   preview 不建 Work，不改配置，不授执行权。
4. 问题需要明确回答；机器检查失败时不会出现可接受候选，接受会被 `verification_failed` 拒绝；
   修正后用**新 Work**，旧失败 Work 保留审计。
5. 观察面板按项目/窗口显示 7/30 天；导出 JSON 是 display export（`numericValues:false`），
   不是成本/效率结论。

## 历史与来源审阅（C consumer）
- 工具：`node --experimental-strip-types packages/context/tools/wave31-completion-history.mjs
  --a-worktree <A> --db <state.sqlite> --work <id> --project <id> [--limit N --offset N]`
- 看 `coverage.reviews.state`：`complete` 才是完整；`truncated_source` 表示 A per-ticket 50 上限，
  不能靠翻页补齐；`truncated_local` 用 `window.nextOffset` 继续。
- `currentLink`/`currentEligibility` 是数据链接；当前是否可接受以 ProductCompletion/应用为准。
- 来源：`GET /v1/messages/:id/context`、`/context/sources`、`/v1/works/:id/evidence(/history)`。
- 撤销/替代决定后，frozen 原文保持不变；当前预览不再包含撤销决定。

## 恢复（readonly）
- 恢复根由 A 正式 snapshot/restore 生成；用 driver（`personal-review-driver/2`，package dialect）
  消费同一 manifest/target proof 后启动；readiness 应为 `authorization:none / recovery_readonly /
  readonly / dispatchable 0`。
- Stop 后 `pa status --state <state>` 应为 `STOPPED`；业务写/chat/candidate 422，provider 不增。
- 目标端合法但额外的消息/事件/artifact 会导致 `target_subject_mismatch`；不要用 fixture 绕过。
- 错误 target digest、缺 manifest 等会失败退出并保留 manifest/log；不会留下未登记的运行实例。

## 未知与支持
- dispatch `indeterminate` 保持未知并拒绝重发；同 commandId+body 可重试，改 body 报
  “another immutable request”。
- unknown/partial 不转零；导出/观察中的 unknownCount/coverage 原样显示。
- 未达：live B/I 恢复、private/target/native、长期 soak、F UI/E release。
