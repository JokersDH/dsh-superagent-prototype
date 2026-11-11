# 第八轮：日常工作闭环与安装版本收口

日期2026-11-11；审视基线`436dc02`。本轮入口为[wave-08](../../../agent-tasks/product-wave-08/README.zh-CN.md)，延续A–E原目录/分支和所有权。这里区分候选自报、独立反例与实际集成，不因派工推进而提升准入层级。

## 1. 当前输入和本轮决定

| 角色 | 精确候选 | 已有进展 | 本轮不应重复的工作 |
| --- | --- | --- | --- |
| A | da5f62afc48692c6dd6f15a4ef4fd46734e635d0 | schema14旧plan intent、证据分页/快照；自报75 storage/38 workflows | 不再新造旧RecoveryPlan确认接口；先消费0027已公布的RecoveryActivationFacts |
| B | 748942e48030f9dba5d42ea7b07bc2bf7dde78f8 | 六gate准入、真实协议/Seatbelt探针；NO_SUPPORTED_BOUNDED_RECIPE | 不再反复导出协议、试goal预算或补价格文件来维持pilot推进 |
| C | 2d2fa10a5649c0e02759f349ada7e0edd92c6fd6 | composer、decision provider、提案组合；旧决定复活已修 | 不重做main已交的提案HTTP；先补composer授权边界 |
| D | eca5674155a7d828ef15a17f5814b610a7cdc095 | first-run空值已修，两个真实不同来源tar和升级框架 | 不再把第二产物说成不存在；补实际模式/失败进程/准确拒绝原因 |
| E | 1a776d77271b5810d34b25a0398662a684485a48 | 预算默认拒绝改善、旧组合安装/受控产品验收 | 不把旧安装组合或旧main的结果映射到新候选；补剩余预算漏洞与同源消费 |
| main | 436dc023c6fad30716baa0d64ac14562f0216880 | 提案prepare/confirm/reject HTTP、原业务效果同事务；46+33分范围回归 | 不重写命令API，把网页/恢复目标启动接完 |

B的结论是“当前没有经验证满足原grant的recipe”，不是证明厂商内部绝无限制，也不是独立复核没有收益。pilot保持BLOCKED、默认禁用；本轮产品/安装工作独立推进。新协议Driver、CAC、桌面壳、自动接受和云多人服务仍不进入实现范围。

## 2. A持久记录仍需对齐

A HEAD未包含上轮0028反馈后的实现更新。已复现的mapRow问题仍适用该source：payload保存recovery-intent envelope，却将整个envelope当RecoveryPlan返回。需覆盖record/get/list/reopen完整schema与摘要，不能只测planId。

旧RecoveryPlan intent不包含target generation/root/config、machine/resource policy，不能冒充0027的RecoveryActivationIntent。A消费现有共享RecoveryActivationFacts的get/forCommand/put；历史旧记录保持审计、不可隐式升级为新授权。迁移仅A追加，不能改已发布migration14或清空历史让测试过。

main的RecoveryIntentCommitter已经存在。A生产port交付后，main接source事务与目标准备/启动，D消费权威descriptor；A不决定HTTP授权或进程启动。

## 3. C旧问题已关，新composer仍不准入

C `0179889`已修listSync历史supersession。主线在`ac12cb2`只集成该精确变更，运行旧probe得到`PASS_SUPERSESSION_NO_RESURRECTION`、activeIds=[]，knowledge build和50项回归通过；composer并未整体启用。实际检查记录见[wave08状态](../../../reports/releases/wave08-integration/status.json)。

本次只读独立probe：

```sh
node tools/bootstrap/probe-wave08-context-grant.mjs /Users/hh/Desktop/joker/superagent-agent-c
```

在上述候选valid_control先PASS，三个授权反例均FAIL：expired_grant、budget_above_grant、purpose_mismatch，provider各读取1次，授权maxBytes=32却返回1219 bytes。原因是composer只parse grant和gateway，特殊decisions/conversation/artifacts路径绕过ContextReader的统一授权，budget又用caller值替代grant上限。

C必须在任何provider被调用前校验期限/purpose/项目/actor授权和来源种类，统一夹紧或拒绝超过grant的budget，保持有效决定完整扫描/显式截断。零/NaN/负数/超上限也需拒绝；仅在原reader重验不足以覆盖专用provider。main不得靠固定groups掩盖库边界错误。

## 4. B/E试点冻结与有限修复

B调查已经收敛，原grant UNKNOWN不可花，E仍0/24。当前缺adapter descriptor时不发送是正确结果，但代码不能因此被称作预算链已完全闭合：

1. E runner.mjs的v1迁移只核对少数字段为零；wrong grant/caps、BLOCKED_UNKNOWN_USAGE、非零reservation/unknown仍可legacy=true并变成新零账。迁移必须核对完整身份/上限/历史与unknown；无法证明则拒绝，不重建。
2. E evaluateAdapter缺model/provider仍能ok，usage缺costUSD可按0处理。身份缺失拒绝；未知费用保留reservation/unknown，不能解释为免费。
3. B admit固定审B grant并返回app-server/Seatbelt描述，E实际guardedSend仍spawn CLI exec并继承环境，两者不是同一执行路径。descriptor字符串/布尔字段不能替代实际adapter调用和进程树隔离。

B/E本轮只交一个有限修复检查点：显式grant上下文、单一实际发送实现、B负责运行路径、E负责持久预留；E不得另有CLI后备入口。缺上界时两边都返回拒绝，验证fake发送0，不启动模型。研究执行入口继续封存BLOCKED，不再给两人分一整轮重复协议调查。

B其余重点转为既有运行时产品诊断、受控控制恢复和main/D可消费资源事实。真实native控制缺预算仍NOT_TESTED，不能通过命名“诊断”隐式发turn。

## 5. D实际升级与E来源不能混淆

两份tar本机SHA与清单匹配，均schema13：

| 产物 | source/build | tar SHA256 |
| --- | --- | --- |
| wave06-alpha2 | e10bfdb7a74f40b72a5e61d0debb0ed0bdd22389 / 7e8f6ce6fa2e2633 | 0fe0ed53e6c4f50ff87fa9fe14518f1f45ca4bbf3c5cb9322c8babbeed1c7631 |
| wave07-target2 | 76f26a66c0554f7294de98637198a01c3703e69a / 9120a5ed858e0feb | bbc133125271da6925e2c1a16122c487e93fe760463dd2be304dab748e137912 |

fresh firstRun的null commit已在D当前源码修复，不能继续拿c9a0698旧反例否决新源码。升级实现仍有四个独立残余：启动目标固定传--fixture；target_unhealthy注入在spawn后回退指针但未停子进程；rollback没有upgrade同样的未知活PID阻断；所谓schema不兼容反例实际因release_artifact_missing退出，非零退出不足以证明schema拒绝。

D必须保留personal/fixture原模式和实例/项目/profile身份，失败先核对并停止自己拥有的目标进程，再恢复一致指针；未知活进程继续阻断。数据回退与binary回退区分，禁止静默删除升级后数据。schema测试先确保安装物/依赖完整可启动，再断言准确不兼容原因。

E当前e4-install固定使用更早dirty schema12 build b0f87c88与wave06 schema13 build7e8f6ce6。其UPGRADE PASS和CONFIG-ROOT FAIL均属于旧组合，既不能覆盖也不能否决上表最新目标。下一轮将产物作为带hash/source/build/schema的显式输入；旧结果保留历史，最终installed verdict使用main新集成source构建的新目标。

## 6. 产品出口与主线责任

本轮日常流程：用户在主对话明确选择提案/委托，预览上下文与来源，确认完整scope/profile/检查，执行后审阅证据并接受；响应丢失/刷新仍使用原命令身份。来源/模型文本始终是数据，不成为权限。main沿用既有石墨/白/青绿工作台完成实际网页，不另做营销或静态稿。

恢复出口：旧历史保持readonly，明确确认后source事实+receipt提交，在私有根准备新空执行state，核对source事实/目标内容/物理资源，再启动新工作。恢复代际不引入新Ticket生命周期，不复制旧queue/native session/凭据，不把PID缺失或旧ended当当前屏障。失败可重入，未完成的启动入口保持关闭。

main本轮先提供可运行网页和A/C/D最小准入source，不让五个整包完成成为集成前置；给D冻结目标后E再独立验收。若目标激活未完成，则把“日常闭环”和“恢复可执行”分别报告，不能将恢复排除后称完整Alpha。

所有预算/服务/历史保留。任务包每人六阶段，先push可运行checkpoint再做独立项；遇接口等待留最小复现并继续包内工作，不无限轮询。新结果各owner仅一个wave08-status；当前计划静态检查不算产品、模型或安装通过。
