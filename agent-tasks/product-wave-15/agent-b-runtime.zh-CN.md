# B：真实产品到独立Runner的控制恢复

继续原B目录/分支及拥有路径，保留两份report差异。读README/0043并合并最新main。旧9例/helper68/B13真实正常纵向已承认；B14不是业务恢复。模型/native0，cap4 UNKNOWN不可用。

## B1 恢复证据先回到真实纵向

复用B13已成功的Application/create_work/Effects/Runner/Broker/answer/accept，禁止另建receipt-only coordinator。首个目标是让实际receiver begin≥1、真实question/answer与原Work/队列/dispatch/fact一致；不能先扩大“独立服务”矩阵。

## B2 修epoch与结构化故障观测

epoch取A当前持久binding，当前命令必须接受、真正旧epoch必须拒绝；禁止producer1/fixture5却称stale1。每阶段结构化记录request/ACK/error/exit/crash，不只读stdout最后一行。阶段1–2发布可运行真实调用checkpoint，不能把写receipt当发送。

## B3 复用现有独立Runner路径

优先使用main现有NativeProductAttempt/RunnerLink/runner-service-entry及B-owned fake app-server，真实独立Runner host与实际受控子writer，厂商模型0。没有真实birth/资源枚举的`writer-${pid}`不能作为物理证据。B不并发改main产品类；确需新business reconnect port先交最小RFC和实际适配实现，main负责可信产品接线。

## B4 actual begin崩溃窗口

从原Work/effect/assignment驱动begin，覆盖预留、发送、receiver接收、ACK和receipt窗口。新协调器连接同一实际Runner，检查原command/attempt和真实receiver次数；已接收不重发、未知保留unknown，recovered exit必须断言。

## B5 Broker恢复回答

真实question保存、人工answer记录、写前/写后/ACK后中断，重开经原Broker把答案送到当前session/request/attempt/epoch。不得只写delivered receipt。逐目标保留local_recorded/response_written/native_applied/indeterminate与拒绝原因。

## B6 stop及完整资源事实

实际stop命令送到真实子writer，停止前/后/ACK丢失/部分资源未知用同一原身份恢复。receiver cancel计数、子PID/start/资源manifest与原receipt共同断言；未知不新开writer。阶段4–6交中期source与main/E准确consumer recipe。

## B7 版本和原生会话栅栏

旧合同/旧question/旧epoch/迟到ACK不能写当前会话。支持的steer/continue/retry走既有接口，不支持的明确发送0。新重连能力须保留现有before-write授权与完整资源证明，认证inspect本身不授权业务feed。

## B8 恢复后实际交付

正常和中断恢复分别走到当前候选、实际检查与人工accept，artifact/合同/资源身份一致。无结果未知不换identity补发，无自动接受；局部fixture协议结果不扩大为厂商native兼容。

## B9 2/4槽位与归还

在真实Work/Effects/独立Runner上验证2再4槽、单任务unknown屏障、输出上限/背压和FD/子进程/queue归还。每例有独立风险和有限时间，自有资源精确清理，用户十一实例不动。

## B10 最终真实控制出口

维护`tests/native-acceptance/reports/wave15-status.json`，列实际App入口、receiver计数、物理资源、recovered exit和所有未到项。检查点后连续推进，不以B13正常结果给B15恢复补证。无第二ledger/测试权威表、无新Driver/费用研究；只push原分支。

## 独立备选队列

- 先让现有实际out-of-process路径工作，不等厂商模型预算。
- 缺main可信重连接线时交可运行port/RFC，继续正常真实Runner、计数、资源和其他窗口。
- 不再扩展receipt-only或字符串writer演示，不重置历史预算。
