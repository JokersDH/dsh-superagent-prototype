# W34 当前决定 → 原工作确认与治理重开手册

范围：C owned packages（context/proposals/knowledge/routing）。source/controlled 已验；
main App/UI/HTTP 接线、安装包、native 未验。

## 1. 可信快照 `decision-context-snapshot/1`
`packages/knowledge/src/decision-snapshot.ts`

- `captureDecisionSnapshot(governance, {projectId, selectedDecisionIds?, max?, now?})`
  - 严格输入：projectId 形状、max 为 1..200 整数、now 合法 Date、选择 ID 合法且唯一。
  - 输出嵌套 deep-freeze（scope、数组、每项）；`authorization:'none'`；coverage `scan:'complete'`。
- `revalidateDecisionSnapshot(governance, snapshot, {projectId?, now?})`
  - 先严格解析：协议/authorization/顶层键/decisions ≤200/唯一 ID/scope 严格形状/sourceMessageId/
    digest/recordedAt/expiresAt/capturedAt/coverage，任何畸形 → `invalid_snapshot`。
  - 完整绑定当前可信记录：version、contentDigest、scope（allowedPaths/excludedPaths/externalActions/
    expiresAt，排序比较）、sourceMessageId、sourceTextDigest、recordedAt；任一不符 → `content_changed`。
  - 撤销/替代 → `inactive`；来源变更 → `source_stale`；过期 → `expired`；`valid` 只是数据一致，不是授权。

## 2. 选择准备与原工作确认
`packages/knowledge/src/decision-preparation.ts`

- `prepareDecisionSelection(governance, {projectId, selectedDecisionIds?, projectScope?, max?, now?})`
  → `decision-selection-preparation/1`：snapshot + `scopeChecked/scopeMatch/mismatches`，`authorization:'none'`。
  Scope 沿原 atom 规则：allowedPaths ⊆ 项目、项目 exclusions ⊆ 决定、externalActions ⊆、expiry 未过。
- `assertDecisionSelectionCurrent(governance, preparation, {projectId?, projectScope?, now?})`
  → `{current, code, decisions}`；创建前/后各断言一次。scope 变化 → `scope_changed`，跨项目 → `project_mismatch`。
- 这不是确认 authority：main 的原 create_work/contract/criteria/写前 guard 仍是唯一入口；决定变化必须
  显式重新预览，不能静默替换用户已选字段或 active Work 的冻结上下文。

## 3. 普通治理与重开
- session CLI：preview → candidates → propose（confirm/reject）→ send → sources → decide record/supersede/revoke
  → draft save/load（`--revalidate`）→ observe/status。
- 草稿：0600/owner/regular/no-follow；`load --revalidate` 与当前 preview 比对 sourceDigest 集合，
  返回 `matchesCurrent/changedSources`；TTL 有效但来源变化时不称匹配。
- 撤销/替代后：未来 preview 不再包含，旧冻结 sources/bundleDigest 不变；旧 receipt 重放不复活。
- readonly：sources/draft 数据可读；preview/send/decide 拒绝（exit 3）。

## 4. 未达
- main 的 App/UI 默认集成、create 前 schema 接线、安装包、native/真实厂商、CAC、soak 未验。
- 自动真实 model/native 0；B cap4 UNKNOWN 不可花；E pilot 未动。
