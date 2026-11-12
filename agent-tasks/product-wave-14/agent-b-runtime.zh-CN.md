# B：真实产品控制的独立Runner恢复

原目录`/Users/hh/Desktop/joker/superagent-agent-b`，分支`codex/g1-runtime`，保持原B拥有路径及两份旧report差异。读README/0041，合并最新main。aacc342正常纵向6PASS+1NT、旧5例/strict/68通过已成立，不再重复空表旧结论。真实模型/native0，旧cap4 UNKNOWN不可花。

## B1 冻结实际发送的JSON值

关闭wave14新三类：getter两次读取变化、array Symbol键丢失、Map非普通对象变空。以同一个已冻结可序列化值做校验/摘要/预留/发送；拒绝不支持的属性描述符、原型、循环及丢失语义，不能检查原对象再发另一个clone。拒绝前reserve/fakeSend均0；保留合法JSON正例。无需任何真实模型调用。

## B2 公开诊断与首个source

修Windows盘符、UNC、任意绝对路径/嵌套detail脱敏，采用结构化诊断且不泄漏账号/config路径。复跑旧5+新4、strict/exactOptional及真实main消费者类型。阶段1–2发布早期可运行源码，然后继续下面真实恢复出口，不停在helper修补。

## B3 独立存活的真实Runner传输

沿已成功的createProductRuntime/Application/Effects/AttemptRunner/Broker路径，将Runner host置于独立受控进程，复用现有认证transport/proof与A stores。协调器退出后Runner可独立观察/重连；不能让stdin EOF自然退出的fixture冒充存活恢复。测试记录实际receiver的begin/answer/stop计数、PID/start/root/attempt/session/epoch。

## B4 begin故障窗口与原身份恢复

覆盖预留/写队列/实际begin发送/接收/ACK/落盘各侧窗口，独立SIGKILL后重开实际协调器。只核对原assignment与receipt；未知发送保留unknown，不新建身份重发。recovered进程exit code、实际receiver计数和数据库变化全部进入断言，不能重开仅打印行数就PASS。

## B5 question与answer恢复后继续

问题持久前后、人工答案已记录、写到原生前后、原生ACK前后分别中断；重开后通过真实answer_question/Broker完成到当前target。拒绝旧session/attempt/epoch/重复答案，保留local_recorded/response_written/native_applied/indeterminate语义。不得把数据库计数当成原生已收到。

## B6 stop与物理资源屏障

让实际产品stop命令经过现有队列和独立Runner，覆盖ACK丢失、子进程仍活、未知后代和恢复重入。只有完整认证资源事实允许新writer；SIGTERM/退出码本身不释放屏障。精确停止本次自有资源，不能使用路径匹配/全局pkill。阶段4–6交中期可运行组合。

## B7 steer/重试与版本栅栏

在支持的现有接口内验证steer、修订、继续、retry；不支持的能力明确拒绝且发送0。旧合同/当前assignment变化、fence提升和迟到ACK不能写入当前会话；使用已持久A字段，不建第二生命周期或测试专用recover方法。

## B8 2/4槽位与资源归还

实际Work/队列/独立Runner并发2再4槽，故障任务不抢占别人的当前assignment。检查资源上限、单任务未知屏障、槽位归还、无孤儿、无第二writer。矩阵有限且每个case有新风险，不循环相同PASS凑时长。

## B9 正常交付与恢复后交付

同一真实场景分别从正常路径和中断恢复走到verification/current candidate/人工accept。产物、实际检查、原合同与resource proof一致；不改main接受规则、不自动接受。仅fixture进程的结果按范围记controlled，不声称厂商模型/native兼容。

## B10 整包与E交接

保留所有历史账本、反例及原正常纵向证据。提交`tests/native-acceptance/reports/wave14-status.json`、receiver计数/进程身份/命令与原receipt证据、可被E独立执行的有限recipe。早/中/最终source均push原origin分支。所有实际厂商model/native sends为0，不能因protocol调查、fixture命令或新日期刷新预算。

## 独立备选队列

- 输入/诊断、独立Runner接线与本地receiver计数不等任何模型预算。
- main控制入口已存在，先复用；跨包缺最小字段时给RFC，继续其他故障窗口。
- 无费用/price/recipe重复研究，无新Driver、CAC或私有ledger。
