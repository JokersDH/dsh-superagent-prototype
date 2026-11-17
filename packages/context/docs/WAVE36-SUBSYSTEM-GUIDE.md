# W36 显式决定 → 原工作确认完整子系统（四闭环）

范围：C owned packages（context/proposals/knowledge/routing）。source/controlled 已验；
main 默认 App/UI、安装、native、活动恢复、value 未验。

## 闭环一：Canonical 选择 → 可信当前 Binding（complete-source）
- `captureDecisionSnapshot`：window/selected 两种模式；selected 逐条 `getEffective`，不受项目窗口截断；
  mode/scan/callerTruncated/max 明确；重复/越界/非法预算/未知项目严格分离。
- snapshot 深冻结 + 严格协议/Scope/时间/coverage 解析；revalidate 完整绑定 version/content/scope/source/recordedAt/expiry。
- **同步 guard 修复（W36）**：
  - 使用 `AssistantDecisionStore.getSync` 的真实治理投影，`status` 必须 `active`；
    superseded/inactive 即使 version/revokedAt 未变也不会通过。
  - 校验 binding 形状/数量/唯一 ID/时间；**重算 canonical `snapshotDigest`** 并与声明比较，
    改 digest 或改 decisions refs 均 `invalid_binding`。
  - 来源摘要经同步 `sourceTextDigest` 校验；过期/scope/项目不一致分别拒绝。

## 闭环二：原 Create 事务到持久确认引用（partial-main-integration）
- 已交：`bindDecisionSelection`（`decision-selection-binding/1`，refs + snapshotDigest + `authorization:'none'`）与
  `assertDecisionSelectionBindingCurrentSync`（无 await，供 main 的 `uow.atomic` 使用）。
- 真实测试：`prepareCommand` → 同一事务内 guard → `commitPrepared`；创建仅一次；
  guard 失败时无 receipt/Work；已提交 command 重放返回原 Work；撤销后旧 binding 失败、冻结 context 不变。
- 未达：main 尚未把 binding refs 持久化到 Work/contract，也未在默认 create handler 调用 guard；
  调用者客户端 scope/valid 不能当作 main 授权。

## 闭环三：来源治理、草稿与两项目重开（complete-source）
- 连续 preview/select/send/sources，record→supersede→revoke，旧冻结 bytes 不变；
  未来 preview 只含当前有效；permission/auth 不进入共享决定。
- 草稿：0600/owner/regular/no-follow；`load --revalidate` 与当前 sourceDigest 比对；
  TTL 有效但来源变化时 `matchesCurrent:false`；坏时间/大文件/symlink/0644 拒绝。
- 两项目/多会话重开、readonly sources 可读而写操作拒绝、原 receipt replay 不复活旧状态。

## 闭环四：默认 API/UI 与同版本维护（partial-main-integration）
- 已交：稳定 exports/types、`WAVE35/36` 指南、`wave36-ui-input.json`；provider/composer/snapshot 共用原有效性。
- 未达：main/F 的默认 App/HTTP 表单尚未消费 snapshot/preparation/binding，App 端选择/确认/持久 refs 仍需接线；
  Node 文件/crypto/治理实现不进入浏览器（由 DTO 切分）。

## 维护与层级
- 旧九验收矩阵保留并映射四闭环（C1–C2→一，C3→二，C4–C6→三，C7–C9→四）。
- 源级与受控已验证；安装/native/活动恢复/value 未测；E 独立 W36 verdict 尚无。
- 自动真实 model/native 0；预算未动；十二实例与全部 state/tar/ledger 未触碰。
