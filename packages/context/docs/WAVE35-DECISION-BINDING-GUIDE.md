# W35 决定选择 → 原工作绑定 → 治理重开手册

范围：C owned packages。source/controlled 已验；main App/UI 默认接线、安装、native/value 未验。

## 1. 选择不再被项目窗口误判
`captureDecisionSnapshot(governance, {projectId, selectedDecisionIds?, max?, now?})`

- 无选择：按项目窗口读取，`coverage.mode:'window'`、`scan:'complete'`、`callerTruncated` 标记是否被 max 截断。
- 有选择：逐条 `governance.getEffective(id)` 读取**当前可信记录**，再按选择收窄；
  `coverage.mode:'selected'`、`scan:'selected_ids'`、`callerTruncated:false`。
  仍在当前有效、但位于项目前 32 条之外的 ID **不会**被误报 `not_found`。
- 选择数 > max 或 >200 → `invalid_scope`；重复 ID → `conflict`；真正无效/跨项目 → `not_found`。
- 深不可变（scope/数组/每项 frozen）、严格协议/时间/字段校验与完整 scope/source/version 绑定保持。

## 2. 在原 create 事务内绑定决定
`bindDecisionSelection(governance, preparation, {projectId, projectScope?, now?})`
→ `decision-selection-binding/1`：projectId/boundAt/`authorization:'none'`/snapshotDigest/每项
`{decisionId,version,contentDigest,scope,sourceMessageId,sourceTextDigest,recordedAt}`。

`assertDecisionSelectionBindingCurrentSync(binding, reader, {projectId, projectScope?, now?})`
- 无 await，可在 main 现有 UnitOfWork 的 `atomic(() => { guard; commitPrepared(prepared) })` 内调用。
- 同步核对：记录存在、status/revokedAt、version、contentDigest、完整 scope、sourceMessageId/
  sourceTextDigest（含同步 source lookup）、recordedAt、expiry；返回 `current/code`。
- 数据有效不是授权；main 仍负责原表单/委托 schema/contract/criteria/写前 guard 与持久化这些引用。

## 3. 重验与普通治理
- `assertDecisionSelectionCurrent`（async）用于预览/确认前后；撤销/替代/来源/Scope/expiry 变化
  必须显式重新预览，不能静默替换。
- 原 create 用户链：prepareCommand → 绑定 →（事务内 sync guard）→ commitPrepared；
  撤销后同一 binding 在 guard 处失败，不创建 Work。
- session CLI：preview → candidates → propose → send → sources → decide record/supersede/revoke
  → draft save/load --revalidate → observe/status；草稿仍只是可再预览数据。

## 4. 未达
- main 未把 binding refs 持久化进 Work/contract，也未在默认 App/HTTP 表单调用 sync guard；
  W35 的“进入 main 实际集成版本”仍需 main 接线（typed port/DTO 已交）。
- 安装包/native/真实厂商/recovery 活动层/长期 soak/value 未验；自动真实 model/native 0。
