# B：正常控制已过后的持久业务恢复整包

原B目录/分支及owned paths，保留两report差异/untracked real-begin。读README/0053合并main。ad222c1自提交producer正常prepared/begin/Q&A/native_applied与受控physical stop已独立通过，不再重做producer或称main缺normal接口。真实model/native0。

## B1 修正正常断言边界

answer必须等原Broker逐target native_applied，不只等pre-admission frame或response_written；sameAttempt必须进入通过条件。stop走认证recovery cancel→stopPhysical，查binding/完整资源/实际PID/barrier proof，不能要求唯一业务cancel/turninterrupt帧。让原测试准确记录已过normal控制。

## B2 稳定正常fixture供A/C/E

交可参数化且已提交的本地producer/数据recipe，真实App/AStore/Broker/子writer、答案应用/停止身份齐全；测试代码/producer SHA单列，无真实CLI fallback。默认normal用法已存在，第一checkpoint不再等待main新normal API。

## B3 可运行业务reconnect port

在原Runner service/link/认证proof、A持久binding/原命令上交实际adapter/RFC，重连同一进程和子writer，before-write原callback必须保留。需要共享接口交main，不自造wire/ledger/coordinator；源码checkpoint要真能连而不是描述符。阶段1–3交早期source。

## B4 物理资源与服务存活

独立记录Runner、native child及必要后代的PID/start/UID/argv/root/operation/attempt，完整manifest与当前proof一致；协调器死/Runner活、writer退出/服务活、部分unknown分开，不由旧ended字符串推出安全。

## B5 原begin发送窗口

预留/发送/receiver/ACK/receipt有限中断，用原command/attempt重连并核对实际次数/recovered exit；已接收不重发、unknown不换ID补发。不能只重放receipt或读表就记恢复完成。

## B6 Broker回答恢复

真实问题/答案在记录、before-write、写后ACK丢失等窗口重开，原session/request/attempt/epoch当前授权才发送；逐target状态与native_applied真实观测。main消费者未到交可调用port，继续独立窗口。阶段4–6交中期source。

## B7 停止恢复与有效旧epoch

真实stop/物理屏障按原identity恢复，ACK不替代quiescence；current≥2/old≥1且schema有效、同条件current正对照成功。旧合同/question/session及迟到ACK不能写当前目标。

## B8 恢复交付

同一Work/Ticket恢复后继续到实际注册检查、当前candidate/artifact、人工accept，normal/recovered分别记。无自动接受/合并/推送，fake不称厂商native兼容。

## B9 2/4槽位与资源归还

完整受控产品链先2后4，unknown屏障、优先级/backpressure及FD/子进程/queue回基线。有限deadline、准确probe-owned清理，不碰十二用户实例。

## B10 持续完成整包

写`tests/native-acceptance/reports/wave19-status.json`，第三source及真实port/receiver/状态/退出码。正常assertion修复后继续goal，不再以B1/B2完成整个recovery包；显式owned paths推原分支。

## 独立备选队列

- main恢复消费者未到：交真实port/RFC，继续原Runner/资源/栅栏/中断与normal完整数据。
- native预算0：继续本机producer，旧UNKNOWN额度不可花，不价格/新Driver研究。
- 不为解释错测试弱化现有preparation/before-write守卫。
