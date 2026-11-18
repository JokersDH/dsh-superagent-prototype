# B：同一原Runner的真实传输掉线接续

目录 `/Users/hh/Desktop/joker/superagent-agent-b`，分支 `codex/g1-runtime`。保留原dirty/历史/预算，fetch并merge origin/main；读AGENTS和共同README。当前主线source `d6244e63`，本轮输入 `928b2153`。[验收](../../reports/releases/recovery-milestone-01/admission-2026-11-18.json)。

**主动，只闭合原恢复传输。** main已完成受控coordinator worker异常退出后的同原Work问答→检查→接受；你不再重做上层Application/Broker或新增宿主。

1. 先修本次b37断言：deliver.catch吞异常、两个分支均PASS不能证明命令接收；对原receiver记录的commandId/body/attempt和实际native接收作断言。缺记录/拒绝/超时必须FAIL或NOT_TESTED。回调fixture receipt不冒原Store durability。
2. 消费原RunnerLink/serveRunner实际路径，验证旧coordinator的stdin EOF、stdout关闭/EPIPE后原Runner/endpoint能否继续被新连接接管。明确区分正常shutdown与意外掉线；若实际原路径失败，在你owned原实现修，不造第二宿主、协议或waiter/lease实现。
3. 同Runner/attempt/session不变，新连接明确CAS bind、旧lease迟到回复拒绝；原fact/payload/写前guard由同真实consumer处理。不能重begin、换commandId或缓存/迁移allow，UNKNOWN业务效果回原调和。
4. 先用无信号stream/transport故障控制，必要Node受控进程自行退出；不得调用真实模型/native/信号/危险fallback/global discovery。完整物理范围不足明确未达，禁用未准入signal工具，不先扩通用进程框架。

交可运行最小source闭包和精确consumer/原IDs/命令exit，与main/H持续复验这个结果；无剩余阻断就待命，不扩独立队列/长soak/成套新报告。B排除I通信子树；主线整链与原槽由main持有。显式owned提交推原origin分支，保留十二实例及全部state/profile/tar/ledger。原B cap4 UNKNOWN不可花，研究本阶段不推进。
