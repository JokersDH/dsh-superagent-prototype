# 第六轮检查点：真实持久消费者与明确决定 HTTP

日期2026-11-11。输入派工`82db295`。本批已接入A的f26f2eb/1bd0996/99a192b和C的027c305/ae7f80f；均为各自拥有路径的提交。未集成C旧attention签名或完整新路由；B/E继续原试点，主线真实模型任务0。本文为已实现接口检查点，不是完整R0或个人Alpha准入。

## 1. 独立复验范围

A storage 75、workflows 21，C knowledge 35项通过。主线`review-persisted-assistant.mjs`的真实SQLite消费者7/7通过，包括此前DECISION-DOMAIN-REPLAY-OVER-STORAGE；C旧三项领域准入3/3也通过。证据在reports/releases/wave06-main-checkpoint/，没有覆盖原报告。

这些结果允许消费对应持久/事务接口，不证明原生停止、试点价值、发行或全部新排序。A的v13生产迁移由A原提交引入，main未改其定义；root lock由main统一生成。

## 2. 公共接口

唯一parser/type在packages/contracts/src/decision-commands.ts，生成物为generated/decisions.schema.json及manifest。frozen Runner/data hash保持不变。

| 入口 | 输入 | 结果 |
| --- | --- | --- |
| POST /v1/decisions/prepare | DecisionPrepare：projectId/conversationId/sourceMessageId/content/scope及可选supersedes | DecisionPreview：服务端产生的decision、来源、5分钟期限与签名token；只读不存草稿或事件 |
| POST /v1/decisions/commands | DecisionCommand：record_decision携token；revoke_decision携decisionId/expectedVersion；均有commandId/projectId/conversationId | 原CommandReceipt；合法业务拒绝为rejected receipt，重复同命令原回执 |
| GET /v1/decisions | DecisionQuery：必需projectId、可选limit≤50/cursor | DecisionPage：持久记录/sourceState/status/有界分页 |

全部使用原loopback身份/Host/Origin/JSON约束；客户端无actor或native命令字段。恢复只读模式可读取目录，prepare/commands两个POST继续被统一拒绝；本批不解除恢复marker。

record流程：可信用户消息→只读prepare→用户明确确认→核对token签名/用户/project/原会话/期限/当前grant摘要→C同步commit重验消息digest/范围/来源→决定、application.decision.changed及receipt同一事务。任何写失败整体回滚，未确认无排队或执行。

只有持久trusted_user消息可作为来源；reasoner_reply、系统通知及question_answer_display不能提升为共享决定。范围过期、授权缩小/变化、源文改变/消失、另actor/项目/会话、篡改或过期token拒绝。revoke绑定原owner/project/conversation和精确版本；同命令重放不产生新接受/授权。

目录状态recorded只表示审计记录已存，**不表示执行权限或自动上下文效力**。sourceState单列current/missing/stale/unknown，撤销/到期/已证明替代分别显示。C当前替代查询有1000条扫描边界，本检查点不将记录状态当全量有效知识证明，也未把目录自动注入reasoner；这一限制由C继续处理。旧记录不被补造来源。

## 3. 消费方法

main组合类为apps/coordinator/product/decisions.ts，使用C的DecisionTransactionService/AssistantDecisionStore和A原AssistantStatePort，未增加writer或新生命周期。createProductRuntime已提供read.decisions、operations.prepareDecision、operations.decision；HTTP fixture可直接复用它们。pnpm start已纳入knowledge构建。

E可沿已有认证会话直接POST一个来自真实持久消息的prepare，再检查数据库/事件/队列未变；确认后校验receipt/目录/来源/撤销。主线可运行负例见tests/integration/decision-commands.case.mjs，不要求E复制主线断言。C/A可用既有真实SQLite消费者继续联调；不再将main完全没有决定HTTP作为阻断。

本批已实现记录/撤销明确决定，未实现通用proposal确认HTTP、自动记忆提升或新的reasoner工具；不能把这些范围混为完整助理已上线。

后续同批已消费C `c9dc567`/`fc84127`的共享AttentionRanker，createProductRuntime默认使用sharedAttentionRanker。输出仍为原AttentionPage完整排列与理由，仅在本页排序、不推断全库最优或新增授权；B `8cc45ad`的exact profile resolver也已按模块41项测试准入，没有因此启用新Driver或扩大原生能力。

## 4. 本批验收与后续

共享契约208项、决定HTTP/事务集成8项通过，后者覆盖签名/过期/漂移、回执失败回滚、重放/撤销、来源失效、分页scope、非可信消息和恢复只读。真实模型调用0；测试在临时SQLite/受控入口执行。

网页入口随后已完成：真实用户消息旁“记录为项目决定”→编辑→只读预览→明确记录，顶栏“项目决定”可查来源/范围与逐条撤销；响应丢失时用sessionStorage保留原command并在刷新后核对，不换ID重建决定。确认期限与决定范围到期分开显示。原生权限/认证展示消息无记录入口，决定动作不创建Work或执行效果。

最终源f638fe0上决定浏览器4/4通过；6076d00上共享排序/跨项目/逐项接受浏览器6/6通过。主线后端组合51项、console19、C routing40、knowledge38与B catalog41分别通过，不能将较早包内数量重复相加。证据见 [本批交接](../../../reports/releases/wave06-main-checkpoint/README.zh-CN.md)。

新预览http://127.0.0.1:5185/，独立state `.local-state/decisions-preview`、API8801，初始无旧历史；用户5180–5184实例不重启、不迁移。A接受Outcome消费者的后续候选、B实际控制/试点、D发行和main恢复新授权仍按第六轮分别验收，普通推荐/复核入口保持未启用。
