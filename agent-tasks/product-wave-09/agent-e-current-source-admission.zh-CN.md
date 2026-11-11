# Agent E：当前来源的网页与托管升级独立准入整包

继续`/Users/hh/Desktop/joker/superagent-agent-e`、`codex/g3-product-acceptance`。读本轮[README](README.zh-CN.md)、[0031](../../docs/rfcs/WP-16/0031-wave-09-admission-and-target-boundaries.md)。只改product-acceptance，不改产品/B运行实现/公共schema，不修改别人的断言。

旧v1身份迁移和缺model/provider负例已关，保留；真实模型全包0，研究继续封存BLOCKED。大成果是当前main网页/恢复与D真正托管升级的同源矩阵，不能再用旧pair两次fixture start称最新installed-alpha通过。

## E1 先关闭完整费用消费链和假sender

测试harness→costOf→settle→ledger：totalTokens已知但input/output/reasoning/cache等必要计费明细缺失时，不得??0算免费并清unknown/reservation。不能只有直接settle(undefined)单测通过；经实际调用链仍unknown、占用上界、不能再发。

消费B唯一实际adapter，不凭owner="b"/entry.command descriptor自己spawn。覆盖无reservation、token并发重放、签发后换输入/transport、缺host/上界/身份等，所有拒绝fake send0。旧账不改写，当前无recipe不付费smoke。先push有限checkpoint。

## E2 让产品与安装来源全部显式

测试代码source、受测产品source、artifact source分列。baseline/target输入必须含tar/hash/source/build/schema，实际读取并验证，不只允许换tar路径却硬编码旧tuple。保持历史报告，但新verdict只属于实测组合。

旧dirty12→schema13数据迁移/手动binary切换结果保留对应范围；主线7027d31网页/source审计、D wave08新pair并未由该报告验证。拒绝同tag/错误来源/缺字段，不拿自报executed或退出非零当业务证据。

## E3 独立验收当前提案与context用户流程

安全合并最新main，用临时实例验收三类提案、确认前无效果、拒绝、完整scope/profile/checks、同会话多工作目标/版本、响应丢失刷新原请求一次、来源/授权变化。main8/8是参考，不替代你的断言。

消费实际source audit固定not_granted/startupAvailable=false；context入口到达后测真实两项目/会话、source种类别名、过期/预算/scan_incomplete及撤销后再读。不把library或schema当网页完成，不能测试用户5186实例。

## E4 验证真正托管升级与全进程失败

调用D的upgrade/--recover/rollback命令，用明确当前pair；不是两个安装物分别start同一state。断言mode、目标record/进程树、pointer、升级后新数据与准确schema code。

包含launcher死/API活、未知活target、health成功/record不落盘、失败目标尚活不得退pointer、重启recover、已回退终态doctor建议。不能只看指针或清理后文件数；fixture/personal/native层级明确。产物未冻结时先写负例/参数检查，依赖到达后真实运行。

## E5 验证实际target准备/激活与中断

消费A只读Reader/D materializer/main真实接口，验证source commit前/后、目标半准备、activate启动前/后响应丢失、错root/配置/host/旧资源不放行、旧queue/marker保持、再恢复不继承权限。

shared material/inventory和sourceReceipt都不是启动grant；有schema不等于实现已交。main缺activate时标准确NOT_TESTED，继续E2–E4和有界可靠性，不无限soak或用preflight替target执行。

## E6 重建单一真实准入矩阵

维护`tests/product-acceptance/reports/wave09-status.json`，module/controlled-product/installed/native/value及所测操作逐列；记录真实命令/退出码/source/hash/限制/owner，不给混版本总PASS。

修正过期“main无提案UI/source audit、缺第二tar/config-root未修”等汇总；当前target未启用/真实native未测则保留，不把研究BLOCKED当no-go。先E1后连续独立项，only owned paths，push原分支，预算/七组服务不动。
