# G0-B 报告：隔离运行时与 SQLite 验证（OPS-01）

- 仓库 / 分支：`JokersDH/dsh-superagent-prototype` · `codex/g0-platform-validation`
- base commit：`f5c5754`（"docs: add Scheme B architecture and three-agent development baseline"）
- 执行时间：2026-11-07（Asia/Shanghai）
- 负责范围：仅 `tools/reuse-spike/platform/`；未改动共享契约、根清单/lockfile、迁移、其他 Agent 路径
- 结论：**PASS（限 darwin/arm64 与下列精确版本）**；未测项已逐条标 NOT_TESTED

---

## 1. 结论摘要

| 项 | 结果 |
| --- | --- |
| 拟议组合在隔离目录真实安装 | **PASS** — Node 24.22.2 + pnpm 11.7.0 + better-sqlite3 13.0.3，exit 0 |
| native binding 实际加载 | **PASS** — 打开数据库、`SELECT sqlite_version()` = **3.53.4** |
| 预编译（prebuild）真实可用 | **PASS** — tarball 内含 `prebuilds/darwin-arm64.node`（sha256 `98e0e8ac…`），无 `build/`、无 node-gyp、无生命周期脚本 |
| SQLite 版本 admission ≥ 3.51.3 | **PASS** — 3.53.4 |
| WAL / 外键 / 唯一约束 / 回滚 / 嵌套 savepoint / 同事务 state+effect+receipt 原子性 | **PASS** — 12/12 检查 |
| 回滚断点注入（事务内抛错） | **PASS** — 三类记录全部回滚 |
| 一致备份 → 新目录 restore → integrity / foreign_key | **PASS** — 6/6 检查，restore 后 integrity=ok、0 外键违规 |
| commit 后 SIGKILL 持久化 / 未提交事务回滚 | **PASS** — 4/4 检查 |
| 测试（node:test） | **PASS** — 两套运行时各 4/4 |
| 其他 OS/arch | **NOT_TESTED** |

---

## 2. 实际执行矩阵

| profile | Runtime（实际执行） | 包管理 | Binding | SQLite | 探针 | 测试 |
| --- | --- | --- | --- | --- | --- | --- |
| `release-proposed`（拟锁） | **Node v24.22.2**，下载自 nodejs.org，sha256 校验通过 `aa954934…` | **pnpm 11.7.0**，npm tarball，sha512 校验通过 | better-sqlite3 **13.0.3** | **3.53.4** | 30/30 PASS | 4/4 PASS |
| `local-observed`（本机对照） | **Node v24.21.0**（nvm 现有，未改动） | pnpm 11.7.0 | 同上 | 3.53.4 | 30/30（`node-proposed` 记 INFO） | 4/4 PASS |

OS：macOS **26.6**（Darwin 25.6.0），**arm64**（Apple Silicon，`RELEASE_ARM64_T8142`）。

> 拟议 Node 24.22.2 已按下发要求**隔离下载**到 `.cache/` 并用官方 `SHASUMS256.txt` 校验；没有升级全局 Node、nvm 或 pnpm。pnpm 11.7.0 同样下载到 `.cache/` 并由目标 Node 执行。

---

## 3. 安装与 native load

命令（真实执行，见 `evidence/install/pnpm-install.log`，313 B）：

```text
<target-node> <target-pnpm.cjs> install --store-dir .cache/pnpm-store --reporter=append-only
→ Lockfile is up to date, resolution step is skipped
→ + better-sqlite3 13.0.3
→ Done in 234ms using pnpm v11.7.0
```

| 事实 | 值 | 证据 |
| --- | --- | --- |
| 安装退出码 | 0 | `evidence/install/install.json` |
| 实际 Node / pnpm | v24.22.2 / 11.7.0 | 同上 |
| better-sqlite3 | 13.0.3，生命周期脚本 `[]`（无 install/postinstall） | 同上 |
| prebuild 是否随包 | 是：`prebuilds/darwin-arm64.node`（1,980,736 B，sha256 `98e0e8ac…`） | 同上 + `env.json` |
| 随包 prebuild 覆盖 | 8 个：darwin-arm64/x64、linux-{x64,arm64}、linuxmusl-{x64,arm64}、win32-{x64,arm64} | `env.json` |
| 是否发生本地编译 | 否：`node_modules/better-sqlite3/build/` 不存在 | `install.json`、`env.json` |
| loader 选择顺序 | 先 `prebuilds/<platform>-<arch>.node`，再 `build/Debug|Release`（`lib/binding.js` sha256 `4fe0f892…`） | `env.json` |
| 显式加载该 prebuild | `new Database(':memory:', { nativeBinding: prebuilds/darwin-arm64.node })` 成功，sqlite_version 相同 | `env.json` |

**关于 pnpm 11 的构建批准**：pnpm 11 把 better-sqlite3 列为“未批准构建者”并以 exit 1 阻断安装，尽管该包没有任何构建脚本。本实验在局部 `pnpm-workspace.yaml` 显式写 `allowBuilds: better-sqlite3: false`（明确拒绝），安装因此非交互成功且未触发编译。详见 §9 风险 R1。

---

## 4. SQLite 引擎与 admission

| 项 | 值 |
| --- | --- |
| `sqlite_version()`（binding） | **3.53.4** |
| admission 下限 | **3.51.3** |
| 结论 | **PASS**（3.53.4 ≥ 3.51.3） |
| `sqlite_source_id()` | `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc` |
| compile options | 59 项（摘要 sha256 见 `env.json`） |
| Node 自带 `process.versions.sqlite` | 3.53.4（**仅记录，未使用**；node:sqlite 无 ADR，不静默切换） |

---

## 5. 事务探针（12/12 PASS）

临时库，PRAGMA 实测值：`journal_mode=wal`、`foreign_keys=1`、`synchronous=2 (FULL)`、`busy_timeout=5000`。

| 检查 | 结果 | 观察 |
| --- | --- | --- |
| WAL 模式 | PASS | `journal_mode=wal`，写后 `-wal` 119,512 B、`-shm` 存在 |
| 外键开启 | PASS | `foreign_keys=1` |
| 外键强制 | PASS | 插入孤儿行 → `SQLITE_CONSTRAINT_FOREIGNKEY` |
| 唯一约束 | PASS | 重复 label → `SQLITE_CONSTRAINT_UNIQUE` |
| 显式回滚 | PASS | ROLLBACK 后行不存在 |
| 嵌套 savepoint | PASS | 回滚内层后：外层保留 1、内层丢弃 0、后续写入 1 |
| 同事务 state+effect+receipt 一起提交 | PASS | 三者各 1 行 |
| **回滚断点注入** | PASS | 事务内写 state+effect+receipt 后抛错 → 三者全部 0 行 |
| 读连接只见已提交 | PASS | 只读连接：已提交 1、回滚 0 |
| integrity_check | PASS | `ok` |
| foreign_key_check | PASS | 0 违规 |
| checkpoint | PASS | `wal_checkpoint(TRUNCATE)` → `{busy:0, log:0, checkpointed:0}` |

未覆盖：`afterCommit` 顺序（产品包装概念，不在本探针）、多进程写入、busy 重试竞争。

---

## 6. 备份与恢复（6/6 PASS）

方式：better-sqlite3 `Database#backup()`（SQLite Online Backup API），从 **WAL 模式、含未 checkpoint 帧**的源库备份到**新目录**，再打开副本检查。

| 项 | 值 |
| --- | --- |
| 种子数据 | 220 对 parent/child（另有 20 对留在未 checkpoint 的 WAL 中） |
| 备份期间并发写 | 通过第二个连接在 backup 的 `progress` 回调中写入：尝试 1 次、提交 1 次、busy 0 |
| 源库 | 40,960 B，WAL 70,072 B |
| 恢复库 | 40,960 B，parents 221 / children 220（快照包含 1 条并发 parent） |
| integrity_check | `ok` |
| foreign_key_check | 0 违规 |
| schema 摘要 | 源与恢复一致（`59122cb4…`） |
| 结论 | **PASS** — 快照即使包含并发写也保持内部一致（无 child 指向缺失 parent） |

**范围限制**：只覆盖数据库快照。产品 artifact 文件、Runner 状态、journal、完整业务恢复**不包含**，不能作为 OPS-02/REL 系列证据。

---

## 7. 崩溃后的最小持久化（4/4 PASS）

两个子进程各自 `SIGKILL` 自己：

| 场景 | 结果 |
| --- | --- |
| 已提交（autocommit）后立刻 SIGKILL | 行 `committed-before-crash` **存在**；reopen 后 integrity=ok；`-wal` 20,632 B 残留并被回收 |
| 显式事务写入后未 COMMIT 即 SIGKILL | 行 `uncommitted-at-crash` **不存在** |
| 退出信号 | 两次均为 `SIGKILL` |

**范围限制**：单表、单连接、仅 SIGKILL；断电、文件系统故障、NFS/同步盘、多进程 fencing 均 **NOT_TESTED**。不能据此宣称 OPS-02（stop 后物理 writer 校验、业务恢复）已完成。

---

## 8. 复现步骤

```sh
cd tools/reuse-spike/platform
node scripts/fetch-runtime.mjs
node scripts/install-deps.mjs
.cache/runtimes/node-v24.22.2-darwin-arm64/bin/node scripts/run-probes.mjs --profile release-proposed
node scripts/run-probes.mjs --profile local-observed
.cache/runtimes/node-v24.22.2-darwin-arm64/bin/node --test test/probes.test.mjs
node --test test/probes.test.mjs
```

实际耗时（本机）：下载并解压 Node+pnpm < 1 min；安装 0.3 s（store 已热）；探针 < 1 s；测试 0.14–0.16 s。首次冷缓存会多出约 50 MB Node + 2 MB pnpm 下载。

---

## 9. 阻塞、风险与限制

### R1｜pnpm 11 的构建批准是真实阻断（需产品决策）

- 现象：better-sqlite3 13.0.3 无任何 install 脚本，但 pnpm 11 仍报 `ERR_PNPM_IGNORED_BUILDS` 并 exit 1。
- 本实验的处理：局部 `pnpm-workspace.yaml` 记录 `allowBuilds: better-sqlite3: false`。
- 风险：若未来 better-sqlite3 重新引入 install 脚本（或换 binding），`false` 会静默跳过必要构建。**必须版本锁定 + 升级时重跑本探针**。
- 备选：`pnpm install --config.strict-dep-builds=false`（等价效果、不写配置），但 CI 里更易被误删；不推荐 `approve-builds --all`（会对将来所有依赖放行）。

### R2｜拟议 Node 24.22.2 不是本机默认运行时

- 本机 nvm 是 24.21.0；两者的探针都 PASS，但发行基线是 24.22.2。
- bootstrap 必须下载/固定 24.22.2（或在 CI 镜像中预置）；不能依赖“用户机器上碰巧有”。

### R3｜矩阵只覆盖 darwin/arm64

- Node/pnpm 下载脚本只支持 darwin/linux 的 x64/arm64，且只实际执行了 darwin-arm64。
- Windows、Linux、Intel Mac 全部 **NOT_TESTED**；tarball 内其他平台 prebuild “存在”不等于“验证过”。

### R4｜备份与崩溃探针规模很小

- 数据库 40 KB、单表、单连接；大库备份耗时、长时间 WAL 增长、checkpoint 压力 **NOT_TESTED**。
- 崩溃只测 SIGKILL；无断电/文件系统/网络盘。

### R5｜未覆盖产品语义

- 未实现正式 Store/Queue/迁移；未验证 `afterCommit`、writer lease、多进程、业务恢复、artifact 文件一致性。
- 本报告不能替代 OPS-02、REL-01/02 等更高层验收。

### R6｜node:sqlite 未评估

- Node 24 自带 SQLite 3.53.4（与 binding 同版本），但按 09 选型不静默切换；若要改用 node:sqlite，需要独立 ADR 与同等测试。

### R7｜macOS 发行侧未覆盖

- 未涉及签名、notarization、universal binary、Gatekeeper；属于后续发布任务。

---

## 10. 发行组合建议（release candidate）

**采用**（限 darwin/arm64）：

| 组件 | 精确版本 | 固定依据 |
| --- | --- | --- |
| Node | **24.22.2** | 官方 tarball sha256 `aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a` |
| pnpm | **11.7.0** | npm tarball `dist.integrity` sha512（见 release-candidate.json） |
| better-sqlite3 | **13.0.3** | npm tarball integrity sha512（见 release-candidate.json） |
| SQLite engine | **3.53.4** | admission ≥ 3.51.3，实际通过 |
| OS/arch | macOS 26.6 / arm64 | 实测 |

bootstrap 需同时带入：
1. 上述 tarball URL + 校验和（离线/镜像场景可预置）；
2. `allowBuilds: better-sqlite3: false` 的显式决策（或等价 CLI 参数）；
3. 首次启动自检：记录 `sqlite_version()`、PRAGMA 值、prebuild 路径与 hash（对应 05 §2 的“启动自检记录”）；
4. 若运行在非 darwin/arm64：**重新跑本目录脚本**，不要继承本 PASS。

**替代方案**（仅当拟议组合在目标机失败时，按顺序）：

1. Node **24.21.0** + 同一 binding（本机实测同样 PASS；但需重新固定并记录）；
2. 若 better-sqlite3 13 在某平台缺 prebuild → 该平台降级为“需本地编译”，必须显式允许构建并记录编译器身份，**不得静默切换**；
3. node:sqlite 仅在独立 ADR + 同等事务/备份/崩溃测试后考虑。

---

## 11. OPS-01 → 证据映射

| OPS-01 要求 | 本实验对应证据 | 状态 |
| --- | --- | --- |
| Given：锁定 Node/binding/pnpm/OS/arch | `release-candidate.json`（版本 + tarball 校验和 + OS/arch） | PASS |
| When：加载 native binding | `evidence/release-proposed/env.json`（默认加载 + 显式 prebuild 加载） | PASS |
| When：查询 engine | `env.json`（`sqlite_version()`=3.53.4、source_id、compile options） | PASS |
| When：安装/启动 | `evidence/install/install.json` + `pnpm-install.log`（exit 0、无编译） | PASS |
| Expected：实际版本满足 admission | 3.53.4 ≥ 3.51.3（`env.json.sqlite.admissionSatisfied=true`） | PASS |
| Expected：prebuild 真可用 | 随包 `prebuilds/darwin-arm64.node` + 显式加载成功 + 无 `build/` | PASS |
| Expected：不静默切 binding | `allowBuilds: false` + loader 顺序 + prebuild sha256，三者可核对 | PASS |

---

## 12. 与 product-spec 的关系 / 需要下游注意的偏差

- 09 §1 说“13 使用 N-API/随包 prebuild”——**实测吻合**，并细化为：tarball 内含 8 个平台 prebuild，无 install 脚本。
- 05 §2 要求“PRAGMA 配置、外键、busy budget、WAL/checkpoint 与 backup 行为在启动自检里记录”——本探针提供了可复制的检查项；**产品启动自检仍需在 WP-03/16 实现**。
- 05 §2 “文件锁超时不是 writer 已死的证明”等恢复语义 **未在本包验证**，属 OPS-02/G1。

---

## 13. 交接

- 下一个消费者：主 Agent（G0 汇总）→ WP-16（bootstrap 模板）→ WP-03（正式 storage）。
- 可直接复制：`release-candidate.json` 的版本/校验和、`README.md` 的复现命令、`src/lib/util.mjs` 的版本比较与脱敏。
- 必须在 G1 补：大库备份/长时间 WAL、多进程 writer lease、SIGTERM/SIGKILL 组合下的 stop 语义、Windows/Linux 矩阵。
