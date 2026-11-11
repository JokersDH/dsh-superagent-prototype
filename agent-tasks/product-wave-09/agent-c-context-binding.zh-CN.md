# Agent C：种类绑定、命令绑定与真实context消费者整包

继续`/Users/hh/Desktop/joker/superagent-agent-c`、`codex/g3-assistant-context`。读本轮[README](README.zh-CN.md)、[0031](../../docs/rfcs/WP-16/0031-wave-09-admission-and-target-boundaries.md)。仅context/proposals/knowledge/routing，不写HTTP/UI/SQL或新模型loop，真实模型0。

四项旧grant probe已在主线通过，context56、knowledge adapter54按模块接入，未开放context HTTP。主线故意未接confirmWithCommand；大成果是关闭两项新绑定反例，然后消费main实际context/提案入口，不重复旧expiry修复或再写一套确认流程。

## C1 先关两项新probe并交修复

运行`node tools/bootstrap/probe-wave09-context-proposal.mjs "$PWD"`。artifact-only grant不能因group名decisions而调用decision provider；effectCommandId与plan.commandId不同必须在confirmed写入前拒绝、保留pending。

保留两项正对照，不用禁掉全部功能来变绿。同样绑定plan会话与原来源；回复无业务效果的文档/状态保持一致。先push这一可运行检查点，不等待main新HTTP。

## C2 收口自定义group与预算规则

所有特殊provider和port-backed路径按真实source kind鉴权；group名字/声明的sourceKinds不能相互冒名。非法name/kind组合、重复组/错误priority/share、NaN/负数/无穷必须在读取前处理，预算仍受grant与caller夹紧。

保留过期/purpose/confirmedAt/跨await时效、完整决定scan和显式truncation语义。main不得靠不暴露groups来掩盖库边界；同时别另建检索/策略平台。

## C3 用实际main receipt保证提案幂等

保持main既有planProposalCommand + commit + prepareCommand/commitPrepared组合为权威。辅助入口若保留，就准确绑定effect ID/完整计划来源，并与main相同命令body receipt重放组合测试；不要私造SQL/receipt或默默扩共享schema。

创建/修订/记决定、缺输入、reject、source/actor/grant/profile漂移、同ID换body、receipt失败和reopen都走真实A port/main应用。main不使用的unsafe helper不能因测试中传相同ID就忽略。

## C4 交context产品调用所需准确adapter

给main明确项目/原会话/可选work与contract、有效决定、真实来源manifest/摘要/预算/遗漏/注入标记的稳定导出和fixture。来源必须来自可信当前port；permission/auth答案、跨项目/会话、失效合同和不安全文件拒绝。

content始终untrusted_data，模型文本不构造actor/grant。main控制共享DTO与HTTP，C不写私有服务器；新增字段先RFC，等待时继续所有独立反例。

## C5 消费main实际context预览并验证失效

main发布入口后，用拥有目录的真实消费者测试预览/确认来源、grant到期/撤销/替代/source变化、budgetClamped与scan_incomplete。不可把空结果当成功，不以library benchmark代替产品入口。

测有界读取量与延迟，使用固定数据/时钟，token只作组合估算。无真实模型、自动注入或收益声明；这些不作为本包成功前提。

## C6 单一状态与整包交接

维护`packages/context/reports/wave09-status.json`，区分旧反例已关、新两项、实际main入口与剩余owner。交branch/base/source、精确导出/consumer/命令/退出码/限制。

先C1再连续C2–C5，缺main入口就做C2/C3/C4，不停在首个push或benchmark。只push原分支，不改root lock或其他Agent断言。
