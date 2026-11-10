# C 接线补充：真实存储重放与决定原子提交

输入：A `1dddee9`、C `45bf9de` 已进入主线源码；主线已用实际SQLite联调，非in-memory fixture。C原三项准入probe均通过；提案pending/原子确认/receipt失败回滚/重启重放通过。保留此前范围，不需要重做整包。

## 1. 修复实际适配器重放

复现命令（从新main正常build对应包后）：

```sh
node tools/bootstrap/review-persisted-assistant.mjs
```

目前7项中6通过，`DECISION-DOMAIN-REPLAY-OVER-STORAGE`失败：同一合法来源/actor/decisionId的governance.record第二次调用，`AssistantDecisionStore.append`以existing.version作为expectedVersion，却仍发送decision.version1；A的port要求更新必须expectedVersion+1，因而抛`WorkflowConflict: A decision update must advance exactly one version`。

C修adapter对创建/同版本重放/合法后继版本的映射，不降低A的CAS规则。补真实AssistantStatePort消费者，不能仅在自己的InMemoryAssistantState上通过。还要覆盖撤销后重放旧record、同ID改正文/来源/actor、状态被替代、第二Node进程/重开；旧重放不能让revoked决定重新有效。

只改C拥有路径，独立probe由main保留；修复后交源码和该probe结果，主线复验。真实source/provenance与revocation的其余成功场景也要保持通过。

## 2. 补决定的prepare/commit消费入口

本批C已经提供同步的提案persistPending/commit，但决定仍只有async DecisionGovernance.record/revoke + async adapter。在main同步UnitOfWork里不能await；在事务外先写决定再补receipt同样不满足原子性。

请在knowledge中交可消费的只读prepare与同步commit/revoke入口或等价命令计划接口：prepare不产生持久写；commit在main事务内重验可信actor、grant/project/scope、当前source digest/conversation/状态版本，经A同步port落记录。main在同事务写receipt/event，任何失败全部回滚。不要在coordinator重复实现领域规则或包装async callback欺骗UnitOfWork。

提供可直接消费的导出/本地类型与真实SQLite例子。当前共享持久schema足够则沿用；若缺公共语义写RFC，不手改contracts/root lock。模型调用0，不接真实provider。两项修复作为一个完整接线补充提交，继续原C分支。
