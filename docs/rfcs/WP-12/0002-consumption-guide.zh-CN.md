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

---

## 8. 第四轮增补：staged install、恢复门禁与身份（2026-11-10）

### 8.1 可搬迁 staged install 闭包

```sh
PA="node apps/launcher/bin/pa.mjs"
$PA build --config-root <config> --output <新安装目录>   # 构建 + 产出闭包
# 或 $PA stage --output <新安装目录>
```

闭包结构：`install.json`（版本化文件/依赖 digest/许可/平台清单）、`bin/pa` wrapper、`app/`（coordinator/launcher/runner 源码、workspace src+dist、flat 运行依赖、console HTTP dist）、`var/config/release.json`。
普通同事在新目录：

```sh
<安装目录>/bin/pa first-run
<安装目录>/bin/pa doctor          # READY/DEGRADED/BLOCKED；不是 ADMISSION
<安装目录>/bin/pa start           # 默认 roots 在 <安装目录>/var，可用 PA_*_ROOT 覆盖
<安装目录>/bin/pa stop
```

- 闭包可整体移动/复制后运行（已测：移动后 516 个运行模块全部来自闭包，checkout 引用 0）；**不得跨 OS/架构/ABI 或跨 Node 版本复制后宣称可用**。`install.json` 记录 Node/SQLite/ABI。
- 闭包内 `pa build` 不可用（预构建闭包）；升级=构建/产出新闭包，再按 §3 备份→恢复→回滚流程迁移。
- startup 校验：release artifacts 实际 sha256、运行时依赖 package digest、console HTTP build stamp+digest；任一同长度漂移/旧 fixture console 都 BLOCKED（`release_artifact_missing`/`dependency_digest_mismatch`/`console_mode_mismatch`）。

### 8.2 实例身份与并发

- `pa start` 解析期望 `install/state/mode/access/ports/buildId/startupMode` 后才复用；不同请求返回 `instance_conflict`（列出 differences），先 `pa stop` 再切换。
- 同一 config 下并发 start 只有一个赢家；输家 `start_in_progress`（或 `instance_conflict`）。
- launcher/API 子进程按精确 argv、启动时间、uid、ppid、cwd、监听与 health 校验；launcher 被 SIGKILL 后 `status=UNVERIFIED`，`stop` 只结束可核实的孤儿；陌生活 PID 不发送信号。

### 8.3 恢复只读与重绑定/新授权（main 负责解除）

- 恢复产物带 `restore-report.json`；launcher 检测后显式请求并核对 `recovery_readonly`，marker 不删除、无“允许续跑”开关。恢复库含 queued begin/deliver、pending answer、assistant reply、parked verification、死亡 writer claim 时首次启动仍不消费队列（已测）。
- 显式 `restore --map-path /old=/new` 保留实体 id 并记录 `applied/pendingRebind/requiresRevalidation`；未映射路径不自动改写。
- **BLOCKED（main `RECOVERY-PROJECT-BINDINGS`）**：带 `native-projects.json` 的恢复库当前无法只读打开（恢复组合对恢复项目 scope `.` 抛 `Controlled fixture projects require the fixed src/ scratch grant`）。最小复现：`node tools/distribution/repro-recovery-project-binding.mjs`，证据 `tools/distribution/reports/wave04-blockers/recovery-project-bindings.json`。main 修复前：恢复库只用于无项目绑定的历史/诊断；不要删除 marker、不要自建执行授权。
- 恢复后的“重新绑定/重新验证/允许新执行”由 main 的恢复授权完成；D 不实现该开关。

### 8.4 E 的第四轮消费步骤

1. 在独立临时 root 运行 `$PA build --output <stage>`，移动 `<stage>` 到新路径（保留原 checkout 存在但不应被引用）；
2. 用 `<stage>/bin/pa first-run`/`doctor`/`start --fixture`/`status`/`stop`，记录 `install.json`、`startupMode`、真实命令与退出码；
3. 用 `NODE_DEBUG=esm` 或等价证据检查运行模块均来自安装目录；篡改执行文件/console bundle 必须 BLOCKED；
4. 按 §5 做 backup→verify→restore（只读）→显式 rebind→rollback；带项目绑定的恢复库当前标 BLOCKED（main port），不得把失败改成 PASS；
5. 真实 native/跨机器保持 NOT_TESTED；不修改 D 的断言或产品实现。

---

## 9. 第五轮增补：运行诊断、证据覆盖与支持矩阵（2026-11-10）

### 9.1 可复制流程（同一安装物）

```sh
# 构建并产出闭包（build 同时完成 console HTTP 构建与依赖摘要）
node tools/distribution/build.mjs --install-root . --config-root <config> --output <install>
# 或
node apps/launcher/bin/pa.mjs stage --output <install>

<install>/bin/pa first-run
<install>/bin/pa doctor          # READY/DEGRADED/BLOCKED（不是准入）
<install>/bin/pa start --fixture # 受控链路；个人模式需已准入作者执行器
<install>/bin/pa status
<install>/bin/pa backup --out <bundle>
<install>/bin/pa verify-backup --bundle <bundle>
<install>/bin/pa restore --bundle <bundle> --to <new-state>
<install>/bin/pa rollback --bundle <bundle> --target <state>
<install>/bin/pa stop
```

### 9.2 诊断/稳定错误码

| 场景 | code | 行为 |
| --- | --- | --- |
| Node/平台/ABI/SQLite binding 不匹配 | `runtime_incompatible` | 启动前拒绝；不回退 fixture、不替换 binding |
| 作者执行器缺失/版本不符 | `author_executor_unavailable` / `author_executor_version_mismatch` | 个人模式启动前拒绝；fixture 不受影响 |
| 作者私有认证缺失 | `author_auth_unavailable` | 只报告存在性/权限，不读取或回显内容 |
| 默认/显式端口占用 | `port_in_use` | 不停止未知进程，换端口 |
| 必需复核但缺 reviewer | doctor `review_executor=FAIL`/BLOCKED | 作者路径仍可用；不伪造复核完成 |
| 第二执行器接口未发布 | doctor `review_executor=WARN(no_executor_interface)` | 复核入口保持实验、默认关闭 |

### 9.3 证据覆盖（bundle/restore）

- bundle manifest 新增 `evidence`：`personal-evidence` digest + counts + `routingEvidence` 能力；
- restore 从恢复库重读 project settings/policy 快照、works、contracts/links、decisions、assistant
  state、artifact registry，与 manifest 逐类比较；不一致 → `evidence_mismatch`（目标不激活）；
- 旧 bundle 无 evidence → 报告 `not_recorded`，不补造 0；
- 路由建议/复核报告/执行结果当前无持久化（A `RoutingEvidencePort` 仅契约），manifest 标
  `routingEvidence.status=unavailable` 并列出所需端口（见 0005）。

### 9.4 支持矩阵

| 维度 | measured | NOT_TESTED |
| --- | --- | --- |
| 平台/架构 | darwin/arm64 | linux、win32、darwin-x64、其他机器 |
| Node | 24.21.x | 其他 Node 版本/ABI |
| SQLite | ABI 137、SQLite 3.53.4 | 其他 ABI/版本 |
| 执行器 | 受控 fixture；作者 Codex 存在性/版本/认证文件诊断 | 个人 native 端到端、第二执行器复核 |
| 恢复 | 新目录只读、证据逐字节/摘要校验、显式 rebind | 恢复后重新授权（main） |

安装物摘要：`tools/distribution/reports/wave05/install-summary.json`；完整证据：
`tools/distribution/reports/wave05-status.json`、`reports/wave05/`。

---

## 10. 第六轮增补：个人 Alpha 安装物、恢复消费与升级（2026-11-11）

### 10.1 冻结安装物

- 位置/摘要见 `tools/distribution/reports/wave06/install-artifact.json`（仓库外目录 + tar.gz，
  `install.json`/`release.json`/tar sha256、buildId、平台/Node/ABI/依赖闭包）。
- E 只从该冻结产物在新 root 独立执行；不得混用 D 旧包、main 新源码或另一分支 node_modules，
  不改 D/E 断言，不重启用户五组服务。使用临时端口/state/项目。

### 10.2 可复制普通路径

```sh
tar -xzf <wave06-alpha-install.tar.gz> -C <new-root>
cd <new-root>/install
./bin/pa first-run
./bin/pa doctor                 # READY/DEGRADED/BLOCKED；不是准入
./bin/pa start --fixture        # 作者执行器缺失时用 fixture 验证受控链路
./bin/pa status
./bin/pa stop
./bin/pa backup --out <pre-upgrade.pab>
# 新目录只读恢复：
./bin/pa restore --bundle <pre-upgrade.pab> --to <new-state>
./bin/pa recovery-status        # startupMode=recovery_readonly, authorization=BLOCKED(owner main)
./bin/pa start --fixture --data-root <new-state> ...   # 只读历史，业务 POST 422
./bin/pa rollback --bundle <pre-upgrade.pab> --target <state>
```

### 10.3 恢复新授权（main-owned，当前 BLOCKED）

`recovery-status` 只读投影恢复 marker、pending rebind/revalidation 与 main `inspect/prepare/commit`
接口需求；当前 main 未发布该接口，因此：

- 不删 `restore-report.json`、不加 force/allow-resume 开关、不重放旧队列；
- 不把旧 profile/writer/session 当新授权；
- 新工作授权步骤保持 `BLOCKED_RECOVERY_AUTHORIZATION`，owner=main，所需输入见
  `tools/distribution/reports/wave06/recovery-authorization-blocker.json`；
- D 提供 CLI/诊断/发行消费，不建立第二认证/密钥存储或调度器。

### 10.4 升级/回滚

`smoke-upgrade.mjs` 已测：pre-upgrade backup → 新 build 启动（升级）→ 升级后数据写入 →
rollback 到备份 → 原 project/work/artifact 与 evidence digest 恢复、升级后 revision 消失 →
新 build 仍可启动。回滚只恢复 state 快照，不降级已安装二进制；未来 schema 在 snapshot/restore
拒绝（`schema_unsupported`）。

### 10.5 未覆盖

A v13/routing/ReviewTiming 持久化与 C routing 实现未进入本 main（schema 12），bundle evidence
对未见规范标 unavailable；B 第二执行器/session 胶囊接口未进 main；个人 native 端到端、恢复新授权、
跨机器/ABI、第二协议复核均 NOT_TESTED/BLOCKED。
