# WP-12 / D：本机发行、完整备份与迁移 RFC

日期：2026-11-10。Owner：Agent D（`codex/g3-local-distribution`）。基线：`origin/main` / `c3f018e`，合并后检查点 `3957e30`。
本轮拥有路径：`apps/launcher/`、`tools/distribution/`、`packages/portability/`（含自有 tests/fixtures/docs/reports）。本文是 D 包的最小发行/迁移 RFC，状态 **PROPOSED**；它是消费约定和接口缺口记录，不是发行通过声明。

## 1. 审计事实与边界

2026-11-10 实际核查（macOS arm64，本机）：

| 项 | 实测值 | 影响 |
| --- | --- | --- |
| Node / pnpm | v24.21.0 / 11.7.0（`engines`: `>=24.21.0 <25`） | 单一受测运行时；其它 Node 版本 NOT_TESTED |
| SQLite | `better-sqlite3` 13.0.3，引擎 3.53.4，`allowBuilds` 关闭自动下载 | 原生 binding 必须与本机 Node ABI 匹配；不静默切换 |
| 前端 | `apps/console` Vite 8.2.2 dev server + `dist` 静态构建 | 当前 `pnpm start` 运行时依赖 Vite dev server |
| 产品入口 | `apps/coordinator/product/demo.ts`（main 拥有）；loopback 两端口，`--console-origin` 白名单 | D 不另建产品 HTTP 主入口，只复用该组合入口 |
| 私有状态 | `state.sqlite`(+WAL)、`artifacts/`、`native-projects.json`、`environments/`、`*.key`、`workbench.json`、`scratch-project.json` | 备份范围需显式选择，不能“打开 SQLite 就算完整备份” |
| 模型/认证 | 模型配置 `~/.config/superagent-personal/model.json`，原生认证在用户各自 home | 不进备份、不进浏览器 DTO/URL/日志 |
| 平台 | 只有 darwin/arm64 有原生准入证据 | 其它平台保持 NOT_TESTED，不承诺现成可用 |

**不做**：把单用户 loopback 改绑 `0.0.0.0` 当多人服务；复制账号 home/native session；新增第二 SQLite writer；改生产 SQL/迁移（A 唯一 owner）；改 root 配置/锁（main 唯一 owner）；把 fixture 结果当原生兼容。

## 2. 发行形态决定

采用**构建一次 + 静态资源 + 薄 launcher**：

```text
pa first-run            私有根目录 + 非秘密本机配置 + 环境诊断
pa build                构建运行时包 dist 与 console 静态产物，写 release manifest
pa start/status/stop    复用 apps/coordinator/product/demo.ts 产品入口
pa doctor               只读环境/实例/端口/凭据/执行器诊断
pa backup/verify/restore/rollback/import
```

- 运行时不启动 Vite dev server，也不每次重编译整仓；只消费已构建 `dist`。
- launcher 起一个 loopback 静态服务：只提供只读构建产物，并把 `/v1/*` 反向代理到 main 的认证 loopback API（同源，避免 CORS/摘要变化）。**不是产品 HTTP 主入口**：不实现业务路由、不写 DB、不产生 `TrustedActor`。main 的后续同源静态服务到位后，该代理可整体删除（见 §5.1）。
- 桌面壳只保留薄 launcher 接口语义（start/stop/status），业务不依赖 Electron/Tauri API；本轮不引入壳依赖。

### 2.1 构建产物布局

`tools/distribution/build.mjs` 构建并产出：

```text
<repo>/apps/console/dist/**          # VITE_CONSOLE_MODE=http 静态产物
<repo>/packages/<pkg>/dist/**        # contracts/orchestrator-core/effects/storage/questions/
                                     # application/workspaces/verification/environment-preparation/portability
<config>/release/<buildId>/release.json   # 发行清单（也复制到 --output 目录，便于归档）
```

`release.json`（版本化 `pa-release/1`）：`format/formatVersion/buildId/createdAt/source{branch,commit,base}`、`producer{product,version,node,pnpm,sqlite,productSchema,platform,arch}`、`build{distDirs,bundlerVersion,consoleMode}`、`artifacts[{path,bytes,sha256,kind}]`、`admission{platform,node,sqliteAbi,checks:[]}`、`limitations[]`。清单不得含凭据、绝对用户路径或账号信息。构建失败/缺产物时 `start` 明确 BLOCKED，不回退到 Vite。`--output` 只做归档副本；运行仍按清单校验 in-place `dist`（同机模型，跨机不可搬运声明见 §2.3）。

### 2.2 平台支持矩阵（本轮冻结）

| 平台/架构 | 状态 | 证据边界 |
| --- | --- | --- |
| macOS / arm64 | **测试候选** | 本机 Node 24.21.0 + SQLite 3.53.4 实际 load/build/start/backup/restore |
| macOS / x64 | NOT_TESTED | 无真实环境，不声明 |
| Linux x64/arm64 | NOT_TESTED | XDG 根目录仅实现未测 |
| Windows | NOT_TESTED | 进程身份（`ps`/`lsof`）、路径分隔符未实现替代 |

Node 版本不在 `engines` 内、原生 binding 加载失败、SQLite 版本不符均 BLOCKED，不静默降级/切换 binding。

### 2.3 安装模型与限制

内部试用安装 = 同一台机器的源码目录 + `pnpm install --frozen-lockfile` + `pa build`（一次性）+ `pa start`。运行不依赖 Vite，也不重编译整仓；但 `node_modules`、原生 binding 和 OS/arch 是**同机**前置，不能把构建目录复制到别的机器宣称可用。真正可分发安装包/签名、自动启动、卸载保留策略属后续发行工作，本轮只交 manifest、命令与诊断；相关行标 NOT_TESTED。E 在“新目录/新账户”验收时按此前提执行，缺真实跨机器条件时明确 NOT_TESTED。

## 3. 根目录、首次运行与实例身份

### 3.1 根目录（`pa-backup` 与 launcher 共用）

`resolveRoots()` 返回六个绝对根，支持 `PA_*` 环境变量和显式参数覆盖；所有私有根要求 0700/属主/非符号链接：

| 根 | macOS 默认 | 内容 |
| --- | --- | --- |
| `install` | 仓库根（或 `PA_INSTALL_ROOT`） | 只读构建产物与清单 |
| `config` | `~/Library/Application Support/dsh-superagent/config` | launcher 非秘密配置、instance/release/backup 索引 |
| `data` | `.../dsh-superagent/data` | 产品私有 state（`state.sqlite`、`artifacts/`、`native-projects.json`、`*.key`） |
| `cache` | `~/Library/Caches/dsh-superagent` | 可丢弃缓存/暂存 |
| `logs` | `~/Library/Logs/dsh-superagent` | 有界日志 |
| `workspace` | `.../dsh-superagent/workspaces` | 每 attempt 派生 worktree，非用户项目 |

私有根默认不在 checkout 内；`data`/`config`/`logs`/`workspace` 不得位于 `install` 内。state dir 沿用 main/A 现有语义（data 根即 daemon `--state`），不新增数据库。

### 3.2 首次运行

`pa first-run` 只做：创建/校验私有根、写非秘密 launcher 配置（路径、端口、模式、来源 commit）、只读探测执行器（`codex` 是否存在及版本）、打印下一步。**不在 CLI 收集 API key/模型 key**；显式模型设置只经 main 的已认证本机入口（现 `POST /v1/assistant/model`）提交，保存后不回显、不写前端持久存储。不复制他人账号、不升级全局 Node/agent、不改原生 profile。

### 3.3 实例记录与真实进程身份

`<config>/instance.json`（`personal-product-instance/1`，0600）：`pid/processStart/apiPid/consolePid/consoleURL/apiURL/state/mode/install/buildId/startedAt`。`start` 复用前必须同时满足：记录的 `processStart` 与 `ps -p` 一致、cwd 为 install 根、命令行是 `apps/launcher/bin/pa.mjs start`、uid 一致、两个端口的 LISTEN 属主与 pid 对上、`/v1/health` 可达。任一不符 → 不 kill 未知进程，报告 `instance_identity_mismatch`。`stop` 超时（默认 8s）如实返回 `still_alive` 与非零退出码，不把 SIGTERM 当已静止；网页关闭不影响 daemon。

## 4. 完整备份 bundle（`pa-backup/1`）

单文件 = 确定性 `tar.gz`（固定头：mtime 0、uid/gid 0、mode 0600、无 PAX/GNU 扩展、路径 <100 字符、条目按字节序排序），内容：

| 条目 | 来源 | 说明 |
| --- | --- | --- |
| `manifest.json` | D 生成 | 版本化清单：producer、source、selection、pathMap、entries(sha256/bytes/kind)、artifactRefs、database 校验、limitations |
| `state/state.sqlite` | A 的 `backupDatabase`（SQLite 在线备份 API） | 含 WAL 的一致快照；随后 `verifyDatabase` 记录 integrity/foreign_key/productSchema |
| `artifacts/<id>` | 数据库 `artifacts` 引用的内容寻址文件 | 逐项校验 sha256==digest；缺失/损坏 → backup FAIL，不静默跳过 |
| `config/native-projects.json` | 项目绑定（路径/检查/环境设置） | 仅路径和设置，无密钥；恢复时需显式路径映射并重新准入 |

默认**排除并记录原因**：`*.key` 凭据、`workbench.json`/instance 记录、`scratch-project.json`、`environments/`（机器绑定授权，恢复后必须重新探测）、`workspaces/`（派生 worktree）、未知文件、账号 home、模型/native 认证、socket/PID、缓存与 `node_modules`。工作区/项目内容不隐式打包（选择项默认关）。备份过程不发送任何模型/业务命令。

一致性：用 A 的 port 在 WAL 活跃时取快照；写入期间备份应得到可恢复的一致库（事件序列连续、integrity/foreign-key 通过），恢复副本不自动 dispatch/重发业务。负例必须覆盖：缺失 artifact、artifact digest 不符、截断/损坏 gzip、清单摘要不符、格式/版本不匹配、路径穿越/绝对路径/危险链接、超量条目/解压炸弹、重复条目、目标非空/活跃 state。

## 5. 恢复、迁移与回滚

`pa restore --bundle <file> --state <新目录> [--map-path old=new]`：

1. 先完整校验 bundle（结构、安全、摘要、DB verify），再在目标父目录的 staging 中解包/再校验；
2. 目标必须是新私有目录（不存在或空目录），不得是活跃 state、install 根或源 state；绝不覆盖非空目录；
3. 项目路径只在显式 `--map-path` 时重写 `native-projects.json`，否则保留并标记 `pending_rebind`；内容寻址 artifact/patch/evidence 保持原身份；
4. 写 `restore-report.json`：bundle digest、producer、entries 校验、路径映射、`requires_revalidation[]`（native 环境/认证/策略、旧 writer/进程身份、签名 receipt 一律不因搬迁变成新权限）、limitations；
5. 原子 rename 到目标；**不启动 daemon、不 replay begin/deliver/answer、不发送模型业务**。启动恢复后的 state 是操作者的显式 `pa start`，不是 restore 的副作用。
6. `pa rollback --state <dir> [--bundle <file>|--last]`：用升级前已验证快照恢复到新目录并原子换入，当前失败目录移到 `<state>.failed-<ts>` 保留；失败则回退到可启动状态，报告具体失败原因。生产 SQL 只由 A 追加，D 不补行、不改库。

## 6. 需要的跨模块 port / 缺口（提交给 main 与 A）

| ID | Owner | 需求 | 现状/替代 |
| --- | --- | --- | --- |
| GAP-D1 | main | 生产 HTTP 入口同源提供 console 静态产物 + first-run/config 入口（构建产物根、settings 保存语义走现有已认证路由） | D 现在 launcher 内静态服务 + `/v1` 反向代理；main 到位后删除代理 |
| GAP-D2 | main/A | 恢复/重建启动模式：打开恢复后的 state 时**不自动消费队列/不重发 begin/deliver/answer**，由明确操作恢复 | 暂无入口；D restore 自身不启动 daemon，并在 report/launcher 标注 `requires_operator_start` |
| GAP-D3 | A | 公开只读 port：`listReferencedArtifacts()`（id/digest/bytes）+ 当前 writer/instance 状态摘要，供备份清单与“未知 writer”报告 | 暂由 portability 只读 SELECT `artifacts`/`writer_claim`/`coordinator_instances` 实现，标为 interim；A 提供后切公开接口 |
| GAP-D4 | main | launcher 端口/实例记录若与 `tools/dev` 合并，需冻结单一“本机实例”语义 | D 使用自有 `<config>/instance.json`，不与 `workbench.json` 混用 |
| GAP-D5 | main | root lock：新增 `packages/portability`、`apps/launcher` workspace importer | 本地 `pnpm install` 产生的临时锁差异不提交，请 main 重新生成唯一 root lock |

契约边界：bundle manifest、instance record、release manifest 是**发行本地格式**，不是公共产品 wire DTO，不进入 `packages/contracts`；不另建 Work/Ticket 生命周期。产品读/命令仍走既有公共 schema。

## 7. 测试与证据计划（模型任务 0）

| 阶段 | 证据 |
| --- | --- |
| D1 | roots/instance/manifest 单测；build+manifest 校验；零模型安装 smoke fixture |
| D2 | 真实 `pa start` 静态页面 + `/v1/health` + 停止/复用；identity mismatch 负例；doctor 输出 |
| D3 | WAL 活跃 + 并发写的一致性备份；artifact 缺失/损坏负例；bundle verify |
| D4 | 恶意 archive（穿越/绝对路径/链接/炸弹/重复）、非空目标拒绝、新目录恢复 + 路径映射、rollback 演练 |
| D5 | 重复零模型 smoke（build→first-run→start→backup→stop→verify→restore→start→rollback→stop）；release manifest；`tools/distribution/reports/execution-status.json` |

所有命令记录实际输入/退出码/证据路径；未执行平台/原生项明确 NOT_TESTED。E 独立在新目录消费同一命令；D 不改 E 断言。

## 8. 实施状态（2026-11-10，D 包交付）

日志：检查点 `5d32b30`（D1）→ `8035492`（D2）→ `84d407f`（D3）→ D4/D5 见分支后续提交。所有实测在同一 darwin/arm64、Node 24.21.0、SQLite 3.53.4 上完成，模型任务 0。

| 阶段 | 已交付 | 实际证据 |
| --- | --- | --- |
| D1 | roots 契约、`pa-backup/1` manifest、build/release manifest、`first-run`、`doctor`、install smoke | `node --test packages/portability/test/*.case.ts`（roots/manifest）；`tools/distribution/reports/install-smoke.json` |
| D2 | 静态 console + `/v1` 反向代理、真实进程身份、start/reuse/stop/status、有界脱敏日志 | launcher 15 项测试；`reports/zero-model-smoke.json` 中 static/health/config/status/reuse/stop/clean-exit |
| D3 | 确定性 tar.gz、一致快照（A port）、引用 artifact 复制校验、排除清单、backup/verify | portability 28 项测试（含恶意 archive、并发写一致性、缺/坏 artifact 负例）；smoke 中 backup-live/verify |
| D4 | 新目录恢复、显式路径映射、restore-report、import-bundle、rollback（保留失败现场） | portability restore 测试 4 项；launcher restore 测试 3 项；smoke restore/import/rollback/再启动 |
| D5 | 可重复零模型试用 smoke、发行清单、消费说明、状态报告 | `reports/zero-model-smoke.json`（28 步全 PASS）；本 RFC + `0002-consumption-guide` |

未测/边界（不宣称）：个人 native 启动路径（依赖 main/B 的原生准入）、跨机器/跨账户安装、Linux/macOS x64/Windows、真实浏览器视觉回归（E 独立执行）、恢复后自动去重/重放（按设计从不自动重放）。

待接入 port 仍为 §6 的 GAP-D1（main 同源静态/first-run）、GAP-D2（恢复启动模式）、GAP-D3（A 的引用 artifact 读 port；当前 interim 只读 SELECT 已在代码注释标注）、GAP-D5（main 重新生成 root lock）。D 未修改共享契约/迁移/root 锁/他人代码。
