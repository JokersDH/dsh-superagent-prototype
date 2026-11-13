# B：真实产品到独立Runner的连续开发包

继续`/Users/hh/Desktop/joker/superagent-agent-b`和`codex/g1-runtime`，只改原B拥有路径；保留两份报告diff、全部ledger。读README/0047并同步最新main。已验c7f7e77的fixture修复成立；新提交以本轮报告准确SHA为准。正常B13的真实链保留，B14认证重连不等于业务恢复。真实模型/native0，UNKNOWN旧额度不可用。

## B1 第一个checkpoint必须触达真实receiver

先把已通过B13的create_work/Application/Effects/Broker接到现有RunnerLink/runner-service-entry与B-owned fake app-server。必须有实际begin≥1和真实question，原Work/Ticket/effect/fact/dispatch/binding表非空且关联一致。不得新增第三套receipt-only coordinator，也不得从写receipt推导已发送。先交这条可运行纵向，别先扩大故障矩阵。

## B2 现有Runner的持久业务port

在原Runner/transport实现可供main消费的最小重连接线，优先复用现有类型和认证proof。若现有wire确需变化，先向main交具体RFC、实现、consumer编译和负例，不自行改共享contract或弱化before-write守卫。port必须调用真实现有Runner，不是描述符或内存字符串writer。阶段1–2交早期源码、启动recipe和准确未到项。

## B3 实际writer与完整资源集

fake app-server受实际Runner host控制并启动可观察的受控writer/必要子进程；记录birth PID/start/UID/attempt/资源身份。runner/control服务存活与writer存活分别观测，缺失/孤儿/部分未知不折成空集合。认证inspect只证明当前连接，不授权业务或自动quiescent。

## B4 真实begin故障恢复

在预留、实际发送、receiver接收、ACK、持久回执窗口注入有限SIGKILL。新协调器用同一SQLite/同一Runner及原command/attempt连接，断言receiver次数、recovered exit和真实业务表。已接收不可重发，未能判断保持unknown，不创建替代identity补发。

## B5 Broker回答恢复

通过原Broker记录真实question和显式answer。覆盖记录前后、before-write、写后ACK丢失和重开；恢复发送必须绑定当前session/request/attempt/epoch及原命令。assert实际answer receiver计数与逐target状态，不能只记录delivered。main接线未到时交可调用port及缺失回调，并继续其他独立阶段。

## B6 stop与物理屏障

真实cancel送达并停止受控writer；ACK前后、部分子资源unknown、服务活而writer退出或反之分别核对。完整资源身份、receiver计数、原回执和physical barrier同时断言。结束字符串或native ACK不能解锁新writer。阶段3–6交中期可运行恢复组合给main/E。

## B7 有效的旧epoch与版本栅栏

将当前epoch推进到至少2，旧epoch至少1且载荷通过schema；同条件current正对照必须成功，旧值在实际授权边界拒绝且写0。旧合同/question/session/迟到ACK同理。epoch0只是非法输入测试，不能当有效stale证明；不把证据不足说成生产绕过。

## B8 恢复后走完交付

至少一条真实受控中断恢复走到当前candidate、注册机器检查及人工accept，保持原Work/Ticket/assignment和artifact身份。normal与recovered分别记录，不以正常6PASS为恢复补证。fake协议不升级为厂商原生兼容；不自动接受、推送或合并。

## B9 2/4槽位与资源归还

在上述真实链上先2后4槽，验证单任务unknown屏障、控制优先级、bounded输出/背压和FD/子进程/queue归还。每例有限deadline与精确资源清理；取消其他任务不能破坏当前任一已准入writer。用户十二实例绝不触碰。

## B10 完整状态与交付

必须写`tests/native-acceptance/reports/wave16-status.json`，逐阶段列真实入口、receiver计数、实际业务行、物理资源、退出码和未到项。交第三个checkpoint，原分支push显式owned paths。不得只修fixture epoch就将十阶段包结束；外部main依赖只阻对应阶段。

## 独立备选队列

- main可信重连未到：交实际Runner port/RFC、先做真实normal begin/question、物理资源、有效epoch、stop和有限槽位。
- 原生模型不允许：只用本机受控fake app-server，不能调用真实CLI/SDK账户做烟测。
- 无第二ledger/lifecycle/receipt-only世界，不再价格/recipe调查，不为一个旧probe新增空方法。
