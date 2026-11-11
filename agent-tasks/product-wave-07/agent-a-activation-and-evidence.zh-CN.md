# Agent A：恢复激活持久事实与历史证据整包

继续`/Users/hh/Desktop/joker/superagent-agent-a`、`codex/g2-workspaces-verification`。先读本轮[README](README.zh-CN.md)、[0026](../../docs/rfcs/WP-16/0026-wave-07-integration-and-admission.md)及wave05修订01。只改`packages/storage/`、`packages/workflows/`；生产迁移仍仅你一人追加，公共schema/root lock/main应用不改。真实模型0。

当前输入d3207d8：接受消费者、真实C port、快照摘要已经交付；main d4d51ae已接接受事件投影。先核对source，不重写已准入producer，不沿用旧报告中已过时的主线阻断。

整包结果：main可以在一个现有UnitOfWork内记录精确恢复意图/回执，恢复历史可完整审计，新执行库不带旧队列；给main/D/E可直接运行的持久化和快照recipe。本包不自行授权启动。

主线补充准入输入见[0027实际接口](../../docs/rfcs/WP-16/0027-wave-07-command-and-recovery-checkpoint.md)和[0028独立反馈](../../docs/rfcs/WP-16/0028-wave-07-proposal-http-and-admission.md)：旧RecoveryPlan port暂不等价于RecoveryActivationFacts；必须消费已发布的完整activation/target/机器与资源绑定，不填默认伪值。另需修mapRow把envelope整体当plan读回的问题，覆盖record/get/list/reopen完整schema roundtrip。继续原A2/A4，不新开存储平台或改旧迁移。

## A1 先交持久接口与真实消费者检查点

合并新main后复验已有storage/workflows/application/verification及C真实SQL消费者，核对必要workspace依赖，向main报root lock请求。发布最新exports、生产port实例、同步事务使用和reopen recipe，明确当前集成/未集成差异。

读0026后给main最小恢复事实port建议：稳定command/plan/source/target身份、提交回执、查询与重放、版本保护。先使用既有receipt/event/artifact能力做真实SQLite组合；新增公共记录等待main发布，不复制私有权威类型。先push此检查点，随后继续独立阶段。

验收：消费者不使用memory fake代替SQLite；失败事务无半写；已有接受投影不重复。计划建议不标为已实现激活。

## A2 实现恢复意图与回执的同步原子事实

消费main公布的共享接口，提供同步prepare/commit所需事实读写；精确同命令同内容重放返回原结果，换计划/目标/actor/source拒绝。事实与命令receipt/event在同一UnitOfWork提交，不在事务中await文件/网络/业务dispatch。

恢复源只允许明确的激活审计元数据写入，不改旧合同、候选、runtime绑定、queue或marker。新的执行state必须通过空库初始化路径，禁止整库复制后清队列。source事实是激活权威，准备目标或客户端文件不是权威。

验收：注入写入失败、两个并发确认、reopen重放、版本/摘要漂移，证明最多一条稳定意图和匹配回执；目标创建失败可查询原意图继续核对，不生成另一授权。跨DB/文件系统原子性由main协议保证，不能由单库测试冒称完成。

## A3 提供有界且不丢来源的历史证据读取

整理现有work evidence/Outcome/ReviewTiming/决定与提案历史读取，按真实项目/工作/命令来源分页；明确完整扫描、调用方窗口截断和输入无效的差别。优先复用已存在索引，不预建分析仓库。

验收：多项目隔离、同时间稳定游标、未知/partial计时、接受重放、不再有效决定的历史仍可审计。不能把计时当权限或质量；不得悄悄截掉记录后声称完整。向main交实际查询/数据量和延迟证据，只有实测必要才加索引迁移。

## A4 覆盖激活事实的崩溃重开与真实组合

使用main最小应用消费者和真实C prepare/commit port复验。覆盖source事务提交前/后、目标准备失败、已激活后响应丢失的持久事实查询；由main/D/E负责实际进程/文件切换，你提供可复用fixture和权威查询。

验收：历史原queue逐字保持；新库无旧业务任务/native会话/授权；任何测试不能通过删除marker或旧任务获得通过。未知物理writer仍由main/B当前屏障决定，不从数据库状态推导已停止。

## A5 交完整快照、迁移与再恢复recipe

把激活事实/receipt/Outcome及材料摘要纳入既有快照清单，交D/E可重跑的备份、迁移、只读恢复与源目标对照。仅需要真实查询约束时追加生产迁移，不改旧迁移；记录schema上下界和拒绝旧binary的条件。

验收：snapshot/reopen保持历史与来源；再恢复不继承本机可执行授权，私有凭据不进入备份。升级后新记录不能被“回滚测试”静默抹掉；目标临时目录清理仅处理可证明属于该准备身份的内容。

## A6 收口独立回归和消费者交接

运行本包必要回归及真实A/C/main组合，向D/E交命令、fixture、版本/manifest和限制。仅一个权威`packages/workflows/reports/wave07-status.json`，旧报告保留，并逐条说明旧阻断的关闭或迁移。

交branch/base/source、拥有路径、迁移序列、已push检查点、实际退出码、证据、尚缺输入与owner。六阶段可独立项全部执行后交接；等main接口时继续A3/A5及已有消费者回归，不停在A1。只push原分支，保留六组用户服务与所有历史账。
