# 主线发行源码入口

本仓现已包含启动器、备份恢复模块和完整构建/stage/freeze运行工具，见 [0060](../rfcs/WP-16/0060-main-ordinary-distribution-source-integration.md)。这是 macOS arm64、Node 24.21.x、ABI137 的源码集成检查点，独立安装验收须绑定实际冻结包。

## 开发者入口

```sh
pnpm pa help
pnpm check:distribution
pnpm build:distribution --config-root /absolute/new-private-config --output /absolute/new-install --json
```

构建输出目录使用全新绝对路径，不能填写已有个人state、profile或旧安装。构建只生成静态资源和安装闭包，不启动服务，不调用模型。`pnpm pa --help`列出现有命令；`pnpm pa help review-restored`与`pnpm pa review-restored --help`提供只读恢复审阅的具体参数，不创建私有状态或执行任务。

`apps/launcher/bin/pa.mjs` 是实际CLI，`apps/launcher/lib/` 是进程/实例/安装编排，`packages/portability/` 是备份、校验、恢复与平台根目录。`tools/distribution/build.mjs` 构建所有运行包和静态网页，`stage.mjs` 将其与完整外部依赖复制成同机器安装闭包，`freeze-install.mjs` 将安装目录冻结为可交给E的tar及摘要。

## 验收边界

导入的 D README 保留历史设计与案例链接。历史live验证脚本仍在D原工作树，本次不随运行源码导入；特别是新同Store验证脚本的异常进程清理尚待修正。不要据旧报告、另一个包或源码测试宣称当前安装包已通过。

安装包只读审阅需用户明确选择恢复数据，备份与旧凭据不能授予业务执行权。普通安装与私有启动许可、原生恢复、目标激活和BLOCKED实验各自单独验收。现有十二组用户服务不因源码合入而重启或迁移。
