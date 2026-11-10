# Agent A：路由、复核与结果的证据持久层

**先读 [修订01](AMENDMENT-01.zh-CN.md)。** 先补R0及当前观测所需最小计时/来源，关联main新`application.candidate.accepted`中的ReviewTiming；等待时长和UI代理分开，unknown保留null。pilot闸门前不扩通用历史reward/分析仓库；新ReviewEvidence支持sealed_copy隔离，不能沿用仅readOnlyProofRef的硬过滤。

沿用A目录/分支，拥有storage/workflows和唯一迁移。先合并main，读取第五轮README/0020和contracts routing-review。旧v11/v12已集成，不重复实现AssistantState或成员索引。模型任务0。

## A1 稳定证据port与追加迁移

实现`createWorkflowPorts(store).routingEvidence: RoutingEvidencePort`，采用shared RouteAdvice/ReviewEvidence/ExecutionOutcome parser。同步方法加入同一UnitOfWork；创建者/可信producer由main组合，不增加任意HTTP写证据入口。

v13+只追加迁移。记录不可变：同ID同完整payload重放返回原记录，不同payload冲突。source/project/profile版本、review subject、layer及出处保留原值；新当前性由读投影判断，不原地改旧记录。put与receipt/event/effect可同事务回滚。

真实SQLite测创建/改载荷/重放/第二进程重开/事务任一点失败，先交该checkpoint，继续A2–A5。

## A2 面向消费者的有界索引

advice按project/时间分页；review按project＋完整subject查；outcome按project＋精确ExecutionProfileRef查。显式project作用域，空scope不变全局读取；cursor稳定、无重复/跳页，未知引用不给假当前性。

不要将control/protocol/schema层记录混为native训练数据。兼容测试不是任务质量；accepted必须有真实verification/candidate/artifact/acceptance来源。缺usage保留completeness=unknown，不填0费用或虚构人时。

## A3 结果采集与来源一致性

通过公开只读port从已有attempt spec/binding、verification、接受回执、usage facts提供main所需出处；SQL和迁移仅A。main负责决定何时写ExecutionOutcome，你提供可重建/幂等采集输入，不能因有一个artifact行就声称它属于当前候选。

用户改目标、环境失败、明确返工与质量缺陷分开保留事实，不自己推断reward。C的推荐只读取符合来源/layer/版本范围的记录，不能让raw worker文本伪造accepted/native。

## A4 任务证据时间线与完整快照

提供单任务有界时间线投影/引用清单：授权、执行身份、问题、物理停止、候选、检查、复核、用户接受和失败诊断可关联。事实时间线不是因果或反事实证明；不做泛化分析仓库或第二套事件权威。

WorkflowSnapshots包含新增记录引用的report/snapshot/patch产物；以备份DB的引用清单复制并校验。坏/缺文件、来源丢失、IO失败或旧schema升级要明确blocked。D恢复策略留在D/main。

## A5 C/main/D真实消费者交付

跑真实SQLite纵向：建议落盘→作者候选引用→独立review记录→outcome→关闭重开→同ID回放→旧subject/新profile不被读成当前。加入C实际模块消费，确认append/CAS约定一致，不只测试自有fake。

交v12→新schema、旧决定/在途合同/旧交付保留、source/ref完整快照、性能与查询边界证据。新增依赖交main生成root lock；只push自分支。命令/结果和未接线范围写wave05-status，全部独立阶段完成再交整包。
