# A：真实历史producer兼容与完整恢复长包

原A目录/`codex/g2-workspaces-verification`，storage/workflows及自有测试报告。读README/0051，合并e438ab5。旧反例8/8、196包和source确认14成立；main只接schema guard，未接你v2/legacy verifier。真实model/native0。

## A1 真实旧producer作为golden

先消费主线`probe-wave18-context.mjs`：真实main v1生产非空binding，原自验ok而你现在blocked。旧family digest51d53c57...与新含work_id配方7022d0a2...不同。不能再将新v2重标v1、截两族代替历史正对照。保留真实producer版本/代码hash/完整family集合和artifact。

## A2 版本专属摘要配方

为明确支持的旧v1与当前v2保留各自真实字段/排序/digest配方，且只识别明确完整的历史family集合。不能为兼容接受任意子集，也不能拿新work_id字段重算旧摘要。mixed/future/missing版本仍拒绝；历史可读能力不能冒充当前完整v2。

## A3 稳定生产接口检查点

当前v2创建/verify覆盖21family、required tables/indexes和所有新列，旧v1非空binding/query源码不变可读。提供readonly verifier的准确能力状态和最小集成清单，不要求main整包导入历史helpers。阶段1–3交第一个真实source。

## A4 一份非空数据贯穿全链

用实际Application/SDK fixture产生reply/候选/明确决定或held工作、context原文和真实Broker问答，再从这一份Store生成快照。各数据必须确实非空且identity有关联，不能分别用两个不相干fixture拼一个全流程结论。

## A5 同一快照第二根readonly HTTP

验证并恢复A4这份实际快照，在第二根运行main recovery_readonly HTTP，读原reply/candidates/source/history/问答，业务POST拒绝、old queue held、provider/native新增0。已有A候选第二根HTTP和问答Store读取分别保留，但不能替代统一场景。

## A6 原source确认与进程窗口

在该第二根消费实际source prepare/confirm/audit/原token核对，same-UoW exact ignore和额外写回滚保持。source事实不成为grant，原credentials/授权不复制。新增格式相关窗口才扩测，已过两次SIGKILL引用原scope，不重复计数。阶段4–6交中期组合。

## A7 D/E可复用数据配方

交参数化的实际生成→快照→verify→第二根HTTP脚本/recipe和准确版本family表，普通同事试用不需手工SQL、伪造verified或借旧凭据。D/E按自己同一安装包产生，无法支持的历史格式明确拒绝。

## A8 有界错误与历史覆盖

真实旧v1至少覆盖非空binding（必需）、reply/decisions/问答的已有支持范围，legacy DB与snapshot格式分别记。缺空表/索引/meta、future schema/不支持协议返回有界阻断，不能抛原始SQL或扩大当前授权。历史迁移append-only。

## A9 成本和一致性

只测变更serializer/schema/恢复路径的rows/bytes/次数与失败成本，不跨await持SQL事务、不全库正文扫描。已有1万binding性能可引用；真实旧golden和完整schema负例在同一回归内。

## A10 整包交付

写`packages/workflows/reports/wave18-status.json`，第三source与真实legacy/current consumer映射。检查点后继续所有独立阶段，不能只修A1就结束goal。main私有许可/target仍未到只阻对应范围，显式owned paths推原分支。

## 独立备选队列

- 私有许可未到：A1–A9数据与source事实可完整推进。
- B恢复未交：用已准入正常受控Broker生成真实问答，不用receipt-only代替。
- D冻结未到：先交可运行参数化配方，保留所有真实golden与旧tar。
