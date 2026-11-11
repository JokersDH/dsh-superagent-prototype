# Agent D：保留个人版模式的升级与恢复整包

继续`/Users/hh/Desktop/joker/superagent-agent-d`、`codex/g3-local-distribution`。读本轮[README](README.zh-CN.md)、[0029](../../docs/rfcs/WP-16/0029-wave-08-product-closure-and-reviewed-inputs.md)。仅launcher/distribution/portability，真实模型0；不改main授权、A迁移或E断言。

本轮不重造已有双binary升级框架。eca5674的fresh-source null已修、两个真实不同tar存在；新目标要在main集成source上重冻，旧E安装组合不等于最新目标独立准入。大成果是实际personal模式、进程、指针和数据一致的升级/恢复路径。

可先消费main b436fde的提案UI与GET /v1/recovery/activations/:id，见[0030](../../docs/rfcs/WP-16/0030-wave-08-proposal-workbench-and-source-audit.md)。该GET核对A生产facts/原receipt，但固定not_granted/startupAvailable=false，不是target启动授权。schema15已进入main，最终target/升级mode准入仍独立；保留新个人预览5186/8802。

## D1 先修模式切换与未知进程反例

合并main，升级启动不得固定--fixture：保留原personal/fixture模式、项目/state/profile/端口与实例身份，无法核对就拒绝，不静默降级。无native版本可用也不自动换fixture。

upgrade/recover/rollback统一核对精确owned进程：验证失败但PID仍活时阻断，不能仅换指针。加真实launcher消费者断言，不只检查argv字符串；personal测试只做非计费准备/模式/拒绝，不启动模型。先push可消费修复checkpoint。

## D2 关闭失败目标残留与中断窗口

target_unhealthy注入在spawn后先证明自己启动的目标进程树停止，再恢复指针/实例记录；真实健康失败同规则，不能只清自己测试根掩盖残留writer。无法证明停止时保留不确定状态，不重启旧writer。

覆盖备份后、停止后、pointer切换前/后、目标启动后响应丢失、health已通过但实例未落盘等窗口，重入保持同操作身份。断言进程/模式/指针/data四者一致；只动可证明属于本次operation的临时目录/子进程。

## D3 做准确的schema兼容与数据保护验证

旧“不兼容binary”因release_artifact_missing退出不算schema证据。先验证产物/依赖/manifest完整、可执行，再用真实旧schema reader打开更高schema状态，断言准确不兼容code和未启动writer。

升级后新增数据，再测binary rollback/兼容读取/不兼容拒绝。数据不自动恢复旧备份、不丢新记录；明确选择备份恢复另记数据操作并保留原state。A当前schema未集成时先做诊断拒绝和fixture，不能称新schema升级已测。

## D4 从main冻结集成source构建新目标

提交D1–D3源码供main逐段集成；拿main冻结的干净来源（含已准入A/C与网页）构建target，记录实际source/build/平台/ABI/schema/依赖闭包/tar SHA。基线从现有真实产物选定，不只改tag。

把baseline/target作为显式输入交E，保留旧schema13双tar的历史结果。旧baseline若不支持新配置根初始化，明确使用其合法初始化流程或另选干净基线；不手工补manifest后假称cold-install通过。

## D5 消费main恢复目标激活并完善用户操作

只有main实际source权威/descriptor/target协议发布后才接start/recover，旧state保持只读，新空state不继承旧queue/native会话/凭据。单独本地precondition gate不能授权；sourceReceipt JSON不是便携启动token。

cover计划漂移/过期、source事实缺失、目标半准备/错根/链接、进程未知、重复确认/重启/再恢复。用户操作/doctor能说明实际安装/模式/状态和下一动作，不要求用户手改DB或marker。等main期间继续D1–D4，不无限扩展模拟授权框架。

## D6 冻结安装物与独立验收recipe

交E同一版本的两tar、hash/source/build/schema、真实升级/回退/恢复命令与已知限制。main先给source、你先给bytes，E最终准入在后，不构造循环等待。

维护`tools/distribution/reports/wave08-status.json`，各结果精确到模式和artifact；没有cross-machine/native/恢复target实测就单列。先checkpoint后连续整包，只push原分支，保留用户六组服务。
