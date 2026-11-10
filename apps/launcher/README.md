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
```

运行时不启动 Vite dev server、不重编译整仓；`start` 只消费 `pa build` 记录的 release manifest。

## 命令与退出码

| 命令 | 作用 | 退出码 |
| --- | --- | --- |
| `first-run` | 创建私有根、写非秘密 launcher 配置、只读探测执行器 | 0 |
| `build` | 构建运行时包 `dist` + console 静态产物，写 `pa-release/1` manifest | 0 / 2 |
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

## 已知限制（NOT_TESTED）

- 只有 darwin/arm64 + Node 24.21.x 是实测候选；其它平台/架构 `pa doctor` 报 WARN/NOT_TESTED。
- 同机安装模型：`node_modules` 与原生 SQLite binding 不是跨机可搬运证据。
- 恢复后的实例启动需要 main/A 的恢复模式接线（RFC GAP-D2）；`restore` 自身不启动、不重发业务。

接口细节与待接入 port 见 `docs/rfcs/WP-12/0001-local-distribution-rfc.zh-CN.md`。
