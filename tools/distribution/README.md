# tools/distribution — 构建、发行清单与零模型 smoke

Owner：Agent D。这里是无依赖（仅 Node 标准库 + 仓库内 pnpm 脚本）的发行工具；不是 workspace 包。

## 命令

```sh
# 构建 console 静态产物 + 运行时包 dist + 执行入口，写 <config-root>/release.json（pa-release/1）
node tools/distribution/build.mjs --install-root . --config-root <私有一致目录>

# 构建并产出可搬迁 staged install 闭包（install.json + bin/pa + app/ + var/）
node tools/distribution/build.mjs --install-root . --config-root <私有一致目录> --output <新安装目录>
# 仅导出 release manifest（兼容旧行为）
node tools/distribution/build.mjs --install-root . --config-root <私有一致目录> --release-output <目录>

# 零模型安装 smoke：build → first-run → doctor（不启动 daemon）
node tools/distribution/smoke-install.mjs

# 完整内部试用 smoke（28 步）：build → first-run → start → 静态页/健康/配置/status/reuse →
# live backup → verify → stop → offline verify → restore 到新目录 → 拒绝非空/损坏 →
# import → 从导入 id 恢复 → token 登录门禁 → 启动/停止恢复实例 → rollback 演练 → 再启动 → stop
node tools/distribution/smoke.mjs
```

`build.mjs` 的 stdout 只输出机器可读摘要（`--json`），pnpm/vite 日志走 stderr。它校验 Node
`>=24.21.0 <25`、加载原生 SQLite binding、记录平台/ABI/SQLite/commit/artifact 摘要，并在写盘后
自检全部 artifact 摘要。

## staged install 闭包 `pa-install/1`

`stage.mjs`（由 `--output`/`pa stage` 调用）复制真正执行的字节：coordinator/launcher/runner 源码、
所有 workspace 包 `src+dist+package.json`、flat 运行依赖（含本机 ABI 的 better-sqlite3 与
license）、console HTTP dist、`var/config/release.json`；写 `install.json` 记录 6000+ 文件 sha256、
依赖版本/digest/license、平台/Node/ABI、入口与限制，并自检后原子 rename。`--output` 不再只写
release.json。闭包移动后 `<dir>/bin/pa first-run/doctor/start/stop` 可用，默认 roots 在闭包
`var/`；跨机器/跨 ABI 不声明。

- consoleMode 由构建证明：构建写 `.pa-console-build.json`（mode=http + 文件集合 digest）；
  `--skip-console` 只允许复用 stamp 与磁盘完全一致的 HTTP build，否则构建失败。
- startup 校验 release artifacts 实际 sha256 + 运行依赖 digest + console stamp；同长度漂移/旧
  fixture bundle 均 BLOCKED。
- 跨模块阻断：`repro-recovery-project-binding.mjs` 复现 main 恢复只读 + 恢复项目绑定的 grant
  错误，证据在 `reports/wave04-blockers/`。

## 发行清单 `pa-release/1`

字段：`buildId/createdAt/source{commit,branch,dirty}/producer{node,pnpm,sqlite,productSchema,platform,arch}/build{consoleMode,consoleRoot}/artifacts[{path,bytes,sha256,kind}]/admission{node,platform,arch,sqlite,abi,tested}/limitations`。

`pa start` 只消费该清单：缺清单、artifact 缺失/大小不符、Node/ABI 不符都 BLOCKED，不回退 Vite。
清单不含凭据、账号 home、native session、模型 key 或私有绝对用户路径（`source.commit` 为例外）。

## 证据

- `reports/install-smoke.json`：最近一次零模型安装 smoke 的 case/步骤/退出码/平台。
- `reports/zero-model-smoke.json`：完整试用 smoke（28 步全 PASS，含 backup/restore/rollback/login）。
- `reports/execution-status.json`：D 包阶段、commit/base、实际命令、证据、阻断、下一消费者步骤。
- 每个 smoke 使用隔离临时 roots/端口；不触碰用户 5180/8796、5181/8797 服务，不发模型请求。

平台矩阵：darwin/arm64 为实测候选；macOS x64、Linux、Windows 全部 NOT_TESTED。同机安装模型
（checkout + frozen install + 一次 build）见 WP-12 RFC。
