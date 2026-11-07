# G0-B：隔离运行时与 SQLite 验证（OPS-01）

本目录是 **G0-B 的一次性探针**，用于回答 WP-00 中 OPS-01 的问题：拟议发行组合能否在隔离环境里真实安装、加载 native binding，并且 SQLite 事务/备份/崩溃语义符合预期。

它**不是**正式 Store、Queue、迁移或业务恢复实现；G0 通过后由 WP-01/03 接手正式模块。所有结论按 `PASS / FAIL / SKIPPED / NOT_TESTED` 标注，未测项不冒充覆盖。

- 结论与矩阵：[report.md](report.md)
- 机器可读发行组合：[release-candidate.json](release-candidate.json)
- 原始证据（脱敏）：[`evidence/`](evidence/)

## 1. 拟议组合与本机矩阵

| 角色 | Runtime | 包管理 | Binding | SQLite engine | 结果 |
| --- | --- | --- | --- | --- | --- |
| **release-proposed**（拟锁） | Node **24.22.2**（下载并校验 sha256） | pnpm **11.7.0**（下载并校验 sha512） | better-sqlite3 **13.0.3**（tarball 内预编译） | **3.53.4** ≥ 3.51.3 | **PASS**（30 项检查，4/4 测试） |
| local-observed（本机对比） | Node 24.21.0（nvm 现有，未改动） | pnpm 11.7.0 | 同上 | 3.53.4 | PASS（`node-proposed` 记 INFO） |

只有 **darwin / arm64** 被实际执行；其他 OS/arch 一律 **NOT_TESTED**。

## 2. 前置条件

- macOS on Apple Silicon（本实验矩阵；其他平台会显式报 `NOT_TESTED` 并退出）。
- 一个 ≥ 22 的系统 Node，仅用于启动 `scripts/fetch-runtime.mjs`（它只用标准库 + 全局 `fetch`）。
- 网络：`nodejs.org`（Node 发行包）与 `registry.npmjs.org`（pnpm、better-sqlite3）。
- `tar`（macOS 自带）。
- **不需要也不允许**升级系统 Node、pnpm、Homebrew 或 nvm；所有下载物落在 `.cache/`（已 gitignore）。

## 3. 目录结构

```text
platform/
  package.json             最小依赖清单（唯一运行时依赖 better-sqlite3 13.0.3）
  pnpm-lock.yaml           由拟议 pnpm 11.7.0 生成
  pnpm-workspace.yaml      显式记录 allowBuilds: better-sqlite3: false（见 §5）
  scripts/
    fetch-runtime.mjs      下载/校验 Node 24.22.2 + pnpm 11.7.0
    install-deps.mjs       用拟议工具链安装，捕获安装证据
    run-probes.mjs         运行全部探针并写 evidence/<profile>/
  src/lib/util.mjs         版本比较、哈希、证据脱敏
  src/probes/
    env.mjs                native load / prebuild / sqlite_version() / admission
    tx.mjs                 WAL、外键、唯一约束、回滚、嵌套 savepoint、同事务原子性、回滚断点
    backup.mjs             WAL 库在线备份 → 新目录 restore → integrity/foreign_key
    crash.mjs + crash-child.mjs  提交后 SIGKILL / 未提交 SIGKILL 的持久化对比
  test/probes.test.mjs     与证据同源的断言测试（node:test，零额外依赖）
  evidence/
    install/               安装日志与安装事实
    release-proposed/      拟议组合的 4 份探针结果 + summary
    local-observed/        本机 24.21.0 的对照结果
```

## 4. 复现命令

在 `tools/reuse-spike/platform/` 下执行：

```sh
# 1. 下载并校验拟议运行时（幂等，落 .cache/）
node scripts/fetch-runtime.mjs

# 2. 用拟议工具链安装依赖（隔离 pnpm store，不碰全局 store）
node scripts/install-deps.mjs

# 3. 用拟议 Node 跑探针，生成正式证据
.cache/runtimes/node-v24.22.2-darwin-arm64/bin/node scripts/run-probes.mjs --profile release-proposed

# 4. 可选：用本机 Node 24.21.0 跑同一套探针做对照
node scripts/run-probes.mjs --profile local-observed

# 5. 测试（两套运行时都应 4/4 通过）
.cache/runtimes/node-v24.22.2-darwin-arm64/bin/node --test test/probes.test.mjs
node --test test/probes.test.mjs
```

`run-probes.mjs` 支持 `--only env,tx,backup,crash` 只跑部分探针。证据写入 `evidence/<profile>/`，路径会被替换为 `<PLATFORM_ROOT>` / `<HOME>` / `<TMPDIR>`。

## 5. 关于 pnpm 11 的构建脚本策略

better-sqlite3 13.0.3 **自带** 8 个平台的 N-API 预编译二进制（`prebuilds/<platform>-<arch>.node`），且 **没有** `install`/`postinstall` 脚本。但 pnpm 11 的严格依赖构建策略仍会把它列为“未批准构建者”并使 `pnpm install` 以 1 退出。

本目录的 `pnpm-workspace.yaml` 显式记录：

```yaml
allowBuilds:
  better-sqlite3: false
```

即“明确拒绝执行它的构建脚本”。安装因此非交互成功，且**没有触发 node-gyp 编译**（证据：`node_modules/better-sqlite3/build/` 不存在，运行时使用 tarball 内 `prebuilds/darwin-arm64.node`）。这不是静默切换 binding：被拒绝的构建本来就没有脚本可跑。

## 6. 证据怎么读

| 文件 | 内容 |
| --- | --- |
| `evidence/install/install.json` | 实际命令、Node/pnpm 版本、`prebuild` 是否随包、`build/` 是否存在、prebuild sha256、生命周期脚本为空、build 策略 |
| `evidence/install/pnpm-install.log` | 真实安装输出（`Lockfile is up to date` → `+ better-sqlite3 13.0.3`） |
| `evidence/release-proposed/env.json` | runtime/OS/arch/NAPI、`sqlite_version()`、compile options、prebuild sha256、loader 顺序 |
| `evidence/release-proposed/tx.json` | 12 项事务检查 + PRAGMA 实际值 + WAL 旁文件 + checkpoint 结果 |
| `evidence/release-proposed/backup.json` | 备份耗时、源/恢复库行数与字节数、schema 摘要、integrity、foreign_key、并发写次数 |
| `evidence/release-proposed/crash.json` | 两个子进程的退出信号、恢复后的行、WAL 旁文件 |
| `evidence/release-proposed/summary.json` | 聚合 PASS/FAIL 与限制 |

## 7. 边界（请勿过度引用）

- 探针 schema 是临时的，不等于产品 Store、迁移、Queue 或 afterCommit 语义。
- 只测了 **SIGKILL**；断电、文件系统故障、NFS/同步盘 **NOT_TESTED**。
- 备份只覆盖数据库文件；**产品 artifact 文件、Runner 状态、journal、完整业务恢复不包含**。
- 只有当前 host 的 darwin/arm64 与两个 Node 版本被实际执行；Windows/Linux **NOT_TESTED**。
- 未运行任何原生 agent 模型任务、未读取凭据、未访问生产数据库、未重置用户 profile。
- 本目录的数据库全部写在系统临时目录；仓库内不保留任何 `*.db` / `-wal` / `-shm`。

## 8. 下一步（主 Agent / G1）

1. 采用本目录 `release-candidate.json` 作为 OPS-01 的 G0 证据，合入 WP-16 的 bootstrap 模板。
2. OPS-02 前补：多进程 writer lease、stop 后物理 writer 核对、真实业务恢复。
3. 若目标机器不是 darwin/arm64，按同一脚本在目标机重跑并把结论改为该机器的矩阵；不要沿用本结论。
