# tools/distribution — 构建、发行清单与零模型 smoke

Owner：Agent D。这里是无依赖（仅 Node 标准库 + 仓库内 pnpm 脚本）的发行工具；不是 workspace 包。

## 命令

```sh
# 构建 console 静态产物 + 运行时包 dist，写 <config-root>/release.json（pa-release/1）
node tools/distribution/build.mjs --install-root . --config-root <私有一致目录>

# 零模型安装 smoke：build → first-run → doctor（不启动 daemon）
node tools/distribution/smoke-install.mjs

# 完整内部试用 smoke：build → first-run → start → 静态页+健康 → backup → stop → verify →
# restore 到新目录 → start 恢复实例 → rollback 演练（后续阶段交付）
node tools/distribution/smoke.mjs
```

`build.mjs` 的 stdout 只输出机器可读摘要（`--json`），pnpm/vite 日志走 stderr。它校验 Node
`>=24.21.0 <25`、加载原生 SQLite binding、记录平台/ABI/SQLite/commit/artifact 摘要，并在写盘后
自检全部 artifact 摘要。

## 发行清单 `pa-release/1`

字段：`buildId/createdAt/source{commit,branch,dirty}/producer{node,pnpm,sqlite,productSchema,platform,arch}/build{consoleMode,consoleRoot}/artifacts[{path,bytes,sha256,kind}]/admission{node,platform,arch,sqlite,abi,tested}/limitations`。

`pa start` 只消费该清单：缺清单、artifact 缺失/大小不符、Node/ABI 不符都 BLOCKED，不回退 Vite。
清单不含凭据、账号 home、native session、模型 key 或私有绝对用户路径（`source.commit` 为例外）。

## 证据

- `reports/install-smoke.json`：最近一次零模型安装 smoke 的 case/步骤/退出码/平台。
- `reports/zero-model-smoke.json`：完整试用 smoke（后续阶段）。
- `reports/execution-status.json`：D 包阶段、commit/base、实际命令、证据、阻断。

平台矩阵：darwin/arm64 为实测候选；macOS x64、Linux、Windows 全部 NOT_TESTED。同机安装模型
（checkout + frozen install + 一次 build）见 WP-12 RFC。
