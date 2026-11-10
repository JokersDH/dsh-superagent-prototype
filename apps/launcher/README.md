# `pa` — 本机个人 Agent 助理启动器

Owner：Agent D（`codex/g3-local-distribution`，task `agent-tasks/product-wave-03/agent-d-delivery.zh-CN.md`）。
这是**薄 launcher**：不实现产品 HTTP 主入口、不写数据库、不做模型调用；产品命令/问题/完成仍走
`apps/coordinator/product/demo.ts` 的既有认证 loopback API。

## 快速开始（macOS arm64 已测候选）

```sh
pnpm install --frozen-lockfile        # 包内新增 workspace 依赖由 main 生成 root lock
node apps/launcher/bin/pa.mjs first-run
node apps/launcher/bin/pa.mjs build   # 每次源码更新后执行一次
node apps/launcher/bin/pa.mjs start   # 打印本机网页地址
node apps/launcher/bin/pa.mjs doctor  # 只读诊断
node apps/launcher/bin/pa.mjs stop

# 完整备份 / 迁移
node apps/launcher/bin/pa.mjs backup --out ~/backups/state.pab
node apps/launcher/bin/pa.mjs verify-backup --bundle ~/backups/state.pab
node apps/launcher/bin/pa.mjs restore --bundle ~/backups/state.pab --to ~/pa-restored
node apps/launcher/bin/pa.mjs rollback --target ~/pa-restored   # 用最近已验证快照
```

运行时不启动 Vite dev server、不重编译整仓；`start` 只消费 `pa build` 记录的 release manifest。

## 命令与退出码

| 命令 | 作用 | 退出码 |
| --- | --- | --- |
| `first-run` | 创建私有根、写非秘密 launcher 配置、只读探测执行器 | 0 |
| `build` | 构建运行时包 `dist` + console 静态产物 + 执行入口，写 `pa-release/1`；`--output` 产出 staged install 闭包 | 0 / 2 |
| `stage` | 构建并产出可搬迁的版本化 staged install 闭包（`install.json`+`bin/pa`+`app/`+`var/`） | 0 / 2 |
| `start` | 启动或复用本机实例，打印网页地址 | 0 / 2 |
| `status` | 实例记录 + 真实进程身份 | 0 运行且已验证 / 1 记录存在但不可信 / 2 未运行 |
| `stop` | 按已验证身份优雅停止；超时如实报告未静止资源 | 0 / 1 / 2 |
| `doctor` | 只读诊断 | 0 READY / 1 DEGRADED / 2 BLOCKED |
| `backup` | 完整备份 bundle（一致 DB 快照 + 引用产物 + 必要配置） | 0 / 2 |
| `verify-backup` | 只校验 bundle，不恢复 | 0 / 2 |
| `import-bundle` | 校验并登记已有 bundle | 0 / 2 |
| `restore` | 恢复到新私有目录，不覆盖活跃 state、不自动启动 | 0 / 2 |
| `rollback` | 用升级前快照回滚 | 0 / 2 |

所有命令支持 `--json`；根目录可用 `--install/--config-root/--data-root/--state/--cache-root/--logs-root/--workspace-root`
或 `PA_*_ROOT` 覆盖。`--state` 是 `--data-root` 的别名（它就是 coordinator 的 state 目录）。

## 安全与身份规则

- 私有根必须 0700、属于当前用户、非符号链接，且默认在 checkout 之外。
- `start` 复用前核对 pid + 进程启动时间 + cwd + 命令行 + uid + 两个 LISTEN + `/v1/health`；任一不符
  不 kill 未知进程。
- `stop` 只对已验证实例发 SIGTERM；超时返回 `stop_timeout_resources_alive` 与非零码，不假装已静止。
- 网页关闭不影响 daemon；模型 key 只经已认证本机网页设置提交，CLI/日志/发行清单不回显、不存储。
- 不复制他人在账号 home 中的 native 认证；不升级全局 Node/agent。

## 第四轮增补（身份、闭包、恢复门禁）

- **身份**：`start` 先解析期望 `install/state/mode/access/ports/buildId/startupMode`；不一致返回
  `instance_conflict`（列出差异），先 `pa stop` 再切换。并发 start 由 `start.lock` 串行化，只有一个
  赢家（输家 `start_in_progress`）。launcher/API 子进程按精确 argv（`--state` 精确 token，不做子串
  匹配）、启动时间、uid、ppid、cwd、监听与 health 校验；launcher 被 SIGKILL 后 `status=UNVERIFIED`，
  `stop` 只结束可核实孤儿，陌生活 PID 不发送信号。
- **staged install**：`pa build --output <dir>` / `pa stage --output <dir>` 产出闭包；`<dir>/bin/pa`
  默认 roots 在 `<dir>/var`。闭包 startup 校验实际执行字节 sha256、运行依赖 digest、console HTTP
  stamp；同长度篡改或旧 fixture console 均 BLOCKED。迁移后（原路径删除）已测 516 个运行模块全部来自
  闭包；跨 OS/架构/ABI 不声明。
- **恢复只读**：检测 `restore-report.json` 后显式请求并核对 `recovery_readonly`；marker 不删除、无
  绕过开关；恢复库旧队列/答案/parked/死亡 writer claim 在首次启动后逐行不变。
  BLOCKED：当前 main 恢复组合遇到恢复库 `native-projects.json` 会抛 controlled-fixture grant 错误
  （见 `docs/rfcs/WP-12/0004` 与 `tools/distribution/repro-recovery-project-binding.mjs`）；修复前
  带项目绑定的恢复库不能只读打开，D 不改 main 代码。

## 恢复/回滚语义

- `restore` 先完整校验 bundle，再解包到目标同级的私有 staging、逐项再哈希、写
  `restore-report.json`，最后原子 rename 到目标；目标必须不存在或为空，活跃 state 永不被覆盖。
- 路径只在显式 `--map-path /old=/new` 时重写；其余进入 `pendingRebind`。旧 native 环境/认证/
  签名 receipt/进程身份不会变成新机器权限，恢复后必须重新核对 `requiresRevalidation`。
- `restore` **不启动 daemon、不消费队列、不重发 begin/deliver/answer**；启动恢复实例是操作者
  显式 `pa start`，并与 main/A 的恢复启动模式（RFC GAP-D2）衔接。
- `rollback` 先验证快照，再把当前 state 改名为 `<state>.failed-<时间>` 保留现场，恢复失败会把
  原目录放回；不把 rename 成功当已回滚。
- token 访问模式：`start --require-login`，用 `<data>/bootstrap.key` 在网页登录（不回显、不写
  localStorage）。

## 零模型 smoke

```sh
node tools/distribution/smoke.mjs          # 28 步：build/first-run/start/static/proxy/status/reuse/
                                            # backup/verify/stop/restore/import/login/rollback/再启动
node tools/distribution/smoke-install.mjs  # 安装层：build + first-run + doctor
```

## 已知限制（NOT_TESTED）

- 只有 darwin/arm64 + Node 24.21.x 是实测候选；其它平台/架构 `pa doctor` 报 WARN/NOT_TESTED。
- 同机安装模型：`node_modules` 与原生 SQLite binding 不是跨机可搬运证据。
- 恢复后的实例启动需要 main/A 的恢复模式接线（RFC GAP-D2）；`restore` 自身不启动、不重发业务。

接口细节与待接入 port 见 `docs/rfcs/WP-12/0001-local-distribution-rfc.zh-CN.md`。
