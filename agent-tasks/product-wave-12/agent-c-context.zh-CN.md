# C：可信来源到明确候选的完整数据链

原目录`/Users/hh/Desktop/joker/superagent-agent-c`，分支`codex/g3-assistant-context`，仅context/proposals/knowledge/routing四包。保留原root lock差异不提交；读README/0037，合并最新main。旧17条已通过，不重交旧修复替代新工作；模型/native0。

## C1 关闭新八条实际export反例

跑`probe-wave12-context.mjs "$PWD"`：digestScope变化、maxItems、omitted绝对路径、缺provenance、上游不完整、foreign reply conversation/project、history work边界。先完成这些纯数据规则并交首个source，不修改main当前guard或另建确认权威。

## C2 保存所有Scope与来源证明

relevance输入缺role/provenance默认拒绝，question/work锚点、selected-work、project/conversation保持main边界。project/kind selector不等于Scope授权；decision/contract必须先由可信当前Scope筛选，必要收紧owned API。候选排序不能把来自未授权源的正文纳入摘要。

## C3 coverage与预算贯穿检索

provider.coverage、listWorks.hasMore/nextCursor、missing/omitted/expired/truncated等信息不能在数组转换时丢失；无法证明完整就incomplete。输入扫描与输出预算分别有界，maxItems/maxBytes/maxTokens/maxIds所有分支均成立，完整序列化计入换行/标签/metadata成本。

## C4 冻结来源审阅完整性

manifest比较包括sourceId、kind、path、digestScope、actual budget、coverage与截断语义；unknown不判unchanged。review所有item/omission路径同一脱敏规则，达到上限只留有界遗漏计数；正文/摘要/空/缺失可区分。不替main完整同步guard签当前性或发送授权。

## C5 真正消费A历史与回复

基于main530085c真实contextHistory/replyResults，移除新组合测试的Map fallback。复核返回project/conversation/work与query、reply与source/principal/model/request/artifact绑定；历史current_window只指观察，不给重发或确认权。A work派生修复未到时用负例记录，并继续C自身防御检查。

## C6 候选整body与逐项校验

先比较AssistantReplyBody的project/conversation/sourceMessageId与trusted bindings，再逐项处理ReasonerProposal。foreign revision envelope同样拒绝；缺用户输入保持needs_user_input，不自动补scope/profile/check/actor。普通回复可以保留，模型候选始终只走原ProductProposals明确确认。阶段4–6交第二个source。

## C7 实际主线消费者组合

提供main可替换私有adapter的明确recipe：保留conversationThrough cutoff、发布artifact IDs、Scope筛选、coverage转译、最终assertCurrent。测试必须消费真实A port/main530085c HTTP/provider/SSE入口；没有读SSE就不称SSE通过。coordinator/HTTP修改由main实施，缺入口只标该项NOT_TESTED。

## C8 确定性检索与可用性评价

固定多项目/中英文/重复来源/长会话样例，明确目标相关项和污染项；比较顺序、遗漏解释、来源审阅所需字段及预算。记录确定性质量基线和局限，不把fixture评估称模型收益/创新突破，也不为研究发送模型任务。

## C9 规模、分页与失效整包

5000来源/深分页、同timestamp、过期决定、撤销/替代、正文缺失/字节变化、scope/work切换与跨页并发新增。来源标题/正文仍可有界阅读，所有project/work泄漏负例先于宽泛PASS；不在C读SQL或创建后台索引writer。

## C10 回归与交接

四包typecheck/build/test及新旧export探针；维护`packages/context/reports/wave12-status.json`，列每个export实际被谁消费和仍缺的main动作。只提交owned paths、push原分支，保留旧scope/root-lock/九组服务。

## 独立备选队列

- 八反例、Scope/provenance/coverage、body envelope和预算不依赖UI。
- 已发布A生产数据、确定性检索样例与规模不依赖恢复激活。
- main替换adapter未到时对照真实旧guard语义，交recipe和可运行测试，不改HTTP或循环等。
