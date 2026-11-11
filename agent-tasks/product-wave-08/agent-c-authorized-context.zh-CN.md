# Agent C：有授权的上下文与提案真实消费者整包

继续`/Users/hh/Desktop/joker/superagent-agent-c`、`codex/g3-assistant-context`。读本轮[README](README.zh-CN.md)、[0029](../../docs/rfcs/WP-16/0029-wave-08-product-closure-and-reviewed-inputs.md)和0027/0028。仅context/proposals/knowledge/routing；不写HTTP/UI/SQL或新LLM loop，真实模型0。

已交composer和decision provider，不重做。旧supersession列表修复主线已按0179889精确集成；main提案HTTP在627ef0d已交，旧“没proposal入口”阻断要更新。本轮成果是所有来源走同一授权边界的可组合上下文，以及能被真实应用消费的库接口。

## C1 先关闭独立授权probe并交修复检查点

合并新main，运行`node tools/bootstrap/probe-wave08-context-grant.mjs "$PWD"`。当前三个FAIL：过期grant仍读provider、caller预算超过grant、purpose不匹配仍读取。必须在任何provider调用前统一鉴权，不只依赖port-backed ContextReader。

检查所有decisions/conversation/artifacts/普通port路径，覆盖期限/目的/项目/可信授权与sourceKinds、零/负数/NaN/超界预算。预算只能夹紧或拒绝，不能通过改写子grant扩大权限。先交green probe及完整回归source，不启用真实模型。

## C2 完成全来源预算与完整性语义

复用当前composer，确保全局files/slices/bytes和估算tokens/duration均受原grant与caller预算限制；低预算/无剩余不能Math.max(1)再读一条超限。明确token估算不是计费硬上界。

unknown/missing provider、caller截断、storage scan不完整分别表达；有效决定scan_incomplete必须拒绝整次组合，撤销/替代不复活旧项。对时钟变化/跨await授权过期/来源摘要变化确定是否拒绝或显式stale，不默默返回当前有效结果。

## C3 交主线可直接投影的来源与失效结果

给生产A port的项目/原会话/可选work adapter recipe，输出稳定来源标识/摘要/截断/信任等级；跨项目/会话、contract漂移、文件symlink/父目录、权限/认证答案不进入普通共享知识。

不在调用方自造grant或上传整个repo。main选择实际网页DTO与公开字段，你提供结构化库输出和fixture；文档/消息内容始终untrusted_data，不能注入actor/tool权限。

## C4 用main真实事务接口闭合提案消费者

消费已发布prepareCommand/commitPrepared与proposal HTTP，核对confirmWithCommand和main现有plan+commit组合的一致性。不得绕过业务命令重验，rejected必须回滚proposal终态；effectCommandId与实际计划commandId一致。

真实SQLite覆盖创建/修订/记决定、缺项、重复/不同ID、reject、来源/actor/grant/profile漂移、receipt失败和reopen。发现main应用错误交最小复现，不另写HTTP服务或重复确认状态机。明确reply无效果与其真实持久状态，不以注释代替断言。

## C5 消费上下文HTTP/网页检查点并测有界性能

main发布实际context预览入口后，从拥有目录给消费recipe和来源/失效/预算对照；源码没接到不要声称UI通过。大数据下测在预算内的读取量/延迟，不引入检索平台或在线学习。

等待main期间继续C1–C4真实反例，不能停在benchmark。真实模型0，实际推理/自动注入单列未测，fixture不证明模型收益。

## C6 单一状态与集成交接

维护`packages/context/reports/wave08-status.json`，列已修旧supersession、当前三项授权probe、实际消费者及来源，不保留main没提案HTTP的过期描述。旧报告保留历史，不改成新source PASS。

先C1稳定修复再连续C2–C5，交branch/base/source/导出/fixture/命令/退出码/剩余owner；只push原分支，不动用户服务或root lock。
