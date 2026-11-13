# Wave23主线：完整个人发行源码已接入

源码 `8c8fdefa12ff04d524eec8424efe3a90bc09a6fd`，见 [0060](../../../docs/rfcs/WP-16/0060-main-ordinary-distribution-source-integration.md) 和 [运行指南](../../../docs/guides/main-distribution.zh-CN.md)。接入D固定a9b的launcher、portability与build/stage/freeze共71文件，保留原HTTP/UI/授权。main新增 `pnpm pa`、`pnpm build:distribution`、`pnpm check:distribution`，离线依赖只新增两个workspace importer。

portability strict/build通过，52项测试；launcher60项测试通过。完整15运行包/HTTP静态console/8外部依赖构建与自校验成功。提交后的clean source stage成功，build48eee1409b617c6e、6747项；包内实际CLI help退出0。先前dirty构建仍保留，不贴clean标签。

这里只生成安装闭包，没有启动、冻结或对新包作E独立准入；不授私有启动、原生恢复或target。已有十二实例未重启，vendor/native/model0，schema18/无迁移。UI尚未消费来源诊断。

逐文件来源及构建记录见 [status.json](status.json)。D的所有live probe/历史报告未合入，异常清理等在D包整改。下一步 [主线任务](../../../agent-tasks/product-wave-23/main.zh-CN.md) 继续来源界面与合格业务attach消费，A–E按 [转发话术](../../../agent-tasks/product-wave-23/forward-prompts.zh-CN.md) 执行。

任务静态校验通过：六个owner、60阶段、32依赖节点、153本地链接，无循环或拥有路径冲突；JSON及diff检查通过。该静态结果不授运行或发布准入。
