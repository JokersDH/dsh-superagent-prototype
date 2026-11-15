# B：唯一 Channel、原业务恢复与完整交付

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、原分支 `codex/g1-runtime`，保留所有改动后同步最新 `origin/main`，固定实际 source。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0071](../../docs/rfcs/WP-16/0071-wave-28-architecture-inputs.md)、[0072](../../docs/rfcs/WP-16/0072-wave-28-integrated-delivery-packages.md) 和[固定验收](../../reports/releases/wave28-admission/runtime-channel.json)。
B 保留原 execution/catalog/policy-preparation/driver/testing/Runner/native-acceptance 路径，但明确排除 I 的 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`。
B 唯一修改 runner-service/RunnerLinkClient、HTTP auth/dispatch/begin/prepared/physical lifecycle；I 唯一实现 channel，H 在独立测试树消费，不另造 coordinator/ledger/gate。
固定输入 `cb4e97504157e500799284bfd63d51768740c9fc`：原三 maps 确已删除、161条完整回放/五块135540字节摘要通过，不能再派“旧maps仍存在/五块坏了”。
当前 active business-channel 与 I 同职责重复；2KB页实际返64753字节、旧poll抢回lease、foreign expected source未拒均已复现，unsafe SIGKILL工具未执行。
同 checkout 原产品测试已通过 currentCandidate→registered verification→明确接受→delivered；没有 candidates 专表不是阻断，不新增 A 迁移或第二 ledger。
正常节奏，无当日 deadline/删门槛；whole goal 无 token 预算，24阶段在4/8/12/16/20/24发布六个完整 runnable source 后继续整包。

## B1 保留真实回放并兑现 effective budget

在 actual serveRunner/FileCriticalJournal 修正整个 encoded page 对 effective requested budget 的约束，不只对全局64KB裁剪。
同一数据链同时包含160小记录、inline/descriptor、原seq、135540字节五块和digest；复制正常pager的fixture不再代替实际源。
独立验证2048/16384页上限、空/末页、非法cursor/预算与大记录引用；记录实际返回bytes、next和done，保持完整进展。
验收：原回放/五块正对照保留，小页真正有界，无丢失/重编号/重复effect；提交最小源后继续B2–B4。

## B2 选择 I 的唯一具体实现

同步 I 自有 CoordinatorChannelModule 和必要 transport adapter；B 不再实现第二套 waiter/lease/timer/回调规则。
明确退役 business-channel/business-dispatch 中重复通信职责和测试替身的迁移清单，I吸收实际B需要的callback行为；真正的业务命令admission/幂等/dispatch仍由B统一保留，不因文件名删除业务守卫。
保留三maps已删的事实，但不能把换了文件名当唯一实现已完成；I旧报告maps数量仅描述其旧基线。
验收：真实B import指向选定I源，共享小interface/localv1schema不分叉，direct strict/exactOptional有实际consumer。

## B3 显式认证 CAS 与 read-only poll

绑定使用原注册full producer/source/attempt、connection与expectedGeneration，返回原lease；poll/next只能消费该lease，不隐式takeover。
旧A在B接管后poll/reply/close都不能抢回、回应或损害B；foreign expected source在任何绑定变化/回调暴露前拒绝。
HTTP/stdio adapter把回复交原连接产生的lease.receive，禁止转给全局current lease；credential存在不替代预期身份/当前授权。
验收：A1→B2完整positive、旧A.poll被拒、foreignpoll不变generation、错误CAS与晚reply均有限且副作用计数不增。

## B4 第一结果：预算与唯一实际通道

把B1–B3接入真实Runner，三callback由I唯一pending owner管理，B旧平行实现/重复fallback管道实际退役，不长期双轨。
保留原begin-once/prepared/launch/receiver与完整资源规则，actual native fresh admission仍委派main/Broker，不由HTTP lease授予。
第一完整结果包含真实page连续性、actualI adapter、认证CAS/read-only poll、旧late拒绝与源码删除，非又一个helper判断。
发布B4 runnable source/consumer和准确未达范围给main/I/H，继续B5–B8；不把module通过称业务恢复已完成。

## B5 先使 live 工具具备安全出生证明

替换 bespoke PID-only SIGKILL/finally kill：独立记录本probe PID/start/UID/fullargv/root/config/operation并在每次signal前fresh重核。
先纯控制覆盖own完整positive、foreign/sibling/recycled/pre-record/mixedunknown和TERM→KILL变化，unknown保留material不删根。
未通过不得再跑现有unsafe b27-chain/sigkill；不因child由自己spawn就省略实际身份/退出确认，不global scan/pkill。
验收：错误资源零signal，own终止与拒绝/未知可追溯；工具source发布后才进入后续真实进程矩阵。

## B6 三实际 callback 接原权威

recordFact回原A ingress/durable receipt，payload回原immutable Store，native intent逐次调用main/Broker当前原target/version guard。
I fresh local correlation不改变原business command.id，B responder回原frame.id，不能把旧allowed缓存或回复给下一意图。
fact重发只为原ID等ACK，payload可同ref重读；unknown native结果回原command reconciliation，不能重发业务命令消除未知。
验收：实际三回调正反链、原ref/receipt/fulltuple和guard计数闭合，无合成persistedtrue或伪payload替代真实A。

## B7 同 Runner/child 两客户端

私有正常product Driver/协议fake产生原begin/question，A真断开、B接同Runner/child和原A Store，保持原session/request/contract/epoch。
连接替换时旧native pending indeterminate，旧lease不能操作新pending；只有原未决意图经fresh guard重新核对，不迁移批准。
记录两个client生命周期、进程完整出生身份、原question/answer/ref/fact与实际接收结果，不靠两个独立demo拼交接。
验收：已通过安全工具约束下的actual双client三callback和late negatives，normal/controlled/vendor分层，0真实native。

## B8 第二结果：同链真实交接

B5–B7组成同一Runner/child、原A/Broker、原问题和完整守卫的交接，不能以I module double或JSON注册实验替代。
证明原fact/payload数据连续和实际fresh write结果，错误/断连/未知保持原状态，channel close不等物理quiescence。
第二完整结果包括安全工具、唯一实现、三callback、双client和准确身份/资源证据，H可独立复现同一port。
发布B8 source后继续B9–B12，不因新channel可poll就宣告跨协调器恢复完成。

## B9 从原 A 恢复新协调器

新coordinator使用原A登记/current binding/commands/dispatch/observations/question/answer/payload，不仅读取手写registration.json。
main保留应用授权/真实ProductExecution组合，B交可调用attached RunningAttempt/consumer接口，不复制第三coordinator/ledger。
原host/profile/policy/fullproducer/完整resources和当前contract/epoch均重核，readiness/source receipt/目录材料不是新执行许可。
验收：真正新Node进程读原A、重连原endpoint，同Runner/child保持；缺输入给最小原ID复现，不新SQL或探针空方法。

## B10 有界原身份 SIGKILL

安全工具通过后在同一原业务链注入coordinator退出/SIGKILL，独立确认旧PID退出，Runner/child存活与身份不变。
每signal fresh完整核验；unknown/出生窗口/观察失败保留根和证据，不执行finally盲杀或为了清理删活跃state。
继任进程接原A和原lease事实，不能用Date.now假receipt、requestId假payload或重新创建问题伪造成功。
验收：有正常positive/有限deadline/原IDs/前后资源，actual原数据重连而非只证明两个OS PID能读同一文件。

## B11 原问题回答与有限 ACK

恢复原Broker question/version/target/native request/answer/command.id，fresh guard在实际native-write意图时运行，允许达native_applied否则unknown。
begin/answer覆盖写前、receiver后ACK前、ACK后receipt前、receipt持久后等有限窗，以真实A/receiver判断not_seen/intent/observed/result。
已收/完成不重发，unknown不换command/attempt/session/request补发，不以任意fact_receipts总数增量代替原answer的确定结果。
验收：原ID正常/拒绝/未知、late ACK、重放/冲突和实际effect计数闭合，数据重读不升级成业务自动重试。

## B12 第三结果：同 A 原链崩溃恢复

B9–B11在同一原Work/question/attempt链完成退出、新进程、原回答/receipt/native_applied或准确unknown，而非拼normal和transport两lane。
main/I/H source、原IDs、实际方法/guard/receiver、有限窗口和最终资源清楚；厂商/native/installed/value分别未测。
第三结果必须消费既有A/Broker，不得新增专用coordinator或新grant；main消费者未到只标该步骤未达并继续独立项。
发布B12 runnable source和实际复现后继续B13–B16，把恢复后的工作推进到原验证与交付。

## B13 复用既有候选路径

使用ProductCompletion.current/verify/accept、execution.completionCandidate→application.verify和core generation，候选不存专用candidates表。
参考同checkout tests/integration/product-execution.case.mjs首测试，它已实际证明原问题→检查→currentCandidate→accept→delivered/reopen。
读取WorkView.actions.currentCandidate/currentVerificationId，使用完整CandidateRef；不能构造candidateId/workId私有shape或要求A新迁移。
验收：删除candidateProducerAbsent的错误阻断说明，B合法Driver/artifact consumer沿原public接口产候选，不直接改数据库状态。

## B14 恢复产物与注册检查

在原恢复Work/Assignment上实际产物，复用artifact manifest/原事实输入和已注册check/Workspace冻结，不能借另一正常lane的artifact。
沿原fixture-driver/execution/core completion语义和quiescent barrier进入verify，不发明候选writer、评分gate或newledger。
机器失败保留原证据，修复后产生新当前candidate；wrongsubject/environment/checkpolicy在原gate拒绝。
验收：同一恢复链产生可审阅artifact/currentCandidate和真实verification，原资源未静止不能通过检查。

## B15 明确接受与合法旧版本

用真实应用命令accept_candidate接受完整当前CandidateRef，核对acceptance/verification/artifact与原Work，不直接写accepted字段。
真实current epoch至少2、old至少1，覆盖旧contract/question/target/session/迟到ACK；current1对future2只算错epoch非旧epoch证明。
重放原receipt不重复答案/接受/ReviewTiming，channel generation不代替业务epoch/授权，UI活动只是partial observation。
验收：当前一次明确接受、旧候选/版本拒绝和回执幂等来自同链，受控actor不冒充真实用户生产接受。

## B16 第四结果：恢复后的原交付

B13–B15闭合恢复→artifact→注册check→currentcandidate→manualaccept→delivered，保留原question/answer/fact/profile/contract关联。
原normal path成功只作为positive，不贴为recovered；缺步骤准确未达，不再以不存在candidate表或错误SELECT推脱接口。
第四结果交actual source/consumer/原IDs/行为与正负证据，不新A migration、coordinator、ledger或acceptance authority。
发布B16 source后继续B17–B20，slot释放和完整资源仍须单独完成。

## B17 原 scheduler 的 2/4 槽

通过原application/execution/scheduler先2再4槽，五个Work被记录不等第五attempt已占槽，以实际attempt/queue/Later和资源观察证明cap。
混合normal/待答/交接/SIGKILL/unknown/stop/delivered，每槽credential/generation/cursor/payload/receipt不串用。
正向允许、第五等待/拒绝、wrongsubject和unknown隔离均有有限观察，不因固定400ms暂时只见4条就宣称长期cap。
验收：真实2/4并发与原背压、控制优先级、准确Work/Ticket/Assignment/attempt关联，不新调度生命周期。

## B18 正确观察 slot release

inspect返回WorkView，ID在view.work.id；修复b27-slots用view.id找不到就声称projection消失的harness错误。
复用原bindings/observations/runtime.exited/complete resource barrier核对释放，Work phase字符串不是所有writer静止或slot归还的充分证据。
停止/接受后原slot资源可归还、第五合法queued work能继续；未知writer不释放，不清marker/queue或空资源集合消除阻断。
验收：release前后原IDs/资源/新attempt推进明确，缺数据准确unknown，正常/交接/恢复各自scope不混。

## B19 控制重入与完整资源

cancel/stop沿actualpostproof/current completebarrier，覆盖停止途中协调器再次退出、仍活child、partial/mixedunknown与late replies。
记录FD/connection/waiter/queue/journal/process开始峰值结束，每signal fresh全identity，本次own才操作，旧/unknown根不删。
sent/inspect/PID消失不等所有writer静止；保持per-slot和aggregate资源集，不让另一slot的proof代替本slot。
验收：normal/recovered2/4控制和资源最终结论准确，可停止的确归还、不可证明的保留屏障与material。

## B20 第五结果：并发与资源闭合

B17–B19组成实际多槽恢复/交付/停止/归还，不只统计attempt/问题各自distinct或单attempt的quiescence。
由H消费同一selected I+B源码提供独立合法输入/receiver观察，B修自己的实现，不改H/E断言或造第二gate。
第五结果包含slot cap/release、身份/数据隔离、控制重入与完整资源，有限序列不称48h soak或厂商兼容。
发布B20 checkpoint后继续B21–B24，消费者/故障/文档与正式scope完成才结束整包。

## B21 真实实现故障与容量

在actual I+B adapter上测timeout/bytes/pending/backpressure/close/late/nativeindeterminate，不能用未被service消费的dispatchhelper证明activechannel受限。
对torn/corrupt journal、descriptor/chunks/ref/digest、ACKloss和连接替换保留独立合法positive，原unknown事实不回填/重置。
测试副作用/接收端/guard和剩余timer/资源，不为probe加空method或长期双实现；只重跑本次风险相关必要suite。
验收：整个module/consumer在声明bounds内，失败有界且无假许可、假回执或不明writer释放。

## B22 main/I/H 消费兼容

actualmodule和main/I/H consumer direct strict/exactOptional通过，原localv1shape/frozenwire不变；旧frame必须交旧connectionlease，不转发current。
I保module及自有adapter逻辑，B保auth/dispatch/begin/prepared/lifecycle/RunnerLinkClient responder，H只独立consumer，不抢源码。
source/factory/fixture/ordinary/recovered/vendor/installed/requiredverdict分层，已过范围保留，不重派已关maps/五块修复。
验收：同一唯一implementation跨consumer可复现六结果相应链，源码与测试引用真实，无隐藏私有authority。

## B23 操作与准确文档

更新RFC/工具说明：真实B/I结构、原A/Broker恢复、unknown/no-resend、候选接口、WorkView和slot观测、每signal身份要求。
移除“无candidates表结构不可达”、旧map数量、只要feed就保全部规则、合成receipt等于durableingress等超范围结论。
给独立开发者可运行正常/故障命令和exactsource/原IDs；不教删DB/ledger/marker/旧queue或借credential来通过。
验收：按文档可复现受控链与准确未达，runtimebytes变化后由D/E重新同artifact验，docs-only不强制refreeze。

## B24 第六结果与最终交接

写 `tests/native-acceptance/reports/wave28-status.json`，列24阶段/六结果、B/I/main/A/H源、原IDs、命令exit/实际值/限制/未达，source交后继续wholegoal。
显式ownedpaths推origin原分支，不upstream/reset；两个旧reportdiff/b16/untracked、所有state/data/profile/tar/ledger/dirty和12旧服务保持。
真实vendor/model/native0，Bcap4UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot BLOCKED，无reset/topup/refund/补样。
第六结果含完整故障/兼容/操作文档和实际可用scope；不新Driver/CAC/桌面/autoaccept/动态DAG/第二生命周期，正常节奏不压缩门槛。

## 独立备选队列

I修复未到先完成actualpagebudget/安全工具/正确candidate-slot消费者/RFC，source到后马上真实接入，不永久维护B平行channel。
main消费者未到给原A/guard的最小实际port和复现，继续自有fault/resource/docs；H输入未到不成为B不交lifecycle的借口。
unsafe信号工具未关只做纯/进程内控制，不运行现有SIGKILL/长soak；unknown根和证据保留，不signal旧或无法证明资源。
普通App/insights/recipes/install与B/private/target/研究独立，configuration/readiness/目录材料无执行或native授权。
