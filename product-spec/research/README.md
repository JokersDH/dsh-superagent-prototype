# 共享调研证据与重新采集

本目录只跟踪可移植的观察摘要和一手来源索引。`observations.json` 区分本机版本、静态证据与未运行的能力。

`.artifacts/`、`research/sources/` 内完整网页和本机 schema 是可选缓存，不是新 clone 的必需输入。正式 Driver 作者应从自己测试的产品版本生成 schema/脱敏 fixtures，并写入该 Driver 自己的 source-lock/兼容报告，不能把历史缓存当当前版本保证。

| 对象 | 一手入口 | 使用方式 |
| --- | --- | --- |
| core | 本仓 `src/core/`，固定 commit `8c32a9dc5d72c033816c6a8110b37f40cf94fba4` | G0 从固定源码提取，保留 MIT 和 digest |
| Codex | [官方 app-server](https://developers.openai.com/codex/app-server) | 对实际 CLI 导出 schema，绑定 CLI/Driver/schema/config 身份；无须启动模型任务来导出 |
| DSH | [官方 CLI](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md) | 核对安装版 `acp` profile，master 只作入口，不外推能力 |
| ACP | [官方 TS SDK](https://agentclientprotocol.com/libraries/typescript.md) | 固定 SDK stable v1 入口和 wire；TCK 不作完整兼容认证 |
| ZCode | [固定源码](https://github.com/zai-org/ZCode/tree/aac4755666d09fdcd70272fcf063c077a639015f) | 首先验证安装版对应关系；source CLI 与安装版不同，不能直接认定兼容 |
| SQLite | [WAL](https://www.sqlite.org/wal.html#walreset)、[backup](https://www.sqlite.org/backup.html) | 测实际 binding/engine，入场版本不代替恢复测试 |
| Hono | [Node adapter](https://hono.dev/docs/getting-started/nodejs)、[streaming](https://hono.dev/docs/helpers/streaming) | 使用官方 adapter/helper，持久 cursor 和认证仍由产品实现 |

论文与创新假设的一手链接和限制在 [06 学习与评估](../06-learning-and-evaluation.zh-CN.md)。仓库之外的 CAC 源码是 G6 可选输入，拿不到时明确 NOT_TESTED，不阻止 G0–G4。
