# B：真实产品控制与协调进程恢复

原superagent-agent-b/codex/g1-runtime，B原拥有路径不变，保留两个共享报告差异。合并最新main，读README/0039。旧cap4 UNKNOWN不可花，模型/native0；只用受控协议fixture，不运行厂商模型。

## B1 先让测试真正经过产品入口

参考main tests/integration/product-execution.case.mjs、production-runtime.case.mjs和createProductRuntime。必须dispatch原create_work，走ProductExecution.effects的application.execute、execute、runtime.launch/feed和committed fact；数据库应出现对应Work/Ticket/queue/dispatch/facts。写任意command body、预先spawn writer再inspect不算begin。

## B2 早交最小纵向消费者并修正旧范围

先交一个真实产品start→question→answer或start→stop最小案例；将旧B13保留为Store/新进程/认证cancel基底，不称产品恢复。列实际调用栈/DB身份/transport计数再push首个source。若生产不能重连，准确保留unknown/unsupported，不能以空表PASS；缺main接口给具体RFC后继续独立队列。

## B3 完整JSON输入与默认公开诊断

关闭probe-wave13-runtime五例：嵌套BigInt/NaN、Symbol key丢失、版本输出与嵌套diagnostic路径。使用既有结构化JSON schema/parser核对实际冻结payload，不能reserve后才发现无法表达或值变化。公开字段白名单与private原始诊断分开，不靠pathRedacted布尔自证；真实main strict保持。

## B4 begin精确崩溃窗口

独立协调进程在原effect入队/传输前后/ACK/事实提交前后SIGKILL，全新进程读同一A SQLite恢复。原begin计数不可重复；只有receipt不能猜执行过，unknown不退款或重启。禁止测试权威表/第二数据库；用实际Runner观察证明是否收到命令。

## B5 QuestionBroker与逐target回答

实际Runner feed提问→原Broker持久问题→主应用回答→answer delivery→协议ACK。覆盖回答发送/ACK前后崩溃、旧RPC/旧session/foreign project/过期question与unknown；同时检查业务状态与transport计数，不以inspect代替answer。

## B6 停止、重连与完整资源证明

before begin、运行中、ACK后未静止、writer仍活/parent死、资源清单缺项、旧proof/新attempt/新epoch。真实认证/current binding/full manifest保持；cancel ACK或更高epoch不等于writer停止。阶段4–6交第二个生产矩阵source。

## B7 steer与epoch

经原工作补充/协议入口实现实际steer，核对收到/unknown/失效会话、跨重启旧RPC与fence。复用A既有持久绑定，不造b13_epoch权威；接口不足给准确RFC，非支持版本明确拒绝而非假成功。

## B8 2/4槽位与有限负载

固定8/16个受控任务，交错问题、输出、取消和一个协调进程故障；验证槽位、背压、输出/时间上限、其他任务不串身份，FD/子进程有界归还。每案有总deadline，只清理本次可证明自有资源。

## B9 实际main/D消费者

给main无执行器退化提供准确typed事实；诊断不能授计费或执行权。消费后续target屏障验证active/indeterminate仍阻断；B/E仅有限flat-envelope默认no-send，不研究费用/recipe、不扩Driver。

## B10 最终证据

拥有包回归、strict消费者及实际产品矩阵；维护tests/native-acceptance/reports/wave13-status.json。列每个阶段真实入口、协调/Runner PID、Work/Ticket/Assignment、epoch、命令和传输计数、source/exit；native与fixture分开。未达项NOT_TESTED，保留账本并push原分支。

## 独立备选队列

- 实际createProductRuntime的start/question/stop不等新费用协议。
- 输入/全字段脱敏、输出上限、多槽位和资源负例独立可做。
- 缺某个重连能力只阻断该成功案例，继续unknown拒绝与其他生产路径，不回退手写receipt证明执行。
