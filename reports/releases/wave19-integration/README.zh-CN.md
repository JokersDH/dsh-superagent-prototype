# Wave19主线：双版本快照消费者

源码9856124，2026-11-13，完整范围见[0052](../../../docs/rfcs/WP-16/0052-versioned-snapshot-consumer-checkpoint.md)。接入A已验证的版本专属13/21族配方与双格式verify，默认reader/create仍v1、显式formatVersion2才新格式；非法版本提前拒绝。

保留现有非null/safeInteger/≥1及required schema guard，避免候选metadata0/1.5回退。验证只读对应配方一次，不重复扫legacy；旧v1 manifest形状和完整golden摘要不变。无DB迁移、新ledger、队列消费或启动权限。

双版本14+schema7=21PASS，加实际source14组合35PASS；主线storage87/workflows93、typecheck/build及product strict通过，独立review定向21/21未发现新实质问题。真实历史genuine-v1-evidence.json包含完整13族/fixture/source哈希，无DB/用户内容；不是改标签的新v2。

普通installed651和B normal控制的本轮独立准入另见[admission](../wave19-admission/README.zh-CN.md)，不能替代本source的安装证据。D b911早于本模块；后续实际字节变化再准确冻结，docs-only不重冻。private启动许可、业务恢复消费者、target及restored-personal明确只读绑定仍未交。十二实例未重启/预览不自动更新，真实model/native0。
