# RFC WP-06-0001：Catalog / Profile / PolicyPreparation 接口检查点

- 状态：**实施约定**（wave-02 B3）；不改变 contracts v1/hash，不新增 wire schema
- 包：`packages/catalog`、`packages/policy-preparation`
- 实现者：Agent B；消费者：主 Agent 的 Snapshot/路由、UI（A）

## 1. 为什么不新增 wire 类型

catalog 的每条记录都由冻结类型组合而成：`AgentProfile`（输入）、`CompatibilityIdentity`、`CapabilityObservation`、`ProbeReport.readiness`。
`CatalogEntry` 只是这些值的本地聚合，不经 HTTP 序列化；若将来需要向 UI 暴露，主 Agent 统一派生 schema，本包不擅自加字段。

## 2. readiness 的封闭集合与优先级

`buildCatalogEntry` 按下列顺序判定，**先命中先返回**：

| 顺序 | 条件 | readiness |
| --- | --- | --- |
| 0 | `facts.executable !== profile.executable` | 记录诊断（不单独决定） |
| 1 | `!exists` | `missing` |
| 2 | `requiresAuth` | `needs_auth` |
| 3 | 无 configFingerprint / 指纹非法 / stability 为 unverified | `needs_setup` |
| 4 | 版本缺失或 ≠ `profile.expectedVersion` | `incompatible` |
| 5 | 任一 requiredFeature 未观测到 PASS | `incompatible` |
| 6 | 无 executable digest | `needs_setup` |
| 7 | 全部满足 | `inspection_passed` |

`native_test_passed` **本包永不产出**：它只能由真实原生握手产生。

`schedulable(entry)` 仅对 `inspection_passed` / `native_test_passed` 为 true。

## 3. 漂移

`driftBetween(previous, next)` 比较 `executableDigest / nativeVersion / driverRelease / wireVersion / schemaDigest / resolvedConfigFingerprint / permissionPolicyRevision / configStability / platform / architecture`。
任一变化即 `drifted: true`，旧批准不会被新探测继承。

## 4. PreparedExecutionPolicy gate

`admitPreparedPolicy(record, spec, context)` 的拒绝原因（稳定码）：

| 原因 | 含义 |
| --- | --- |
| `not_prepared` | 没有准备记录 |
| `identity_mismatch` | ticket/assignment/attempt/epoch/contract 任一不符 |
| `advisory_only` | enforcement 为 advisory 或 approval_guarded |
| `unverified` | verification 为 not_tested 或 failed |
| `config_drift` | 记录的 fingerprint ≠ 当前 fingerprint |
| `permission_policy_changed` | 准备时的 policy revision ≠ profile 当前值 |

`PolicyPreparation` 额外提供 `hold()`：配置/二进制/权限漂移时置为 held，**保留记录用于诊断**、拒绝业务工作，但 `canCancel()` 恒为 true（停止永远可用）。重新 `prepare()` 可解除 hold。

## 5. 依赖请求

- 无新增持久化需求：catalog 为内存投影，生产持久化（若有）由 A 的 repository 决定。
- 若要向 UI 暴露 profile 列表，需主 Agent 在 Snapshot 派生 schema 后统一发布（本包已按此预留）。
