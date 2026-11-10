# WP-12 / D：本机发行与迁移消费说明（给 main / E / 内部试用）

日期：2026-11-10。对应 RFC：[0001-local-distribution-rfc](0001-local-distribution-rfc.zh-CN.md)。
本文是**消费步骤**，不是发行通过声明；未测项明确标注。

## 1. 前置条件（同机安装模型）

- 仓库 checkout（本分支）+ `pnpm install --frozen-lockfile`（**root lock 需 main 为新 importer 重新生成**；本地临时锁差异未提交）。
- macOS arm64 + Node `>=24.21.0 <25` + 可加载的 `better-sqlite3` 13.0.3（SQLite 3.53.4）。其它平台 NOT_TESTED。
- 不需要 Vite dev server；运行时只消费 `pa build` 记录的 `apps/console/dist` 与各包 `dist`。
- 不复制他人账号 home/native 认证；不停止/重启现有 5180/8796、5181/8797 服务。默认端口 5190/8790，可用 `--port/--api-port` 覆盖。

## 2. 命令

```sh
PA="node apps/launcher/bin/pa.mjs"

$PA first-run                       # 创建私有根 + 非秘密 launcher 配置；只读探测执行器
$PA build                           # 一次性构建 + 写 release manifest（源码更新后重跑）
$PA start                           # 个人模式；本机无原生准入时用 --fixture 验证受控链路
$PA status                          # 0=RUNNING 已验证 / 1=记录不可信 / 2=未运行
$PA doctor                          # 0=READY / 1=DEGRADED / 2=BLOCKED；--json 机器可读
$PA stop                            # 只结束已验证实例；超时如实返回非零

$PA backup --out ~/backups/state-$(date +%s).pab   # 一致快照 + 引用产物 + 必要配置
$PA verify-backup --bundle <file>
$PA import-bundle --bundle <file>                  # 登记到 <config>/backups/
$PA restore --bundle <file|导入sha> --to <新私有目录> [--map-path /old=/new ...]
$PA rollback --bundle <file> --target <state 目录>  # 或省略 --bundle 使用该 state 的最近快照
```

所有命令支持 `--json`。根目录覆盖：`--install`、`--config-root`、`--data-root`/`--state`、`--cache-root`、`--logs-root`、`--workspace-root`（或 `PA_*_ROOT`）。`--require-login` 以本地 bootstrap token 保护会话；token 文件在 `<data>/bootstrap.key`。

## 3. 退出码与失败语义

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 / READY |
| 1 | DEGRADED（可诊断/设置但不能完整执行；如无执行器、实例未运行）或 stop 超时/身份不符 |
| 2 | BLOCKED（Node/ABI/SQLite/构建/根目录/备份校验/恢复前校验失败） |
| 3 | 用法错误 |

失败码（`--json` 的 `code`）：`first_run_required`、`release_missing`、`release_artifact_missing`、`runtime_mismatch`、`instance_identity_mismatch`、`invalid_instance_record`、`port_in_use`、`daemon_start_failed`、`stop_timeout_resources_alive`、`unsafe_root`、`root_inside_install`、`archive_invalid`、`archive_unsafe_path`、`archive_limit_exceeded`、`archive_duplicate_entry`、`bundle_digest_mismatch`、`manifest_version_unsupported`、`artifact_missing`、`artifact_digest_mismatch`、`database_unavailable`、`database_verify_failed`、`target_not_empty`、`target_active`、`target_invalid`、`config_invalid`、`no_snapshot`、`rollback_failed`、`restore_failed`。

**不报假成功**：stop 超时/身份不符、备份缺 artifact、bundle 摘要/版本不符、恢复目标非空、回滚失败都会非零并给出原因；不会按 PID 猜测结束陌生进程。

## 4. 目录与产物

| 位置 | 内容 | 备份 |
| --- | --- | --- |
| `<config>`（默认 `~/Library/Application Support/dsh-superagent/config`） | `launcher.json`、`release.json`、`instance.json`、`backup-index.json`、`backups/` | 不进入 bundle |
| `<data>`（默认 `.../dsh-superagent/data`；= daemon `--state`） | `state.sqlite`、`artifacts/`、`native-projects.json`、`*.key` | 仅一致快照 + 引用 artifact + 项目绑定；凭据/运行记录/环境授权/派生 worktree 排除 |
| `<cache>` / `<logs>` / `<workspace>` | 暂存/脱敏有界日志/派生 worktree | 不进入 bundle |

`restore-report.json` 在恢复后的 state 根：记录 bundle 摘要、路径映射、`requiresRevalidation`、`pendingRebind`。**旧 native 环境/认证/签名 receipt/进程身份不会因搬迁变成新权限**；默认不打包项目内容。

## 5. E 的独立安装/迁移验收步骤（D 不修改 E 断言）

1. 新目录复制/检出本分支，按 §1 安装；**不要**复用 D 的私有根（用独立 `PA_*_ROOT` 或 `--config-root/--data-root/...`）。
2. `first-run` → `build` → `doctor`（记录 status/checks）→ `start --fixture`（无模型）→ 浏览器打开打印的 URL → `stop`。
3. 真实个人模式仅在 main/B 的原生准入提供后测试；否则标 NOT_TESTED，不用 fixture 结果冒充 native。
4. `backup --out` → `verify-backup` → `restore --to <新目录>`（记录 `restore-report.json` 的 revalidation/pending）→ 在恢复目录 `start --fixture` → `stop`。
5. 升级回滚演练：`backup`（升级前）→ 制造失败候选 → `rollback --bundle <升级前快照> --target <state>`；确认失败目录保留、目标可启动；失败时按非零判断，不降期望。
6. 负例：非空目标 restore、损坏/版本不符 bundle、未知/陌生进程 stop、端口占用、Node/ABI 不符。

## 6. main 的待办（D 已提交 RFC 的部分）

- **GAP-D1**：生产 HTTP 入口同源静态服务 + first-run/config；到位后删除 launcher 的 `/v1` 代理。
- **GAP-D2**：恢复态启动的 reconcile 模式（不自动消费队列/不重发 begin/deliver/answer）。
- **GAP-D5**：`pnpm install` 重新生成 root lock，提交 `packages/portability`、`apps/launcher` importer；否则 E 的 frozen install 会失败。
- 复核并集成 `5d32b30`、`8035492`、`84d407f` 及 D4/D5 提交；D 只 push 本分支，未改共享锁/迁移/契约。

## 7. 证据与限制

- `tools/distribution/reports/zero-model-smoke.json`：28 步零模型 smoke（build/first-run/start/static/proxy/status/reuse/backup/verify/stop/restore/import/login/rollback/再启动）。
- `tools/distribution/reports/install-smoke.json`：安装层 smoke。
- `tools/distribution/reports/execution-status.json`：阶段、commit/base、命令、结果、阻断。
- 限制：仅 darwin/arm64 实测；同机安装模型；个人 native 路径 NOT_TESTED；真实浏览器视觉验收由 E 独立完成；连续无界写入可能使 SQLite 在线备份重启（已测有界并发写）。
