# B：从已过控制契约到真正业务attach整包

原B目录/分支和ownedpaths，保留旧diff/untracked。读README/0059合并main；类型/postproof/intent分支已独立通过，不再排前三修补。整个goal首个未到项是真业务attach，预算0。

## B1 固定已过控制面

exact A登记端点/inode/producer、main freshbeforewrite、state-aware not_seen/intent_recorded/observed/unknown及postproof契约保持，已有5/3/4测试和strict可引用。不要为了报告继续改正常producer或重做inspectcancel。
## B2 实际attach源码

在原Runner service/link生命周期实现持久business stream/session/factsink/Broker回调attach，而非新descriptor/receipt-only服务。交实际调用方法、连接断开重接和最小RFC/types，保持冻结wire/单执行生命周期；确需共享变化交main评估。
## B3 两客户端生命周期

先证明clientA断开、clientB连同一Runner/child，原业务事实能送原A sink、原问题仍有currentbeforewrite授权；不能只inspect/cancel。第一可运行checkpoint必须实际attach，不是另一个小修。
## B4 真正协调器退出

原coordinator PID退出或SIGKILL，新进程从同A登记/业务事实重连；Runner/child身份未换，原command/attempt/epoch/contract/session一致。记录明确PID和receiver/facts而非字符串状态。
## B5 原问题回答

恢复原Broker question/answer/target，写前guard重读当前主线授权，实际answer1/native_applied或indeterminate；旧批准不得转用另一native请求。
## B6 有限发送窗口

begin/answer receiver/ACK/receipt窗口各有正对照和deadline，已收到不重发、unknown不换ID补发。第二checkpoint交SIGKILL后原身份回答与窗口结果。
## B7 stop与有效epoch

原cancel/postproof/currentcompletebarrier中断重入，真实运行时current≥2/old≥1、旧contract/question/session/迟到ACK拒绝写。sent或认证inspect不是资源静止证明。
## B8 恢复交付

同一原Work/Ticket继续注册check/currentcandidate/artifact/人工accept，normal/recovered分列，不自动接受/合并或称fake厂商兼容。
## B9 2/4槽位

完整恢复链并行、unknown屏障/控制优先级/backpressure、FD/子进程/queue归还；精确probe出生清理，禁止global扫描或真实CLIfallback。
## B10 持续整包

写`tests/native-acceptance/reports/wave22-status.json`，第三source覆盖恢复交付/版本/并行。若本次仍只控制wrapper，必须准确NOT_REACHED并继续独立阶段，不能标整个goal完成；显式ownedpaths推原分支。

## 独立备选队列

main新consumer未到先交真实attachport和私有同Runner进程证据；缺接口提供实际RFC，不等新的normal入口或新预算，不造第二ledger/authority。
