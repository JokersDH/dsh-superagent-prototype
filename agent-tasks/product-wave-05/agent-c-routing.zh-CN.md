# Agent C：完整决定事务、解释型推荐与复核有效性

沿用C目录/分支，拥有context/proposals/knowledge及新`packages/routing/`。先合并main，读第五轮README/0020/0019；shared routing-review是唯一记录parser/type。模型预算0；不自建LLM循环、SQL或执行器。

## C1 先闭合真实存储接线

优先完成 [第四轮接线补充](../product-wave-04/c-integration-followup.zh-CN.md)。主线当前仍复现governance重复record在真实A port上失败，不能把自己的in-memory通过当修复；处理不同时间点的原metadata、撤销/替代后旧重放、改载荷/来源/actor。

交决定只读prepare＋同步commit/revoke消费入口，main同步UnitOfWork里可与receipt/event原子提交。prepare不写，commit重验来源digest/conversation、actor/project/grant/scope和版本；不能在事务里await或事务外先写后补回执。先交该checkpoint后继续C2–C5。

## C2 EvidenceEligibility纯模块

新routing包提供小接口评估B已准入的精确profile、相关能力证明、当前project授权、预算/用途与配置指纹。输出eligible或稳定排除理由/证据；不修改Catalog准入，不读取凭据或调用模型。

actual_native与mock层分开；单字段readiness/native品牌不能越过缺身份/过期/readonly证明。项目/政策/driver/native/model已知身份变化失效，缺证据返回unknown/排除，不推定低费用或低质量。缺可证明只读能力不能当reviewer。

## C3 RouteAdvisor冷启动建议

输入有界任务刻画、已过滤候选、操作者默认/固定规则；输出RouteAdvice。没有候选none_eligible，一个候选only_eligible，多个按operator_default/fixed_rule；初版禁止measured_history、训练reward/概率或虚构排名。

建议不可执行，不含actor/native命令/扩大scope。确认前main重验taskContext/catalog/policy/source/expiry。旧建议、授权缩小和指纹漂移应拒绝；原生未知发送不通过换Agent解决。使用shared完整profile tuple，不按名称模糊匹配。

## C4 ReviewEvidence有效性与模型报告数据

解析ReviewReport并核对subjectDigest、路径/材料范围、产物摘要和报告身份；模型内容是待分析数据，reproduction不成为工具授权。将报告映射给main可信producer组装ReviewEvidence，不让模型自己声明native layer/readonly proof/attempt身份。

提供纯有效性判断：当前author candidate/artifact/合同/环境/check政策、reviewer身份及授权均匹配才current；stale/missing/inconclusive明确。旧证据保留审计但不能接受新patch。no_findings不是机器PASS，复核者不能写humanAcceptance，也不能确认作者Ticket。

## C5 A/main真实消费者与完整交接

接A RoutingEvidencePort：建议→持久→明确确认的命令计划→冻结subject→结构化mock复核→证据写入→新候选/新profile使旧证据失效→重开。实际执行/HTTP由main负责；数据流必须确认前无效果、同操作幂等、事务失败回滚。

覆盖注入/坏report/伪造权限/另项目/旧source/过期/多profile混淆与预算unknown；C1修复不得回归。交公开导出、合法/非法消费fixture、实际SQLite验证、main接线例与wave05-status；只push自分支，root依赖请求交main。
