# B：从已给出的正常准备对照到恢复交付长包

原B目录/`codex/g1-runtime`及原owned paths。保留两旧report差异/untracked real-begin，读README/0051合并main。1e1f82a实际App/原Driver/子进程/A失败事实有进展；当前producer仍未准备，不能标整包完成。真实model/native0。

## B1 先修可执行producer与观测

`.mjs:29`的`as Uint8Array`使语法与--version都exit1；先用Node检查实际脚本。thread/start还需原Driver要求的cwd/approvalPolicy/sandbox/model及现代approval身份。不要只改一行后再等新排障。事实用原`store.observations.forAttempt()`/binding API读，不能查询不存在列并吞错，也无需A迁移。

## B2 直接对齐已运行对照

运行main`tools/bootstrap/diagnose-wave18-b-preparation.mjs`和其本地fixture，理解为何原接口已能prepared→begin1→Broker question1。将协议修复纳入自己owned producer并正常提交，用你提交的fixture重跑原createProductRuntime.native.profile正常链；main诊断PASS不算你的交付。原CodexProductDriver/guard不可删。阶段1–2交首个source。

## B3 正常问题、回答、停止

同一App/A Store/Runner/子writer完成一次真实question→显式answer→before-write→receiver/native状态及cancel，原身份/receipt对应。诊断目前只到问题，不准据此称answer/stop已测。无伪造prepared/persisted:true、无第二coordinator/ledger。

## B4 子writer完整资源

实际记录子PID/start/UID/argv/attempt和完整资源manifest，pre-record/未知/孤儿分别核对。只对自有spawn资源清理；ACK和字符串状态不证明quiescence。main profile normal接入无需新接口，恢复能力另给最小实际port/RFC。

## B5 业务重连port

复用现有Runner service/link、认证proof、A当前binding和原命令/会话/epoch，提供main能消费的实际reconnect adapter。before-write仍由原可信回调控制；共享wire变化交main，不建私有版本。阶段3–5交中期source和recipe。

## B6 原begin中断

预留/发送/接收/ACK/receipt有限SIGKILL，同一Runner/子writer与原command/attempt恢复。断言真实receiver和recovered exit；已接收不重发、未知不换ID补发，不能从receipt存在推断完成。

## B7 Broker回答与停止恢复

原question/answer从当前session/request/attempt重连发送，写前/写后/ACK丢失逐target保留状态；cancel及完整physical barrier同身份恢复。缺main接线只标该项NOT_REACHED，交可调用实现并继续其他窗口。

## B8 版本与恢复交付

有效current≥2/old≥1、旧合同/question/session/迟到ACK拒绝真实写；正常和中断恢复分别走到当前candidate/机器检查/人工accept。fake不声明厂商native兼容，不自动接受/合并/发布。

## B9 2/4槽位和归还

在完整真实受控产品链上先2后4槽，测unknown屏障、控制优先级、输出/backpressure与FD/子进程/queue归还。每项有deadline，禁用真实CLI/网关fallback，十二实例不动。

## B10 完整结果goal

写`tests/native-acceptance/reports/wave18-status.json`，每阶段实际source/producer/事实种类/receiver/业务行/退出码清楚。第三source交后按goal收口所有可独立阶段；不能以B1 partial或“两个fact未知”结束整包。仅显式owned paths推原分支。

## 独立备选队列

- 正常接口已经存在：先完成自己提交producer的Q/A/stop与资源，不等待main新normal接口。
- 恢复接线未到：交实际adapter/RFC，继续独立中断/栅栏/槽位；不造第二ledger。
- 旧cap4 UNKNOWN不可花，pilot不归你，禁止费用/新Driver调查或真实账号烟测。
