# Wave17主线：实际source确认已交

最新运行source`6050b4b`在e32a3fc上增加实际Store root绑定，最终14项新HTTP/进程及clean组合106PASS；下文保留首次发布的e32/13/105检查点，完整最终数字以status.json为准。

源码`e32a3fc`，2026-11-13，详细接口/约束见[0048](../../../docs/rfcs/WP-16/0048-actual-source-confirmation-checkpoint.md)。真实`/v1/recovery/source/prepare`与`/confirm`已接ProductRecovery、A事实/原receipt及HTTP认证。准备无写，确认同事务postguard使用exact ignoreCommitted，新源变化/额外写拒绝并回滚。原token核对已完成事实不重新授权。

新13项实际HTTP/SQLite测试包括两个独立产品进程SIGKILL前后窗口；clean e32a3fc恢复、候选和提案组合105PASS，原contracts230、product/http strict、generated检查通过，wire hash仍74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d。新增私有同步postguard的thenable问题经独立review发现后修复，原复现已resolved，无fact/event/receipt遗留。

本次没有新数据库迁移/ledger/执行生命周期、target materialize或启动。所有结果not_granted/startupAvailable=false，旧queue保持held。machine/policy摘要不是物理quiescence证明；私有许可、B真实业务恢复、D完整资源门、target activation、installed release分别待准入。源确认尚无UI表单；旧十二服务没有重启/更新，自动真实model/native0。

A/C/D/E下一包可直接消费已发布source确认，不再因缺入口停整个包。新D97cace7是之前的建议版字节，早于本检查点，不能重贴source确认能力。断言/证据见`status.json`，A–E本轮候选验收另见[admission](../wave17-admission/README.zh-CN.md)。
