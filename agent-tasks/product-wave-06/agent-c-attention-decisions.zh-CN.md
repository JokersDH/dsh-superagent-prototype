# Agent C：共享注意力排序与决定事务整包

继续`/Users/hh/Desktop/joker/superagent-agent-c`、`codex/g3-assistant-context`，保留`9a39908`及已有修改，合并最新origin/main。读本轮README、0023、0022和现有context/proposals/knowledge消费者。只拥有上述三包及routing、自有文档/证据；不改SQL/迁移、Catalog准入、公共schema、HTTP/UI或E断言。真实模型预算0。

## 交付目标

把已完成的纯模块改为当前主线可直接消费的稳定接口，补齐与A真实port的组合证据。注意力能给有依据的确定性排序；决定/提案能在main事务内安全确认、撤销、重放和失效。沿用已有模块和reasoner，不增加LLM循环、执行图或学习路由。

## C1 候选基线与同步事务检查点

复验已有决定事务修复和当前main消费：原三个C领域probe、真实SQL重放、prepare只读与commit/revoke同步。保留旧报告，只用新source报告本轮事实。

发布main可运行的DecisionTransactionService构造/prepare/commit/revoke例、依赖port和稳定错误语义。明确哪些步骤需外层UnitOfWork，禁止事务内await或事务外先写后补receipt。先push检查点供main独立准入，再继续其他阶段。

## C2 直接符合共享AttentionRanker

消费contracts/attention.ts；交直接符合`({ items, now }) => ranks`的导出或C拥有的适配器，不能要求main复制你的算法。旧本地AttentionItem可以作为内部模型，但不能替代公共wire。

重点处理sinceAt=null、显式deadlineAt、expiresAt、完整来源身份和shared blockedWorkIds的出向语义。旧blockedBy是入向依赖，禁止机械改名；只能转换已知关系。未知不改成“已测0等待”或当前时间的假历史，原因枚举不足提交RFC。

定义可解释的类别/期限/阻塞/等待规则和稳定同分顺序，显式now使结果可重现。截止与过期分开：超过业务截止但仍有效的答案不因排序被禁发，已过期输入不能得到新授权。输出完整id排列，不补来源项或吞掉输入；分组只作导航，权限/认证逐target确认。没有数据不显示质量概率或最优排名。

## C3 与A真实持久port组合

main准入A v13后，用实际RoutingEvidencePort和AssistantStatePort运行现有消费者，固定A/C/main source，不再用in-memory结果替代本项。

覆盖同payload重放、改payload冲突、旧/新candidate、profile/政策/来源漂移、撤销/替代后重放、失败回滚及进程重开。advice/review仍只是数据，不触发native、验证PASS或humanAcceptance。若A port有问题给自有最小复现，不修改A SQL。

## C4 完整决定/提案/上下文消费边界

提供main接网页流程所需的纯prepare与同步commit计划：记录/撤销明确决定、确认/拒绝提案、构建有界上下文与可读来源。项目/grant/scope、来源digest、conversation/actor、版本和效力必须在确认时重验。

prepare无写/排队；重复已确认业务请求返回既有语义，不能重新授权；撤销/替代后旧版本不能复活，失效来源不再进入新上下文。模型输出、文档中的指令和review reproduction均是输入数据，不能提供可信actor、扩大权限或变成可执行命令。

main拥有HTTP/schema/UI；交公开库函数、合法/非法fixture与命令计划消费例。缺公共DTO时交集中RFC并继续领域反例，不另写HTTP或私有版本类型。

## C5 主线消费者与回归兼容

消费main发布的attention/决定HTTP和事务接线，在C自己的测试/例子中证明来源、排序理由和确认语义一致。不要重做main已有待办页面；优先修实际类型/事务/效力缺口。

保留原context/proposals/knowledge模块测试及wave04三项准入，新增变化后有针对性复验。对SQL回滚、异步误用、另一actor/项目、改scope、缺来源和过期/旧版本给可重跑负例。E将独立验这些行为，不能改E期望。

## C6 规则/接口文档与最终包

交稳定导出与版本、输入未知值策略、类别/期限窗口、依赖方向、理由映射、数据规模上限及main接线recipe。更新`packages/context/reports/wave06-status.json`，分开纯模块、真实SQL、main产品与原生层结果。

本轮不扩建完整RouteAdvisor生产平台。已有eligibility/review/advisor仅做必要兼容与失效回归，默认路由/复核仍关闭；没有实际价值结果不研究measured_history或自动接受。

## 验收出口与遇阻继续

- 共享AttentionRanker可直接消费，null/期限/依赖方向正确，同输入稳定、来源排列完整。
- 真实A port下的决定事务/证据持久化能由main重跑，重放与回滚不破坏语义。
- main可用同步库入口完成明确确认/撤销与有界来源预览，未确认无效果。
- 等A/main时继续纯排序/上下文/事务负例；等HTTP时交公开消费例，不创建替代产品入口。

```text
继续第六轮Agent C整包。保留当前目录/分支和候选，合并最新origin/main，读agent-tasks/product-wave-06/README.zh-CN.md和agent-c-attention-decisions.zh-CN.md、WP-16/0023/0022。
完成C1-C6：同步决定事务、shared AttentionRanker适配、A真实port组合、提案/上下文边界、主线消费与回归、最终整包。先交接口再连续完成各阶段；真实模型0，不改SQL/contracts/coordinator/console/root lock或E断言，不扩新路由平台。
```
