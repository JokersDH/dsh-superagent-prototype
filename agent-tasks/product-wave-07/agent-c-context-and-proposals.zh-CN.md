# Agent C：可组合上下文与真实提案闭环整包

继续`/Users/hh/Desktop/joker/superagent-agent-c`、`codex/g3-assistant-context`。读本轮[README](README.zh-CN.md)、[0026](../../docs/rfcs/WP-16/0026-wave-07-integration-and-admission.md)及修订01。仅拥有context/proposals/knowledge/routing；不写SQL、HTTP/UI/application或私有LLM loop，真实模型0。

当前119bb96已交完整效力扫描/显式scan_incomplete、真实A port、planProposalCommand及库级提案闭环。优先参考wave06-consumer-status，不再重复旧报告中已解决的A port阻断。main已交决定HTTP/网页和AttentionRanker，本轮不重做这些入口。

整包结果：main可用少量组合代码接出有来源的上下文预览和确认提案；C规则能在真实A UnitOfWork同步提交，无先confirm后补业务效果。本包不自行发送模型或将待确认文本当命令。

主线实际接口已发布：[0027](../../docs/rfcs/WP-16/0027-wave-07-command-and-recovery-checkpoint.md)，应用支持事务外prepareCommand/事务内commitPrepared。另有必须先关闭的残余：`node tools/bootstrap/probe-wave07-supersession.mjs`当前exit1，替代决定撤销后getSync旧项为superseded，listSync(status=active)却复活旧项；C2/C4须同时覆盖list/listEffectiveWindow，不只修单条get。

## C1 交可直接消费的真实库检查点

合并main并复验现有context/proposals/knowledge/routing，给exports、生产A port实例、caller输入/错误fixture和最短recipe。列出已集成/待集成source差异，修正旧权威状态，不覆盖历史证据。

向main提出必要共享输入，但不发明另一套可信actor/权限/receipt。给出planProposalCommand与现有UserCommand的准确映射、同步commit调用方式和事务失败语义。先push此可运行检查点，再连续推进。

## C2 完成显式范围与预算的上下文composer

在已有context模块提供确定性只读组合：项目/原会话/可选work、当前合同与来源摘要、有效决定、项目事实、历史消息/产物，明确优先级和caller预算。复用现有reasoner输入，保留内容来源与可信度，不新造模型循环。

验收：大输入下调用方窗口截断可解释，效力扫描不完整必须失败而非悄悄收进过期知识；撤销/替换后不复活旧决定，跨项目内容不串。预算采用有据可查的明确单位/上限，不把估算token写成硬计费保证。上下文预览不等于自动注入真实请求。

## C3 提供提案prepare/同步commit的组合规则

基于已有planProposalCommand补齐委托/补充/记决定的受支持映射和needs_user_input。scope/profile/criteria/当前合同缺失就返回具体缺项，不用默认值扩大权限。非受支持提案明确不可执行，文本不能选择可信actor或原生命令。

消费main发布的prepared-command接口：异步preflight在事务外，当前来源/权限/版本在同一UOW内重验；原UserCommand效果、proposal状态与receipt/event由main/A同事务组合。C不调异步dispatch，也不在自己的状态库复制命令效果。

验收：未确认无效果、重复确认返回同结果、换内容/actor/grant/source/版本拒绝，原命令失败不留confirmed半状态。主线接口尚缺时交精确请求与真实port fixture，不用fake应用宣称HTTP闭环完成。

## C4 交真实A存储的生命周期与来源反例

覆盖confirm/reject/revoke/来源失效后重放、事务异常、重开与历史审计；已撤销记录仍可查但不进入有效上下文，替代记录撤销后原记录不复活。逐项标明支持哪种提案状态转换，不将reject/revoke混为一回事。

验收必须使用A实际SQLite和同步端口；组合新上下文、原UserCommand计划与proposal生命周期，证明没有独立SQL writer、隐式授权或旧合同重写。缺索引/事实向A/main报最小复现。

## C5 消费主线实际入口并做确定性性能验证

main发布context/proposal HTTP检查点后，从你的拥有路径交消费者recipe/断言，不改main代码。核对网页所需的来源/needs_user_input/失效/重放结果能由库直接表达；发现应用层原子性问题交main。

用实际限定数据量测组合时间/来源完整性与有界输出，必要时优化自身热点，禁止另建检索平台/在线学习。真实模型本轮0；controlled结果与实际模型能力分开。

## C6 收口权威状态与后续消费者

仅维护`packages/context/reports/wave07-status.json`作为本轮汇总，清楚替代旧consumer/status的矛盾描述；历史文件保留。交branch/base/source、拥有路径、main需接的导出与fixture、实际命令/退出码、证据和未完成owner。

先交C1后连续C2–C4及独立性能项；等main入口期间不空转或改HTTP，接口到达再完成C5。只push原分支，不开第二Driver/LLM loop、不自动确认、不动六组用户服务。
