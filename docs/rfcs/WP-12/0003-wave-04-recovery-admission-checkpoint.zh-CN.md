# WP-12 / D 第四轮：恢复准入与活跃回滚修复检查点

日期：2026-11-10。基线：合并 `origin/main` 的 `006b4af`（main 输入 `a42924a` + `8c736f2`）。Owner：Agent D（`codex/g3-local-distribution`）。
本文记录第四轮 D1 修复检查点，状态 **CHECKPOINT**；D2–D5（实例身份、可搬迁闭包、A 公共快照、完整试用 smoke）在后续提交继续。

## 已复现阻断与修复

| 主线程复现 | 修复 |
| --- | --- |
| 保持 ProductStore+WriterLock 打开，`rollbackState` 仍返回 ROLLED_BACK 并移走活跃目录 | 新增 `packages/portability/src/state.ts`：在**任何 destructive rename 前**同时核对 (1) launcher 实例记录（含未核实记录拒绝）、(2) `writer_claim`（活跃进程 / 死亡进程=unknown 均拒绝）、(3) `lsof` 打开的 `state.sqlite`/`-wal`/`-shm` 持有者。active/unknown 都拒绝，错误码 `state_in_use`/`writer_uncertain`/`target_active`；不按 PID 猜测、不移动 inode 绕锁。`restore --to` 对已活跃目标同样拒绝。 |
| 恢复产物普通 `start` 会消费旧队列 | launcher 读取 `restore-report.json`，显式向 daemon 传 `--startup-mode recovery_readonly`，并核对 `/v1/health.startupMode === 'recovery_readonly'`；不一致则停止 daemon 并 BLOCKED（`startup_mode_mismatch`），不把实例呈现为可用。marker 从不删除、不新增“允许续跑”开关；业务动作禁用与重绑定/重验由 main 负责。 |
| 实例复用未核对请求条件 | `start` 先解析期望 `install/state/mode/access/ports/buildId/startupMode`，再与已运行实例逐项比较；不一致返回 `instance_conflict`（含 differences），不再只凭端口复用。 |

## 实际验证（本机 darwin/arm64，Node 24.21.0，SQLite 3.53.4，模型 0）

- `packages/portability`：`pnpm typecheck` PASS；`node --test test/*.case.ts` **33/33 PASS**（新增 state activity 5 项：关闭态 inactive、活跃 writer 拒绝、死亡 writer claim=unknown、外部进程持有 DB 文件被检出、缺失 state 明确 invalid_root）。
- `apps/launcher`：`node --test test/*.case.mjs` **17/17 PASS**（新增 restore-marker 门禁、活跃状态回滚拒绝且原目录未移动）。
- `tools/distribution/smoke.mjs` **33/33 步 PASS**（约 14s），关键新步骤：
  - `rollback-refuses-active-state`：运行中实例的 state 回滚被拒（`state_in_use`），实例仍健康、目录未移动；
  - `reuse-requires-matching-identity`：不同 state、不同端口复用均 `instance_conflict`；
  - `restored-first-start-readonly`：恢复库（含 queued begin/deliver、assistant reply、pending answer/delivery、parked verification、死亡 writer claim）首次启动 `startupMode=recovery_readonly`，命令 POST 422 `unsupported_capability`；
  - `recovery-keeps-old-business`：启动/停止后队列、答案、投递逐行不变，`restore-report.json` 仍在；
  - `login-gated-session`：token 模式恢复实例同样只读（bootstrap 门前 401，写入 403/422 由 Origin/恢复门禁拒绝）。
- 证据：`tools/distribution/reports/zero-model-smoke.json`（本次 33 步）、`tools/distribution/reports/wave04-status.json`。

## 边界（NOT_TESTED）

- 个人 native 启动仍依赖 main/B 原生准入，本轮 NOT_TESTED；fixture 只证明组合与门禁。
- 真实物理只读 SQLite 文件非本模式承诺（main 0016 已说明）；本检查点证明不消费业务队列/不发模型/native。
- 跨机器/跨 ABI、macOS x64/Linux/Windows NOT_TESTED。
- 恢复后的重绑定/重新验证/新执行授权由 main 完成；D 未实现也未承诺“允许续跑”。

## 后续（D2–D5）

1. **D2**：API 子进程 start identity/UID/精确 argv/state 结构校验、并发 start 单赢、PID 复用/失效 socket/未知孤儿不误杀；复用/停止/失效记录同一身份语义。
2. **D3**：startup 校验实际执行字节 sha256（已提前做 hash:true）、版本化 staged install 闭包（网页 HTTP 构建、daemon/launcher、运行依赖/许可、平台/Node/ABI 清单），`--output` 不再只是清单；consoleMode 由实际构建验证；隔离移走原 checkout 后从安装目录启动。
3. **D4**：改用 A 公共 `readArtifactRegistry`/`WorkflowSnapshots`，移除临时私有 SQL；以完成交付的完整 patch/检查证据做 backup→restore→下载 bytes/sha256 roundtrip；恢复默认只读、路径重绑定保留实体身份。
4. **D5**：首次安装→配置→启动→复用→停止→doctor→备份→新目录只读恢复→显式重绑定/允许后才新工作→升级回滚的零模型 smoke；BLOCKED 步骤标明 main port；交 E 可运行入口与 bundle manifest。

## 跨模块依赖

- main 的 `recovery_readonly` 组合接口已消费并通过（`/v1/health.startupMode`、422 门禁、marker 自动检测）；不删除 marker、不新增绕过。
- A 的 `readArtifactRegistry` 已由 storage 导出，D4 采用；`WorkflowSnapshots` 语义参考其“快照后从快照读 registry”的顺序。
- 根 lock 仍由 main 生成；D 本轮未新增外部依赖（launcher devDependency 只加 workspace 包用于测试）。
