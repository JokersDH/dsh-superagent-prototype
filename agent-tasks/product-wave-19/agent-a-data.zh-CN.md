# A：双格式、真实业务与持久恢复整包

原A目录/分支，仅storage/workflows及自有测试报告。读README/0053，合并main9856124。真实v1兼容及196包scope保留，不重修旧work_id摘要问题。主线已选择性合入版本配方，但默认1/显式2并保留完整valid schema guard。真实model/native0。

## A1 对齐已发布接口和guard

两种格式create/verify均保留非null、安全整数、≥1、required schema检查。你的候选schema0误complete、1.5误ok已被主线避免，不得合并回退。readWorkflowEvidence默认1，create可选formatVersion显式2；更新自己的fixture明确格式，不强行改main默认。

## A2 真实旧golden与当前21族

消费main完整genuine-v1-evidence JSON及source哈希，保留真实13族旧配方；显式v2完整21族/整体digest/协议配对。缺族、任意子集、重复、mixed/future、缺空表继续拒绝，旧格式不冒充当前能力。

## A3 接实际正常业务数据

使用已验证B producer或等价明确本机fixture，经真实Application/Effects/Broker生成Work/Ticket/问题/答案/投递/dispatch/native_applied和停止barrier，不只手工写公共store行。可传显式producerPath/SHA而不修改B checkout，无真实账号。阶段1–3交早期source。

## A4 同一业务Store合成完整数据

把真实Q&A/held工作、SDK回复/候选确认、context使用与来源放入同一个项目/会话/Store，断言真实identity与行数。native权限问答的审阅数据不成为可复用授权；不以display消息代替Broker实体。

## A5 一份快照到第二根HTTP

从A4同一Store生成并验证指定格式，恢复另一root，实际readonly HTTP读原reply/candidate/source/Work/Q&A，业务变更拒绝、旧queue held、provider不重发。主线个人重绑定入口未到时，受控fixture层明确标记，不外推personal。

## A6 原source事实与崩溃

用真实source prepare/confirm/audit而非no-op revalidate committer完成此数据链，原token/actor/receipt/精确ignore及额外写回滚保持。关键进程中断复用已过设施，新场景须有实际新增风险。阶段4–6交中期组合。

## A7 个人只读绑定数据port

main发实际只读重绑定接口/消费者后实现必要A同步持久port或读索引，主线签发/确认，A不另签权限。范围、source provenance/主机/root/原principal与read-only能力明确；不得把历史settings当可执行grant。

## A8 同包数据recipe

给D/E可运行参数化producer→业务数据→快照→第二根配方，格式/version/实际source/fixture层级可核对。不要要求手写SQL、copy凭据或为验证改DB迁移，历史checksum不变。

## A9 有界成本与不确定性

只读取对应格式一次，测新增真实数据链的reader次数/bytes/上限、partial/未知状态，不跨await持SQL事务，不全库正文读取；旧规模证据可引用。

## A10 最终结果

写`packages/workflows/reports/wave19-status.json`，第三source与实际normal/readonly/personal范围映射。goal覆盖所有可独立阶段，private许可/target未到不阻数据整包，原origin分支显式owned paths。

## 独立备选队列

- main个人重绑定未到：A1–A6、A8–A9和受控第二根HTTP继续，准确标scope。
- B业务恢复未到：正常已验证Q&A可直接用，不等新reconnect port。
- 不新增迁移或权限权威只为旧probe，无真实模型/native。
