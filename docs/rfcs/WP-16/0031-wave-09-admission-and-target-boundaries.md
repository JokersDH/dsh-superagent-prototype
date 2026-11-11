# 第九轮验收与共享恢复目标边界

日期2026-11-11，审视基线`7027d31`。本次只读审查A–E精确提交并复跑必要测试，随后按路径接入A备份补齐、C context候选模块和有效决定adapter。结果不是整包/原生/发行通过；下一轮见[wave-09](../../../agent-tasks/product-wave-09/README.zh-CN.md)。

## 1. 候选和实际结论

| 角色 | 精确source | 验收结论 |
| --- | --- | --- |
| A | f2bb24cc609b896ff04f4c39a950f1d39a6058df，代码ee7f382 | 恢复activation纳入快照摘要，45 workflows/75 storage在主线复跑通过；target仍未实现 |
| B | 2434a16c9e12b31f48984451306c7ec39f04db2f | 新资源放行与发送token仍有阻断，未接入生产权限判断；旧可信屏障保持 |
| C | 39d090b5ac0fa4f907d478401e8a2b87dd4a3b5f，代码57a30f5 | 原四项grant probe通过；context56、主线knowledge54通过；自定义group种类别名仍越权，辅助确认命令ID不一致 |
| D | 50c3471f76b1bc9eb4ee1f8ba25a62f37a682a38 | 旧四项有修复，但孤儿API/空集合停止证明仍阻断个人升级准入 |
| E | 4abfcc5fe0b1a74b865a06d374cf5bc98e8451e4 | 旧v1身份迁移/缺模型身份负例已关；费用实际链仍可unknown→0，安装未消费D最新pair或托管升级 |

main的提案网页/source审计已经在b436fde/7027d31交付。context HTTP/UI、完整target准备/激活仍是主线欠项，不能把它们继续登记为“C未写HTTP”或让其他owner等整包才拿接口。

## 2. 本次实际集成与测试

A ee7f382按原commit接为63cc3da，仅拥有路径；其备份family现在覆盖schema15的recovery_activations。C按57a30f5精确文件接入context src/test及knowledge context-provider src/test，未接入有问题的confirmWithCommand，也未复制C分支自报报告来当main证据。

共享目标接口和上述候选模块位于主线`e95544f`。context仍无产品HTTP/模型注入入口，不能因为文件进main就叫权限准入。独立复跑：context56、knowledge54、workflows45、storage75全部PASS；相关提案/决定/source审计22 PASS；相关typecheck/build通过，原Runner/data hash保持不变。

旧probe：`node tools/bootstrap/probe-wave08-context-grant.mjs <checkout>`为4/4 PASS，过期/purpose错误在provider读取前拒绝，caller预算夹紧。

新probe：`node tools/bootstrap/probe-wave09-context-proposal.mjs /Users/hh/Desktop/joker/superagent-agent-c`，正对照均PASS，两项反例FAIL：

- grant只允许artifact，却通过name=decisions/sourceKinds=[artifact]的自定义group调用decision provider，返回decision slice。统一gate修了时效/预算，但专用provider仍需校验真实kind；非法group计划必须先拒绝。
- confirmWithCommand的effectCommandId=effect-one、plan.commandId=other-command时，仍写confirmed并返回另一command。必须在写状态前绑定身份；main现有plan+commit组合不使用该helper，未受此新入口影响。

## 3. B/E仍需阻断的事实

以下来自精确源码审查和纯内存fake probe，无实际spawn/模型/账本落盘：

1. B resource-facts没有消费既有VerifiedRunnerInspection/proof WeakMap，普通JSON缺writer、时效、machine、attempt/source等仍能releaseBarrierSatisfied=true；语义还把serving视为可放行，与main需要terminated/closed和完整注册资源的规则不符。不得替换现有resource-barrier。
2. B consumeSendToken只检查WeakSet，不消费token；同token并发两次、同reservation可fake send两次，签发后hook/transport/input也未冻结绑定。
3. E不调用B实际sender，仍可凭owner="b"的descriptor spawn entry.command，继承整个环境。fake admission={ok:true, entry:/usr/bin/true}且无reservation仍触发fake spawn1。B函数接受任意注入transport不等于唯一实际运行器。
4. E直接缺costUSD settlement已修，但harness→costOf把缺input/output明细用0计算：totalTokens1500、input/output=null可computedCostUSD0并SETTLED、unknown清零。须以完整可核对计费组件为前提；否则保留上界与unknown。
5. B诊断override全部billing能力可产生billableAdmitted=true且model/provider=null；展示数据与准入权威必须分开。

E旧v1 wrong grant/caps、unknown/reservation及缺model/provider拒绝已独立确认，保留修复，不重跑已封存的费用可行性调查。当前recipe仍BLOCKED，B原grant余量UNKNOWN不可花，E原grant不重置，本轮所有阶段真实模型0。

## 4. D进程一致性与E安装范围

D已移除固定--fixture、增加mode核对、先清理失败target、精确schema错误断言。但实际消费者仍只跑fixture，personal参数测试不等于personal升级实测。仍有阻断：

- upgrade/recover/rollback只判record.pid，launcher死但apiPid活仍可换指针。必须核对全部登记资源，复用已有孤儿API逻辑。
- stopOwnedTarget过滤掉命令不匹配的活候选后，可返回proven=true/considered0；spawn/cleanup身份未持久化，journal忽略cleanup，重启缺record时又以空集合证明停止。
- record_missing注入发生在真实record已出现后，不是真正health成功/记录未落盘窗口。成功binary_rolled_back还被doctor当未结算，建议的recover却拒绝该终态。

真实tar身份和本机只读hash匹配：

| D pair | source / build / schema | SHA256 |
| --- | --- | --- |
| baseline | e10bfdb7a74f40b72a5e61d0debb0ed0bdd22389 / 7e8f6ce6fa2e2633 / 13 | 0fe0ed53e6c4f50ff87fa9fe14518f1f45ca4bbf3c5cb9322c8babbeed1c7631 |
| target | 9b75c2a1a3e3ce7a1b95983f2e8500a2cd59b82e / cd0ecc29d97d5c41 / 13 | 64bbe285d472b1dbaf3830899dabdefdc3ed9a69a750b537e0ee14397ca53d42 |

target只包含旧main5d4065b，不含7027d31的提案UI、A schema15和source审计。不能因为D文档写“含0030”就当作当前main安装物。

E实际受测产品source8195d31dfda2bf922045c39688c9c59e29219cfe、clean，自报125 PASS/15 NOT_TESTED；安装pair仍为dirty9046d4c5/schema12/buildb0f87c88 → 76f26a66/schema13/build9120a5ed，非上表D新pair。其用例是两个安装物先后start --fixture指向同一state，未调用D托管upgrade/rollback。旧结果保留对应范围，不能扩大成最新个人版托管升级PASS。

## 5. 现在已发布的目标准备接口

真实共享schema/ports在[recovery-target.ts](../../../packages/contracts/src/recovery-target.ts)，生成JSON/manifest独立于冻结Runner协议：

| 接口 | owner与职责 |
| --- | --- |
| RecoveryTargetConfiguration | main构造：唯一项目映射、原有严格ProjectRegistrationInput、精确ExecutionProfileRef，不含账号/API key/argv |
| RecoveryTargetPreparation | main在真实source确认后传给D；包含原commit及configuration，startupAvailable固定false |
| RecoveryTargetMaterializer.prepare/read/discardStaging | D在可信私有parent准备/读材料，只能清理可证明归本activation的staging；不启动进程、不复制旧库/queue/session/凭据 |
| RecoveryTargetInventoryReader.inspect | A同步只读、不迁移/创建目标库，给schema/integrity/一致字节摘要、完整table分类与行数；unknown/bounded不伪装空库 |
| RecoveryTargetMaterial/Inventory | 只是材料/观测，startupAvailable固定false，不能产生物理停止或启动授权 |

main的[bindRecoveryTargetConfiguration](../../../apps/coordinator/product/recovery-targets.ts)已实际实现并测2项：严格解析并快照配置，核对configurationDigest，漂移在任何文件工作前拒绝。schema有2项测试，相关构建/类型与生成一致性通过。它不验证便携JSON的真实source权威；实际流程还要重读A facts/receipt、当前host/profile/资源、D材料字节和A inventory，再由main授权。没有新增commit/activate HTTP，target实际实现仍待本轮整包。

这使A/D可立即实现同一接口，无需先自造DTO等main再对齐。D异步材料准备在source事务外；A只读inventory不能被当作释放旧writer的证明。Ticket/Assignment仍是唯一业务执行生命周期，目标generation只是本地启动材料身份。

## 6. 第九轮执行约束

main优先完成context产品接线、恢复source→私有空target→明确activate链；A/D做真实目标读验/准备，B修可信资源与唯一sender，C修两项反例并给consumer，E用当前source和完整artifact tuple走真实网页/托管升级。先checkpoint后整包，各自六阶段连续执行。

不新增模型预算、Driver/CAC/桌面壳/自动接受。原七组实例5180/8796至5186/8802均保留；本次验收没重启用户服务。研究封存BLOCKED不阻断产品；缺真实native/control/target/安装证据继续按层标明，不给总完成百分比。
