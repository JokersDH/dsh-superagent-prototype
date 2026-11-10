# Agent C：完整决定事务、解释型推荐与复核有效性

**先读 [修订01](AMENDMENT-01.zh-CN.md)。** C1修事务后，C2优先交无需模型的注意力排序/分组给main；完整路由/第二协议规则仅做有界fixture，等独立价值试点结果后决定继续。不要把sealed_copy误判为“缺native禁写能力”。

沿用C目录/分支，拥有context/proposals/knowledge及新`packages/routing/`。先合并main，读第五轮README/0020/0019；shared routing-review是唯一记录parser/type。模型预算0；不自建LLM循环、SQL或执行器。

## C1 先闭合真实存储接线

优先完成 [第四轮接线补充](../product-wave-04/c-integration-followup.zh-CN.md)。主线当前仍复现governance重复record在真实A port上失败，不能把自己的in-memory通过当修复；处理不同时间点的原metadata、撤销/替代后旧重放、改载荷/来源/actor。

交决定只读prepare＋同步commit/revoke消费入口，main同步UnitOfWork里可与receipt/event原子提交。prepare不写，commit重验来源digest/conversation、actor/project/grant/scope和版本；不能在事务里await或事务外先写后补回执。先交该checkpoint后继续C2–C5。

## C2 注意力排序先交，准入过滤保持纯模块

提供`rankAttention`纯接口与fixture：跨项目问题/候选接受/故障阻断，按真实截止、阻塞关系、等待年龄和问题类别排序，并给可解释原因。缺业务deadline为unknown，不把expiresAt等同业务截止；已过期问题无可发送答案动作。main做聚合读取和工作台，不等pilot或第二Driver。

批量审阅只分组和导航，不合并权限/认证授权或自动替用户作答。覆盖混合项目/另actor/旧问题与候选/截止过期/无截止/同分稳定排序，E可独立构造反例。交早期导出后继续纯Eligibility。

新routing包提供小接口评估B已准入的精确profile、相关能力证明、当前project授权、预算/用途与配置指纹。输出eligible或稳定排除理由/证据；不修改Catalog准入，不读取凭据或调用模型。

actual_native与mock层分开；native品牌不能越过身份/有效性/隔离证明。默认sealed_copy只要求实际胶囊/host范围证明，不要求native禁止写副本；native_read_only替代路径仍要证明。缺隔离/数据外发授权返回unknown/排除，不推定低费用或低质量。

## C3 RouteAdvisor冷启动建议

输入有界任务刻画、已过滤候选、操作者默认/固定规则；输出RouteAdvice。没有候选none_eligible，一个候选only_eligible，多个按operator_default/fixed_rule；初版禁止measured_history、训练reward/概率或虚构排名。

建议不可执行，不含actor/native命令/扩大scope。确认前main重验taskContext/catalog/policy/source/expiry。旧建议、授权缩小和指纹漂移应拒绝；原生未知发送不通过换Agent解决。使用shared完整profile tuple，不按名称模糊匹配。

## C4 ReviewEvidence有效性与模型报告数据

解析ReviewReport并核对subjectDigest、路径/材料范围、产物摘要和报告身份；模型内容是待分析数据，reproduction不成为工具授权。将报告映射给main可信producer组装ReviewEvidence，不让模型自己声明native layer/readonly proof/attempt身份。

提供纯有效性判断：当前author candidate/artifact/合同/环境/check政策、reviewer身份及授权均匹配才current；stale/missing/inconclusive明确。旧证据保留审计但不能接受新patch。no_findings不是机器PASS，复核者不能写humanAcceptance，也不能确认作者Ticket。

## C5 A/main真实消费者与完整交接

接A RoutingEvidencePort：建议→持久→明确确认的命令计划→冻结subject→结构化mock复核→证据写入→新候选/新profile使旧证据失效→重开。实际执行/HTTP由main负责；数据流必须确认前无效果、同操作幂等、事务失败回滚。

覆盖注入/坏report/伪造权限/另项目/旧source/过期/多profile混淆与预算unknown；C1修复不得回归。交公开导出、合法/非法消费fixture、实际SQLite验证、main接线例与wave05-status；只push自分支，root依赖请求交main。
