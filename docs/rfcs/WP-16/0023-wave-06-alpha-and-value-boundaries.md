# 第六轮共享边界：价值试点、日常闭环与个人 Alpha

日期2026-11-11。输入`ece95d1`及A `99a192b`、B `6b4e4ab`、C `9a39908`、D `809a957`、E `34ff976`候选。状态：实施边界与准入约定，不是接口全部实现或候选已通过。本轮派工见 [wave-06](../../../agent-tasks/product-wave-06/README.zh-CN.md)。

wave-05修订01继续优先：价值初筛先于新增Driver，密封副本默认，R0前推荐/复核默认关闭，预算不刷新。旧架构Ticket/Assignment唯一生命周期和物理资源屏障不变。

## 1. 所有权与接线顺序

main拥有公共schema/application/questions/coordinator/console/root lock与共享文档；A拥有storage/workflows及唯一生产迁移；B拥有原运行时/Driver/Catalog/测试工具；C拥有context/proposals/knowledge/routing；D拥有launcher/distribution/portability；E只拥有product-acceptance。各自代码和自有证据继续原工作区/分支。

main先独立复验并发布A/C/B的最小可消费源码，再做真实组合；A/C不因彼此完整包尚未结束就互相等待。跨模块只通过已发布port，不能复制SQL writer、优先级算法或私有公共wire。B旧recovery transport的窄例外仍保持一份实现/proof WeakMap及protocol-v1；main不并发修改其保留区域。

本轮只调度现有Codex路径。第二协议仅保留已有零模型调研，不把pilot promising当作本轮自动开工许可。已存在的纯路由/复核模块可做兼容负例，不扩建完整平台。

## 2. 注意力：直接消费0022

公共来源：[attention.ts](../../../packages/contracts/src/attention.ts)。C提供符合AttentionRanker的函数：输入items/now，输出完整id排列及共享reasons；main负责来源、范围、HTTP/UI，不再另写业务优先级引擎。A只补实际需要的读索引。

- sinceAt=null是未知。不得写成1970、当前时间或“0毫秒已测等待”；内部中性排序值不能回填为观测事实。
- deadlineAt只来自真实业务期限；expiresAt是答案有效性。业务已过截止但未失效的问题仍可按原规则回答，过期native答案不得发送。
- shared blockedWorkIds表示当前事项实际阻塞的work身份；C旧blockedBy是入向依赖，不能直接同名替换。只转换真实可证明边，不从文本猜关系，也不创建执行DAG。
- “临近截止”理由必须有明确窗口与实际时间支持，远期deadline不能一概标紧急；原因必须解释实际规则，不能输出模型概率/ROI。
- 相同输入与显式now产生稳定结果；unknown、同分、跨项目/会话、旧问题/旧candidate、混合权限均有反例。分组只用于导航，权限/认证仍逐target。
- main当前按工作索引有界分页；本页排序不宣称全库全局最优。C不能为凑齐一个排列伪造/丢弃来源项。缺少公共原因枚举等语义时交main RFC，不复制schema。

## 3. 接受观测与持久投影

main已在成功接受同事务写application.candidate.accepted，payload绑定candidate/actorRef/reviewTiming；重放不重复。A消费该记录为精确ExecutionOutcome/时间线关联，不能再创建一份接受事件或执行动作。

A提供同步、幂等、参与现有UnitOfWork的消费入口或有稳定消费身份的投影。关联candidate、attempt/profile、artifact、verification、接受出处必须逐项可核对；未知来源不升级为actual_native。按已有事件继续/重开或回填时，不从缺记录补造0、价格或接受事实。

readyToAcceptanceMs是墙钟等待，activeReviewMs是部分UI代理；两者不能相加，原始UI活动不是权限或质量证据。多个tab同候选取并集；跨候选总人工时间也不能简单相加。schema13及后续必要迁移仅A追加，main负责是否将消费者接入生产事务。

## 4. 决定/提案：只读prepare与同步commit

C的DecisionTransactionService负责领域重验，A的AssistantStatePort负责持久化，main负责认证HTTP命令、receipt/event/效果的同一事务以及UI。客户端/模型不能提供可信actor、原生权限或直接SQL。

prepare不得写数据/排队；用户确认时main重新验证当前目标、来源digest、项目/grant/scope与版本。同步commit/revoke必须在main的UnitOfWork内，不在事务中await，也不在事务外先写决定再补receipt。领域规则同版本重放、撤销/替代后旧请求、改payload/actor/source的语义由真实SQLite消费者证明。

副作用只能来自明确确认的既有业务命令；讨论、记忆记录、复核报告不自动授权执行。撤销的决定不能继续进入新上下文；历史审计仍保留。main先发布真实共用命令schema与错误/receipt样例，C/D/E消费，不能各自猜HTTP shape。

## 5. B/E试点运行边界

B交现有Codex的受限运行能力：精确native/model/配置身份、真实作者checkpoint与续会话、新session隔离、输入/报告摘要、可限制并核对的用量、停止及未知发送核对。E拥有试点病例、冻结/评分及grant调用；B不代E消耗额度，也不另跑付费联调。

pricing_unavailable是当前已知明确阻断，不能填估价或0绕过；补上价格后仍须验证真实会话、材料/宿主边界和单turn上界。价格表绑定实际provider/model与日期，引用可核对来源；网关或别名不能套另一个产品同名价格。usage含所有计费部分；不支持保守预留和停止上界就保持BLOCKED。

默认密封副本无.git/共享objects/remote/hooks/危险链接/共享inode；可写scratch与原始候选材料分开。允许的scratch变化不等于原输入变化，原输入变化则证据invalid/inconclusive。副本不是宿主沙箱：工具/文件、账户home、凭据、网络和外发范围还要限制。提示词或更改cwd都不是证明，报告中的reproduction也不是执行授权。

试点仍仅原`wave05-independent-review-pilot-01`：24 bounded native turn、200000累计计费token、USD5、一个turn在途、先到上限即停。unknown保留预留；不得自动换ID重发、退款当未发生、补样本或转入B账。main/A/C/D与E其他任务真实模型预算0。

### 两个冻结时点

预注册需要区分可在作者执行前固定的规则与作者执行后才产生的产物：

1. 作者调用前固定协议、案例任务/初始材料、oracle/变异配方、评分、顺序seed、模型与预算。不得在看到结果后换案例、标签、阈值或规则。
2. 作者实际执行后、任一review开始前，固定该例真实checkpoint与candidate内容摘要。若采用预注册的缺陷注入，各arm使用完全相同的最终材料，明确合成干预，不冒称自然作者失败。

上述是运行前必须对齐的时序要求，不允许静默改已冻结protocol.json。当前protocol/冻结工具若要求作者产物也在作者调用前存在，或与此时序不一致，E须报告protocol_semantics_unresolved；main先发布有版本/摘要的澄清，E在0调用状态重新冻结后才发送。预算、8例4缺陷/4干净、三组对照及promising阈值均不因澄清而自动改变。案例偏离预注册前提如实invalid/inconclusive，不能悄悄修成想要的标签或替换样本。

重封存前必须用实际ledger确认仍为0调用；若已有调用，停止受影响执行并保留原协议、样本、费用和unknown，报告协议兼容问题，不能覆盖旧冻结、重置额度或自动另开实验。每例/每arm的token/费用/输出/时间上限也须在发送前固定，不超grant剩余量，不能看了结果再调。

## 6. 恢复新授权：main负责业务边界，D负责消费

旧marker保留，旧profile、writer事实、原生session和旧机器签名都不能自动在新机器/目录成为授权。DB打开、路径重映射或用户点击继续都不是原writer已停的证明。

main须先发布恢复检查、准备重绑定计划、明确提交新授权的公共接口。语义固定如下，具体schema/HTTP在main首个接口checkpoint发布前均为PLANNED：

| 操作 | 要求 |
| --- | --- |
| inspect | 只读列出恢复状态、可核对来源与阻断，不投递旧业务队列 |
| prepare | 复验当前机器/项目路径/执行器/环境/证据与资源状态，返回绑定快照的有期限计划；不授予执行或启动native |
| commit | 认证用户对精确计划、当前指纹/版本显式确认；receipt、授权与必要状态同事务，重复幂等、漂移拒绝 |

重新授权只允许被明确授权的新工作/新合同；历史旧队列不自动消费，未知writer屏障不被抹掉，禁止删除marker或新增绕过开关代替方案。若当前运行时不能同时保证上述条件，commit保持未开放，D/E准确报告BLOCKED，不能为通过安装测试降低边界。

D只调用main入口，不建立第二认证/密钥存储或调度器；A仅在需要时提供自有迁移/事务port；B提供实际控制与资源事实；E验证旧业务不重放、计划过期/漂移、重复提交和失败回滚。无接口时D继续空state安装、备份字节、升级/回滚和失败诊断，E继续反例与已有产品验证。

## 7. 同一来源的安装与准入

D交可迁移安装物的source commit、buildId、manifest digest、依赖闭包、平台/Node/SQLite ABI与许可。E从同一字节产物在新目录独立执行，让原checkout不可用；不得混用D旧包、main新源码和B另一版本的证据凑一个绿灯。

备份包含A真实引用的决定/设置/合同/候选patch/验证/结果与时间线证据，逐字节核验；没有真实持久记录的研究数据准确unavailable，不扩张分析仓库来凑覆盖。未知/坏/缺artifact、IO中断、路径逃逸和不可回退schema必须拒绝；回滚不能隐式回滚或删除用户数据。

准入分列：module、controlled-product、actual-native-control、installed-alpha、review-value。E严格gate与main独立准入同时需要，任何一个较低层PASS都不能替代更高层必需项。个人Alpha不要求第二协议或复核收益为正；完整默认推荐/复核仍必须另过R0和新路径门槛。

## 8. 发布顺序与未实现范围

main早期发布A/C/B可消费检查点以及必要公共schema；随后接注意力/决定，再接恢复授权；D冻结集成产物，E做安装/产品及有界稳定性。B/E在前置可验证后优先运行pilot，不等完整发行或第二协议。

本文件只固定语义和责任，没有创建新HTTP实现、解除recovery_readonly、运行模型或认定R0通过。本轮实际进度由各自证据与main准入报告更新，不能根据派工日期推断完成。
