# A：源快照、回复结果与历史数据长整包

原目录`/Users/hh/Desktop/joker/superagent-agent-a`，原分支`codex/g2-workspaces-verification`，只改storage/workflows。先读本轮README/0035，保留改动并合并最新main。reader/v16已集成，不重交旧修复；自动模型/native0。

## A1 实现恢复源逻辑快照并早交

消费RecoverySourceReader，在`store.workflows.recoverySource.inspect`提供有界同connection只读快照。覆盖全部必要业务、资源、队列和稳定writer身份，按结构化逻辑族排序摘要；不把文件bytes、observedAt、全局event cursor当逻辑内容。未知/缺表/未来schema/扫描上限不能返回complete空状态。

最小当前空源、非空源、变更检测及strict/build通过后push第一个可运行checkpoint，让main开始真实baseline接线。

## A2 关闭自身确认与heartbeat误失效

ignoreCommitted只能匹配真实A fact和原receipt/seq/body，并排除其确切activation row/command receipt/intent事件。前后sourceFingerprint一致，任意其他confirmation/业务/资源改变必须不同；错误或伪造ignore拒绝。只忽略固定heartbeat字段，PID/nonce/start不能丢。补真正DB reopen/并发写入前后/原事务回滚与boundaries，不写宿主机或授权逻辑。

## A3 实现上下文历史keyset读取

按AssistantContextHistory在`store.workflows.assistant.contextHistory.page`提供项目/会话/work筛选、newest-first、确认时间+messageId稳定分页。两项目/多会话/同timestamp ties/reopen、foreign cursor、空窗口与坏row都要覆盖；数据查询只读，cursor不携带权限。必要索引通过唯一append-only迁移实现，main公共HMAC不由A代写。

## A4 历史完整性、来源缺失和规模

历史读取必须继续验证row/value/digest一致，不能因坏行而静默跳过。给main绑定与bundle registry的低成本只读核对用法，正文仍按显式artifact读取；分页不要反复扫全部历史。用500/5000条、不同工作/长内容/重复时间的数据验证返回稳定、lookup有界及所用索引。

## A5 实现完成回复数据port

按AssistantReplyResults在`store.workflows.assistant.replyResults`实现forRequest/forReply/put。原requestId/requestDigest及source/project/conversation必须对应现有AssistantInferenceRecord；先有registered artifact/digest，双identity同body重放、异body冲突。principal由可信main写入，不能从模型文字推导。只增记录，不发模型、不另起发送状态机或连接。

## A6 同事务失败与完成结果重开

测试before-send记录存在但没有完成结果、结果记录先成功/回复事务后失败、重复result、两个request抢同reply、外层receipt失败、artifact登记失败、row/value篡改与真实close/reopen。结果数据可恢复不等于允许第二次推理。给main可执行consumer及准确异常类型；阶段4–6交第二个稳定源码检查点。

## A7 新表、引用和旧版本迁移

将新result/history必要字段/source snapshot涉及族纳入库存分类和snapshot family；完成结果artifact、context bundle不能遗漏。旧v15/v16升级append-only保持原消息/回执，schema marker/迁移checksum不乱写；未来schema拒绝，reader不自动修库。不要为缺B epoch API自建第二writer；收到确切RFC后在既有绑定机制内补。

## A8 实际主线组合与跨进程故障

消费main已发布context-use、target preparation，随后接新history/回复恢复/activation消费者。对真实SQLite用独立子进程SIGKILL覆盖结果登记前后、回复/receipt提交前后、source确认前后，证明重开不复制消息/工作、无假完整source。主线入口未到只标对应NOT_TESTED，继续独立队列；不以内存map称持久恢复。

## A9 备份恢复和有界性能整包

用真实非空DB+artifact快照、搬到第二临时根恢复，再验新族/摘要/引用和不继承启动权。丢表/缺bundle/改结果字节/过新schema给准确失败。记录有代表性100/1000工作、长会话、5000历史绑定的耗时/rows/bytes上限；不删除真实用户数据做清理性能测试。

## A10 完整交接与准入材料

运行storage/workflows full typecheck/build/test与main真实消费者，维护`packages/workflows/reports/wave11-status.json`。交migration/schema、三个port、exact source/base、命令/exit、backup族、故障窗口、覆盖上限和下一消费者步骤。只push原分支；九组用户服务、ledger、旧迁移体与证据保留。

## 独立备选队列

- source逻辑族、精确自身排除、完整性及bounded摘要fixtures；不等main HTTP。
- history索引、稳定游标、坏行/多项目与真实5000行测试；不等UI。
- reply result双键、artifact引用、父事务回滚、重开与备份；不等真实模型。
- old-schema兼容、SQL查询计划、非空快照与独立进程故障；不等D整包。
