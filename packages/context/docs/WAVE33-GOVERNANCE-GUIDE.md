# W33 决定治理、当前快照与失效重开手册

范围：C owned packages（context/proposals/knowledge/routing）。本文件描述已交 source 的真实接口，
不代表 main 的 App/UI 已默认集成，也不代表已安装或 native 已准入。

## 1. 安全草稿（session CLI）
`packages/context/tools/assistant-context-cli.mjs draft save|load --file <abs>`

- 创建：仅在不存在的路径上以 0600 生成，同目录临时文件 + fsync + rename 原子替换。
- 更新：仅接受已存在的普通文件、属主为当前用户、mode 恰为 0600；symlink、公开文件、foreign owner、
  非普通文件、0 字节或 >64KiB 一律拒绝（exit 3，不写目标）。
- 读取：lstat 校验（NOFOLLOW 语义）、协议 `assistant-context-draft/1`、project/conversation/selection
  形状、requestId、observedAt/expiresAt 合法 ISO、sourceDigest 64hex；invalid/missing expiry 不接受为
  usable；过期返回 `usable:false, stale:true`（仍只是数据）。
- 草稿不是 prepare/send/confirm token；重开后必须重新 preview。

## 2. 正式治理接口
- `DecisionGovernance.record/revoke/page/listEffectiveWindow/isEffective/getEffective/decisionSourceState`
  （`packages/knowledge/src/governance.ts`）。`getEffective` 返回当前有效且来源 current 的单条记录。
- 撤销/替代/过期/来源 stale 只改变“未来是否可选”，不改写历史正文和原 receipt。
- `scan_incomplete`、caller 限额与 source 冲突原样抛出，不合成完整空集合。

## 3. 新工作可消费的当前决定快照
`packages/knowledge/src/decision-snapshot.ts`

- `captureDecisionSnapshot(governance, { projectId, selectedDecisionIds?, max?, now? })`
  → `decision-context-snapshot/1`：projectId、capturedAt、`authorization:'none'`、
  每项 `{decisionId, version, contentDigest, scope, sourceMessageId, sourceTextDigest, recordedAt, expiresAt?}`、
  `coverage:{scan:'complete', callerTruncated, max}`。
- 选择必须落在当前有效集合内，否则 `not_found`；扫描不完整抛 `scan_incomplete`。
- `revalidateDecisionSnapshot(governance, snapshot, { projectId?, now? })`
  → `{valid, code, decisions[]}`，code 含 `invalid_snapshot|project_mismatch|version_changed|content_changed|
  inactive|source_stale|expired`。创建新工作前必须重验；快照只是数据，不是审批或完整性证明。
- main 原 `ProductContextPreview`/`DecisionContextProvider` 仍是 HTTP/表单授权入口；快照与它们读取同一
  A/Store 事实。新 Work 的冻结上下文仍由 main 的 prepare/send 生成。

## 4. 日常与重开
- session CLI：`preview → candidates → propose → send → sources → decide record|revoke → observe/status`。
- `sources` 在重开后返回同一 `bundleDigest`；撤销后新 `preview --select decisions` 不再包含该决定，
  已冻结上下文不变。
- readonly 实例可读 `sources`，但 preview/send/decide 拒绝（exit 3）。
- 两个项目/会话隔离；跨项目 preview 拒绝；重复 propose 被原产品拒绝。

## 5. 未达
- main App/UI 默认集成、安装包、native/真实厂商、CAC、多协议与长期运行未测。
- 自动真实 model/native 0；B cap4 UNKNOWN 不可花，E pilot BLOCKED 未重置。
