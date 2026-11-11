# Agent A：生产激活事实与历史迁移整包

继续`/Users/hh/Desktop/joker/superagent-agent-a`、`codex/g2-workspaces-verification`。读本轮[README](README.zh-CN.md)、[0029](../../docs/rfcs/WP-16/0029-wave-08-product-closure-and-reviewed-inputs.md)、0027/0028。仅storage/workflows，生产迁移你唯一追加，真实模型0。

本轮结果：main的RecoveryIntentCommitter可用你的真实生产port，source事实/receipt能重放并覆盖快照；历史证据分页给主线真实消费者。当前da5f62a未关闭上轮读回/共享port问题，不再把旧plan intent称已对齐。

## A1 先关读回反例并对齐已发布接口

安全合并当前origin/main，修mapRow把envelope当plan返回的结构错误，覆盖record/getByPlan/getByCommand/list/reopen完整schema、摘要、actor/时间。读`packages/contracts/src/recovery-activation.ts`与main `recovery-intents.ts`，给最短实际生产port recipe并先push检查点。

旧RecoveryPlan行保持历史审计，不能填默认target/machine/resource-policy转换授权。新接口复用共享RecoveryActivationFacts，不保留第二套主线必须适配的私有权威记录。

## A2 交生产RecoveryActivationFacts同事务实现

get(activationId)/forCommand(commandId)/put(intent)全同步、同caller source UOW，严格解析共享schema，activation/command唯一且同body幂等，换target/plan/principal/resource-policy冲突。记录、main receipt/event最后失败时全部回滚。

只追加迁移，不改已发布migration14；现有旧记录和历史queue保留。main负责事实真实性/当前资源授权，你的port不授予启动、不生成业务Work、不调用文件/网络/异步dispatch。用实际SQLite证明类型/数据/重放，不只导出interface。

## A3 将事实接进主线消费者并覆盖中断重开

用main已有RecoveryIntentCommitter及你的实际port替换测试receipt适配器，交受控source提交前/后、receipt失败、目标准备失败、重复/错身份/reopen反例。source提交后响应丢失返回原稳定事实；对外receipt不能变成便携启动权限。

main target启动未到时先验证source半部，不把它算target已测。接口到达后补实际消费者，不用mock通过替代生产依赖，不绕过未知writer。

## A4 交可直接用于交付网页的证据分页

复验现有evidencePage/时间线，明确完整、caller_limit、storage_cap及稳定游标。给main按work/project范围的真实recipe，覆盖接受Outcome、partial计时、无来源历史、游标漂移和跨项目拒绝。

只为实测查询瓶颈加必要索引，不建分析仓库。不从客户端可见时间推导质量/权限；重复接受不能重复计时或Outcome。

## A5 完成旧库升级与新事实快照

把新事实纳入只读摘要/backup/reopen/恢复证据，交D/E旧13/14到当前schema的真实迁移fixture；新state仍空队列，不复制旧会话/授权。旧binary不兼容应保留原数据并给准确拒绝。

备份不携带本机可执行activation权威或凭据；再恢复仍须新确认。证明字段完整/摘要可复验，不只统计有一行。未知/缺失/过新schema不静默降级为空数据。

## A6 连续回归与集成交接

运行owned包、main相关事务/接受/提案消费者，记录新增schema、fixture、source和实际命令。维护一个`packages/workflows/reports/wave08-status.json`，旧报告保留，关掉已不成立的依赖描述。

先A1/A2给main可消费源码，再继续A3–A5；外部target缺口转A4/A5，不在第一次push后停止。最终给branch/base/commit/拥有路径/结果/剩余owner/consumer步骤，只push原分支，不提交root lock。
