# WP-16 / D 第八轮：保留个人模式的升级、失败清理与精确 schema 拒绝

日期：2026-11-11。基线 main `5d4065b`（含 WP-16/0030 提案 UI 与只读 activation 审计）。本文只覆盖
D（launcher/distribution/portability）的升级/恢复路径；不是 main/E 准入。真实模型调用 0，未启停用户
六组服务。

## 1. 模式与身份保留（D1）

`pa upgrade` 之前固定给目标传 `--fixture`，会静默把 personal 实例降级。现在：

- 切换前从实例记录读取 `mode`/`access`（`preserveIdentity`）；记录缺失且无显式 `--mode/--access` 时
  返回 `upgrade_mode_unavailable`，不猜测、不降级；
- 目标启动参数由 `launcherStartArgs` 生成：`personal` 绝不带 `--fixture`，`token` 才带 `--require-login`；
- 启动后要求实例记录与 `/v1/health` 都报告同一 `mode`，否则按失败路径清理并回退；
- `verifyInstance` 新增 `runtime_mode` 检查，任何“记录 personal、实际 fixture”的实例都视为身份不符；
- upgrade/recover/rollback 统一规则：记录未验证但 PID 仍活 → `instance_record_unverified`，不杀、不换指针。

## 2. 失败目标清理与中断窗口（D2）

新增 `stopOwnedTarget`：只处理「本次 spawn 根进程树 + 记录的实例」中，命令行仍指向本次目标安装或本次
roots 的进程；先 SIGTERM、再 SIGKILL、再轮询确认。只有**证明已停止**才回退指针/记录；无法证明时写
`target_stop_unproven`，保留不确定状态，绝不重启旧 writer。`pa upgrade --recover` 对
`target_stop_unproven` 先重试清理，成功才回退。已覆盖窗口：

| 窗口 | 行为 |
| --- | --- |
| 备份后失败 | 不切换，实例仍在 |
| 停止后崩溃（pointer 前） | journal `stopping`/`switching`，恢复重启**上一版**（`RECOVERED_PREVIOUS`） |
| `crash_after_switch` | journal `switched_unconfirmed`，`--recover` 启动目标或回退 |
| 目标不健康 | 先证明进程树停止，再回退指针/记录 |
| health 通过但记录未落盘 | 先清理本次目标，再回退（`instance_record_missing`） |
| 停止无法证明 | `target_stop_unproven`，不换指针、不起旧 writer |

## 3. 精确 schema 证据（D3）

旧结果把 `release_artifact_missing` 当作“schema 不兼容”，不再成立。现在：

- 旧 schema-12 构建被赋予**自己的合法 release**，只把 data root 指向 schema-13 state：真实 storage 读取
  器以 `MigrationIntegrityError: Applied migration 13 is not registered in this build` 拒绝，且无
  instance 记录、无监听、state 字节/schema 不变；
- 旧构建对 schema-13 bundle 返回 `manifest_invalid`（证据格式层），记录为 bundle 格式拒绝，不冒充
  `schema_unsupported`；
- 新构建在 spawn 前读取 state 的 `product_schema`，高于本构建时返回
  `state_schema_newer_than_binary`（detail.stateSchema），不启动任何 writer。

两个 wave-08 产物都是 schema 13，因此本轮**未测** schema 变化的真实二进制对。

## 4. 冻结与 E 交付（D4/D6）

| | baseline | target |
| --- | --- | --- |
| buildId | `7e8f6ce6fa2e2633` | `cd0ecc29d97d5c41` |
| source | `e10bfdb`（保留产物） | `9b75c2a`（main wave-08 集成后 D 干净提交） |
| tar sha256 | `0fe0ed53…c7631` | `64bbe285…3d42` |
| 文件 | 6603 | 6630 |
| schema/平台 | 13、darwin/arm64、Node 24.21.x、SQLite ABI 137 | 同 |

E recipe：`tools/distribution/recipes/wave08-e-personal-upgrade.zh-CN.md`；本机复跑 7/7 PASS，
D 失败窗口 recipe 14/14 PASS（`tools/distribution/reports/wave08/`）。旧 wave-07 双 tar 证据保留。

## 5. 恢复激活消费（D5，仍 BLOCKED 在 main）

main 已发布只读 `inspect`/`prepare` 和 `GET /v1/recovery/activations/:id` 审计（始终
`not_granted`/`startupAvailable=false`），**目标 commit/start 仍未实现**。D：

- `pa recovery-activation-check --intent <main intent> [--audit <main audit>] --target-root <新 state>`：
  本地 precondition gate（窗口/过期/摘要漂移/root 私有且互异/半准备目标/残留 instance、凭据、native
  session、激活/重复）始终 `not_granted`、`commitAvailable=false`、`started=false`；
- 审计只作为**拒绝**消费：`not_granted`/`startupAvailable=false` 记为一致拒绝，任何本地声称的启动许可
  返回 `audit_authority_unsupported`；审计对象不是便携 token；
- 旧 state 只读、新 state 不继承旧 queue/native 会话/凭据；不删 marker、不重放旧 queue；
- `pa doctor` 新增 `upgrade_journal`：未结算的切换给出唯一下一步 `pa upgrade --recover`。

## 6. 未测与剩余阻断

- **NOT_TESTED**：跨机器/其它 ABI、个人 native 端到端与真实 personal 计费执行、schema 变化二进制对、
  每个操作步骤的 SIGKILL、E 独立验收。
- **main**：恢复目标 commit/start；**D**：真实 personal 实例的升级只在 fixture 上验证了模式保留逻辑
  （personal 启动需要已准入执行器，本机未启动计费执行）。
- 所有探针使用隔离临时 root/端口；5180–5185/8796–8801 未启停。
