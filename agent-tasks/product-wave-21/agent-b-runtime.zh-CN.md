# B：完整proof与同Runner业务attach完整包

原B目录/分支及ownedpaths，保留两report差异/untracked。读README/0057合并main；旧三边界3/3真关闭，normal10/10保留，不重做producer。goal必须覆盖业务attach后续结果。

## B1 真实module strict

resolveEndpoint返回socketIdentity?仍与required RunnerEndpoint冲突；用完整注册descriptor建模，直接编译实际module和consumer，不用root排除路径的编译替代。
## B2 返回实际cancel proof

当前outcome.proof为发送前serving/open/active且丢掉cancel响应，必须保留真实已认证postproof并准确命名/测试。freshproof仍须原main当前binding/完整资源屏障核对，不把sent:true当quiescence。
## B3 intent/result语义

真实A原intent可以先存在而未送达；不得raw commands.has就拒原命令。区分original pending/observed/result/unknown，稳定ID重入不换身份补发。第一里程碑以严格port+登记/guard/proof测试闭合。
## B4 实际业务attach实现

当前wrapper只有inspect/cancel，交真实原Runner businessstream/session/factsink/Broker-beforewrite attach和最小RFC/types。保持主线currentprincipal/contract/assignment/session/epoch，不能新建receipt-only世界或另一个lifecycle。
## B5 真正新协调器

让原协调器退出或受控SIGKILL后，新进程使用同AStore登记连接同一Runner/子writer，恢复原事实sink和原command；记录双协调器PID、Runner/child未换、事实/receiver身份一致。
## B6 begin/answer窗口

预留/receiver/ACK/receipt的有限窗口，用原ID保留unknown与已接收不重发，回答逐target以native_applied/indeterminate真实记录。第二里程碑交可调用恢复组合，不用inspect/cancel代称resume。
## B7 stop/版本栅栏

原cancel+postproof/currentbarrier中断重入，current≥2/old≥1真实运行时拒绝，旧contract/question/session/迟到ACK写0，完整资源含未知后代不能折空。
## B8 恢复交付

原Work/Ticket继续注册check/currentcandidate/artifact/人工accept，normal/recovered分别测，不自动接受/合并；fake不称厂商兼容。
## B9 并行归还

完整恢复链2/4槽、控制优先级/backpressure、FD/子进程/queue回基线，有限deadline/精确probe-born清理，无global扫描或真实CLIfallback。
## B10 持续整包

写`tests/native-acceptance/reports/wave21-status.json`，三checkpoint交后继续。只修B1–B3不算完整goal完成，B4–B9未到逐项明示并执行独立队列，不以更多status替源码。

## 独立备选队列

main恢复consumer未到先交真实attachport和私有进程证据；旧API物理控制可继续用；budget0/UNKNOWN不可花，12服务/账本/旧文件不动。
