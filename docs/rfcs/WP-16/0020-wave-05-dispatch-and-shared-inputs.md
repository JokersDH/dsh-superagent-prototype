# 第五轮派工与稳定消费输入

日期2026-11-10。基线`21b9eef`。用户要求按修正后的架构方向继续安排A–E；本轮实施入口为 [product-wave-05](../../../agent-tasks/product-wave-05/README.zh-CN.md)，它将0019的“推荐＋只读复核”窄路径转成任务，不批准竞速、自动接受或新增模型额度。

## 1. 已检查的上一轮交付

| 角色 | 最新分支候选 | 当前可确认范围 |
| --- | --- | --- |
| A | 1dddee9 | 已集成schema12、assistant持久port、成员索引；主线会话和设置纵向可用 |
| B | 56b1e61 | wave04报告修复假通过、预算预留、生产ProcessHost停止；报告native任务0，实际vendor控制/问题窗口仍未测；main尚未整包复验 |
| C | 45bf9de | 原三项独立领域probe通过，真实SQL6/7；同决定重放与决定同步commit仍由C补齐 |
| D | bf85594 | staged依赖闭包/精确实例/回滚门禁与45步smoke是候选；报告指出恢复项目绑定的main缺口，main本次已修复供其复验 |
| E | 9257d76 | 50项gate自测和controlled产品证据；main原full-product反例现被拒绝，但完整安装/新助手/实际native仍需新基线独立验证 |

报告中的旧基线限制不冒充当前main事实。例如E旧报告尚写C三项未修，而main独立probe现在通过；D旧错误在本次修正后需按新行为验。任务已交付与产品准入分开，未运行真实vendor的记录仍NOT_TESTED。

## 2. 共用记录与同步持久port

唯一来源：`packages/contracts/src/routing-review.ts`；新增product companion schema/manifest在`generated/routing-review.*`。运行时cross-field规则仍用Zod parser，schema-valid本身不是可信来源证明。

| 导出 | 含义/关键约束 |
| --- | --- |
| ExecutionProfileRef | profileId＋revision＋identityDigest；digest必须解析到可信完整兼容/配置快照，不按品牌或同名最新版本代替 |
| RouteAdvice | project/source/task/catalog/policy绑定，eligible/excluded、精确建议、原因、时间/到期；仅none_eligible/only_eligible/operator_default/fixed_rule，无模型概率或measured_history |
| ReviewSubject | author candidate＋artifactDigest＋baseCommit＋environmentRef＋checkPolicyRef |
| ReviewReport | subjectDigest、findings/no_findings/inconclusive、summary、范围内path/line/severity/claim/reproduction、limitations；不是PASS，内容不变工具授权 |
| ReviewEvidence | subject、reviewer profile、独立reviewAttempt、input/report摘要和reportArtifact、readonly proof/出处/layer；不接受humanAcceptance或作者assignment复用 |
| ExecutionOutcome | attempt/profile/candidate与验证/接受引用、layer、usage完整性与可选duration；accepted需候选/产物/验证/接受/出处，不含“模型自评分正确率” |
| RoutingEvidencePort | advice/reviews/outcomes的同步put/get/list；project必需、有界cursor，review可按完整subject过滤、outcome可按精确profile过滤 |

Schema拒绝重复/交叉eligible与excluded、选择未准入候选、虚假单候选basis、无出处的推荐、失效时间、把review变PASS/接受及错attempt的outcome。数据写入仍只由main可信producer或自有隔离fixture调用A port；不增加任意客户端写证据入口。

`createWorkflowPorts(store).routingEvidence`由A实现，所有写同步加入原UnitOfWork。put同ID/完整body重放幂等，改body冲突；原记录不可变。get是内部port，main对外读取前必须再次验证project与当前用户授权，不能把id存在等同可读。

EvidenceLayer是actual_native/controlled/protocol_fixture/schema/operator_note。E内部已有层名可显式映射，不复制一套公共wire；model或native协议输出不能自己选择可信layer。用于费用的UsageObservedPayload沿用既有parser，字段缺失/unknown不填零。

## 3. 第一个真实消费者与模块归属

A先交证据store；C先交决定事务修复与纯Eligibility/Advisor；B先交精确profile resolver及一个第二协议的readonly入口；main将这些接入命令/HTTP/UI。D可立即复验恢复修复和上一版安装物，E可立即构造独立负例，不被新Driver阻塞。

B拥有catalog/policy-preparation/execution/driver-kit/testing/runner/driver源码，C拥有新packages/routing；main拥有contracts/application/questions/coordinator/console。A唯一生产迁移；main唯一root lock。第二协议的新包可位于drivers/acp或经实际协议确认的zcode-native/dsh-native，不能因命名方便伪装Codex驱动。

本轮ReviewEvidence明确使用独立辅助Work/Ticket/Assignment，与作者Work/Ticket/Assignment不同；subject为持久关系，由main创建与授权。两者仍复用同一已有生命周期，不再新增一套review执行状态机。辅助任务完成绝不确认作者候选，作者也不因reviewer仍运行被误认又开始写其冻结patch。

ReviewReport由native输出解析，main/B核对subjectDigest与原输入材料；main可信producer根据实际attempt/policy/readonly/产物组装ReviewEvidence。C负责有效性判断和建议，A存事实，E验反例。任何模型文本都不能直接提供actor、readonly证据或native-layer宣称。

## 4. main已修复的恢复依赖

D的RECOVERY-PROJECT-BINDINGS源于恢复project范围为`.`且排除.git，但Runtime在无native执行配置时把它当固定src/ fixture grant，导致启动拒绝。

`createProductRuntime`现在接受startupMode。readonly模式保留恢复项目scope用于历史读取，`start()`明确拒绝业务effects；demo把自动restore marker结果传入。HTTP的派工配置/动作清空和POST拒绝继续保留，不通过放开写权限来修复。

独立进程回归覆盖不带/带native-projects.json两种恢复，携带normal/native/assistant标志仍只能readonly；项目可见、全部派工关闭、旧execute/assistant/answer队列不改变。未实现解除隔离或新授权，不代表恢复后可继续旧native工作。

D应更新自有repro和E安装测试为新行为成功，不把旧报错“复现成功”当新实现准入。所有测试用新私有目录/端口，不改用户四组现有服务。

## 5. 真实运行预算与验收

本次主线启动模型任务0。main/A/C/D/E仍为0。B本轮不新建grant，沿用wave03-b-native原limit4和实际used/unknown；报告值used0，历史其它批次used3保留分账。开工必须以持久ledger核对，不从文档值强制覆盖账本。

原剩余预算优先必要Codex控制缺口、第二协议复核、readonly拒写/停止目标。直接CLI/SDK也属于可能发送模型业务的入口，必须先预留。未知发送不换ID重试、不从reserved退款当作没发生；任务/phase/日期变化不刷新预算。真实收益大样本另立预算，本任务不运行。

独立准入出口分开：个人功能闭环、advisory推荐、controlled复核、actual异构复核、installed个人试用。高层tier不能以较低层或自报替代；required review缺失/unknown不算no_findings；机器FAIL和human条款继续按原gate。

## 6. 每个Agent的整包交付

每人五个阶段、先发稳定源码checkpoint然后继续独立队列，不逐小修停工。交base/source commit、拥有路径、接口/依赖请求、命令/证据、模型与未知账、缺口owner及下一消费说明。原目录/分支/用户更改保留，只push自己分支。

新方向只引入必要的建议与复核记录，不扩大到通用平台。main在依赖实际通过后集成，不因上一轮“全部完成”就宣布全部验收通过。task packet和本检查点是可供用户直接下发的具体输入。
