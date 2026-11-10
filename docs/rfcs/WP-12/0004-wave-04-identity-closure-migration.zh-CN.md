# WP-12 / D 第四轮：实例身份、可搬迁闭包与恢复迁移（D2–D5）

日期：2026-11-10。基线：合并 main 的 `006b4af`。检查点 D1 `2ce8dcd`、D2 `f99b420`，D3/D4 见分支后续提交。
本文记录第四轮 D 包剩余阶段，状态 **CANDIDATE（包内验收）**，不是内部试用/发布准入。模型任务 0、未知 native 发送 0。

## D2 实例生命周期与真实身份（已完成）

- `pa start` 先解析期望身份：`install/state/mode/access/consoleURL/apiURL/buildId/startupMode`，再决定复用；任一不一致返回 `instance_conflict` 并列出 differences，不再仅凭端口/记录复用。
- launcher 与 API 子进程分别记录并核验：
  - launcher：`processStart`、精确 `argv`（ps 可能把 argv[0] 打成 basename；脚本路径按 install 根 canonical 比较，其余 token 逐项相等）、cwd（记录 `launcherCwd`，staged 可从任意目录调用）、uid；
  - API 子进程：`apiProcessStart`、`apiUid`、精确 `apiArgv`（含 `--state` 精确 token）、ppid、cwd、监听端口与 health。
- `start.lock` 串行化启动：同一 config 下只有一个 launcher 进入启动流程；存活持有者 → `start_in_progress`；死亡 breadcrumb 删除后重试一次；检查不确定时按“仍存活”fail closed。
- 失效记录/孤儿：launcher 被 SIGKILL 后 `status` 为 `UNVERIFIED`；`stop` 在 launcher 不存在时仅当记录的 API 子进程 argv/启动时间/uid/cwd/listener 全部匹配才 SIGTERM，随后清理记录；陌生活 PID 一律拒绝、不发送信号。

验证：launcher 单元 **25/25 PASS**（identity/start-lock/instance/release-gate 等）；smoke `concurrent-start-single-winner`（失败者 `start_in_progress`，仅一个 RUNNING）与 `orphan-record-recovery`（killed launcher → verified orphan stop）通过。

## D3 真实运行闭包与内容摘要（已完成）

- startup 用 `hash:true` 校验 release 全部 artifacts 的 sha256；同长度篡改执行入口会 `release_artifact_missing`（smoke `startup-verifies-executed-bytes`）。
- release manifest 现在覆盖**真正执行的字节**：`apps/coordinator/**`、`apps/launcher/**`、`apps/runner/**`（coordinator 相对 src 导入）、所有 workspace 包的 `src/**` 与 `dist/**` + `package.json`、console HTTP dist、LICENSE、native evidence；并记录运行时依赖闭包（package 级内容 digest + 版本 + license 文件），启动时逐个解析实际运行时包目录并比对 digest（长度相同内容不同也会失败）。
- consoleMode 由实际构建证明：console 构建写 `.pa-console-build.json`（`mode:'http'` + 文件集合 digest）；`--skip-console` 只有在 stamp 存在、mode=http、digest 与磁盘文件一致时才允许；不一致构建失败（smoke `skip-console-refuses-tampered-http-bundle`）。start/doctor 同样校验 release `consoleDigest` 与 stamp。
- `pa stage --output <dir>` / `pa build --output <dir>` 产出**版本化 staged install 闭包**（不再只是 release.json）：
  - `install.json`（`pa-install/1`）：source/buildId、producer/Node/ABI/SQLite、全部文件（6435 项，含 node_modules）sha256、依赖版本/digest/license、入口与限制；
  - `bin/pa` wrapper：默认把 `PA_*_ROOT` 指向闭包内 `var/`，任意目录/搬迁后可用；
  - `app/`：coordinator/launcher/runner 源码、workspace `src+dist`、flat 运行依赖（含 better-sqlite3 本机 ABI 原生 binding）、console HTTP dist、`var/config/release.json`；
  - 闭包自检：逐文件 digest + staged launcher 实际加载；失败不留半成品（原子 rename）。
- 搬迁证明（smoke `stage-closure-start`）：build 输出 → 移动到新路径（原路径删除）→ wrapper `first-run`/`start` 成功；`NODE_DEBUG=esm` 记录 **516 个运行模块全部位于搬迁后闭包内**，checkout 引用 0、旧路径引用 0。跨机器/跨 ABI 不声明。

## D4 采用 A 公共快照并证明完整迁移（已完成）

- `packages/portability/src/snapshot.ts` 移除对 `artifacts` 表的临时 SQL，改用 A 的公开 `readArtifactRegistry(databasePath)`（从一致快照库读取）；数据库快照/校验继续用 `backupDatabase`/`verifyDatabase`，即 `WorkflowSnapshots` 的同一组公开 primitives，且仍不创建第二个 writer。
- 完整交付回环（smoke `completed-delivery-fixture` → `restored-delivery-bytes-roundtrip`）：在受控产品实例中完成一个交付（真实 patch/检查 artifact，0 模型调用）→ 下载全部 artifact bytes/sha256 → backup → 新目录 restore → 恢复只读实例中重新下载相同 artifact 并比对 bytes/sha256，同时 `/v1/works/:id` 仍为 `delivered`。
- 恢复默认只读、不消费旧队列（D1 smoke）；显式 `--map-path` 保留实体 id、只重写显式映射路径、未映射 environment store 保持 pending（smoke `restore-rebind-preserves-identity`）；恢复前不含凭据/运行锁，旧 writer claim 不会成为新权限（smoke `restore-does-not-revive-old-authority`）。
- 回滚先验证快照：损坏 bundle 在任何 rename 前失败，目标与目录状态不变（smoke `rollback-verifies-snapshot-before-move`）；成功回滚保留 `<state>.failed-<ts>` 现场，失败时放回原目录并写 `rollback-diagnostics-*.json`。

## 跨模块阻断（D 不改 main 代码）

- **RECOVERY-PROJECT-BINDINGS**（owner: main）：恢复只读组合接管恢复库中的 `native-projects.json` 后，`createProductRuntime` 对恢复项目 scope `.` 抛 `Controlled fixture projects require the fixed src/ scratch grant`，daemon 在提供只读历史前退出。最小复现与证据：`tools/distribution/repro-recovery-project-binding.mjs`、`tools/distribution/reports/wave04-blockers/recovery-project-bindings.json`（withProjects: exit 1 + 该错误；withoutProjects: `recovery_readonly` 正常）。影响：带项目绑定的恢复实例无法只读打开；D 的 smoke 以无项目绑定的恢复库验证只读门禁，并在离线 restore 中验证重绑定。建议 main 在恢复只读模式接受恢复项目 scope 或忽略绑定列表，不授予执行。
- 其余依赖均已消费：main `recovery_readonly`/`/v1/health.startupMode`、A `readArtifactRegistry`/`backupDatabase`/`verifyDatabase`。根 lock 仍由 main 生成；本轮未新增外部依赖。

## 证据与边界

- `tools/distribution/reports/zero-model-smoke.json`：**45 步全 PASS**，约 36s（build/stage/start/backup/restore/recovery/rollback/orphan/concurrent/delivery-roundtrip/闭包搬迁）。
- `packages/portability` 33 项、`apps/launcher` 25 项测试；`tools/distribution/reports/wave04-status.json` 记录命令与结果。
- NOT_TESTED：个人 native 启动（main/B 准入）、跨机器/跨 ABI、macOS x64/Linux/Windows、物理字节只读 SQLite 文件（main 0016 范围）、恢复后重新授权（main 范围）。
- D 只改拥有路径；未删除 restore marker、未新增“允许续跑”开关、未改共享契约/迁移/root lock/他人代码。
