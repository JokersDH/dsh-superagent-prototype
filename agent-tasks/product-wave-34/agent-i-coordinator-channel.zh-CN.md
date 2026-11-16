# I：唯一通信、原命令兼容与原运行交接的两个工程包

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-i`、`codex/g5-coordinator-channel`。
保留历史/dirty/state/ledger，fetch 合并最新origin/main，固定实际source。
读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读[0086](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)、[0087](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)、[0088](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。
主线可消费源码为 `23d5a98e6e75a3b0fb08168431260a9935cf5674`；原class11项与既有4项通过，未执行launch/恢复。

依据[独立验收](../../reports/releases/wave34-admission/runtime-channel.json)，建立/继续一个 whole goal，两个连续工程包各三完整成果。
六成果不是微修编号；不设时长、同日或token承诺。source早发后继续第二包/独立队列，不等逐项派工。

## 当前实现与归属

- I只拥有 attach-channel src/test、runtime-channel docs/reports；B管service/transport/RunnerLink/physical lifecycle。
- main管原应用/QuestionBroker/current/command authority与共享契约/root/config/lock/HTTP/App/transport。
- main已提供原NativeProductAttempt同class readPayload/beforeNativeWrite/recordFact及optional attachCallbacks。
- stdio与attach共用原方法，原voidguard wrapper在await成功后显式true；不再缺少原方法的接线来源。
- 原mainterminal、reference/body、numericPID/copyhandle/Hcommand已闭，不重复派修复。
- 最新B rawcancel foreignsource写后拒、spawn prototype brand并非provenance未闭；I不能用modulePASS授准入。
- I147tests/strict和新真实caller消费者有用，但seeded/equivalentguard不代表原Application/Broker恢复。
- 不新server/ledger/另一pendingqueue/stateowner/policygate/coordinator/调度器/执行生命周期。
- 不改B/main源或E required；接口不足给RFC与可编译consumer，不复制owner实现。

## 工程包一：实际原回调与命令边界完整采用

### I1 唯一 channel 的实际三回调原方法采用

完整成果：原产品消费者通过同一通信实现调用main的原fact/payload/native方法，内容与来源无损。

- 固定main/B/I runtime与consumer blobs，必要闭包、实际import、materialized字节前后核对。
- callbacks来自原 RunningAttempt.attachCallbacks，不另写等价授权/receipt reader去充原authority。
- fact原ID/producer/attempt/contract/原Store UoW receipt连续，不造seq或另一receipt台账。
- payload-read只用原reference，value是原JSON body；与journal descriptor/chunk协议分清。
- native保原business command.id与fresh frame nonce，旧allowed不能批准新intent。
- 显式记录原方法实际调用与原receiver/Store结果；seeded component结果保留其准确范围。
- typed compatibility消费main实际ports/Badapter，strict/exactOptional保持，不以any掩盖差异。
- 缺 callback/foreign source/错误ID、body、receipt、payload/旧lease独立拒绝，0错settle/写。
- 只有一套pending/timer/correlation/queue，不能给不同caller再加一层状态实现。

optional callbacks保持Node内部，不进HTTP DTO/日志/持久JSON，也不将函数指针当跨进程恢复数据。
采用新类型不要求无关DriverKit研究exports或第二channel实现，完整必要闭包按实际import核对。

交付：可运行actual consumer、必要正负、exact source与同run原ID/receipt/guard计数。
source早交让B/main/H使用，不能只交manifest或模块测试数后结束成果一。
实际Application/QuestionBroker未接时精确未达，不把数据port形状叫完整业务接线。

### I2 原 fresh guard 的 void/throw/晚调用语义

完整成果：每个实际native intent都经过原当前性和一次性写前检查，异常、晚调用不能变允许。

- main原beforeNativeWrite返回void，wrapper必须await成功后显式allowed:true；不能把任意void callback当成功。
- 缺guard、deny、throw、current改变、原commanddigest不匹配、liveanswer已消费都拒绝。
- 正常stdio和attached使用同一map/原方法，不复制允许缓存或推断上次allowed仍有效。
- 延迟guard返回、接管中旧回调、重复intent与同business command新nonce都保留各自相关性。
- 错target/version/session/body、旧合同/epoch必须由原authority拒绝；I只传递请求和typed结果。
- timeout/closed/stale/deny/indeterminate保留差异，通信错误不等于未写或safe-to-retry。
- 保持原错误shape/API兼容，不为好看改code让main现有消费者语义变化。
- 源路径/错误堆栈不进用户诊断，必要reason有界脱敏但不吞原拒绝事实。

分别覆盖原voidguard成功经mainwrapper变true与未包装callback返回void须拒绝，不能混淆两个层次。
原live admission抛错/已消费或current变化时，晚回调不得因为早先查询成功而继续批准。

交付：真实原方法消费者与controlled正反、late/throw/void对照，scope明确不是vendor/native收益实验。
module guard helper结果与原class/真实Store结果分列，不宣传未跑的原问题端到端恢复。
完成guard交接后继续I3原命令transport兼容，不另建policyowner。

### I3 既有 RPC 与原 command authority 的兼容交接

完整成果：B/main能沿原命令账本和当前守卫调用原transport，陈旧或外来控制在效果前受限。

- callback lease generation与business fence不是同一authority；旧callback lease不能被当当前命令许可。
- 为原 `index→allowAnswer(beforeWrite)→send→runtime.feed` 提供typed transport数据，不绕原Store/current。
- 原RunnerCommand identity/body/id保持；合法stale epoch≥1对current≥2、foreignsource/contract/终端有独立negative。
- B rawcancel先写后拒已发现，不用callback绑定成功/凭据存在代替操作前身份与原物理cancel边界。
- 合法cancel仍依原quiesce/registration/full-resourcebarrier，I不把receipt/sent当物理停止或slotrelease。
- 若需additive Node-local路线，与B给main最小RFC，复用既有RPC/command，不改frozenwire或加grant。
- 原ACK/intent/result/unknown状态不被typedwrapper统一成可重试false，不创建新commandid或ledger。
- 不自己实现feed/cancel authority；遇缺口交actual consumer和精确方法要求。

原协议能够传输command不表示调用方有权发送，operation前与receiver前的身份/当前性检查须分别定位。
正常重复receipt和新副作用分开，写后才发现peer不匹配不能称零效果拒绝。

交付：原端口typed兼容、actual服务receiver对照与错误诊断；哪些是rawtransport、哪些经过原authority标清。
第一工程包source发出后继续第二包，不等待native模型或安装包壳才能完成通信工程。

## 工程包二：继任、容量与原运行物理交接

### I4 临时 detach 与 terminal 的完整实际继任

完整成果：同一原运行合法换连接而不丢数据/迁移批准，明确终端不能复活。

- temporary detach保fact/payload原ID/ref与剩余deadline，nativepending变indeterminate而非未发送。
- main terminal fix已闭：finish关闭所有lease/pending，late receipt/payload/writeadmission和新rebind均拒绝。
- 回归原修复，不另造终态owner；必须用带合法id的协议帧，协议拒绝不冒充shutdown执行。
- explicit CAS由真实current generation驱动，oldA用其原generation，foreignpoll不改变owner。
- 旧connection close/poll/reply不能伤继任；settled/timeout项不作为幽灵queue重发。
- 换connection不刷新原deadline或业务许可，不更改Work/attempt/session/contract/businessfence。
- 两真实caller的source/原Store/guard与B/H核同run，不能拿两份不同demo拼恢复。
- 旧intent晚allowed拒绝，继任新intent需原guard新决定；同nonce重复不能多次消费。

原输入EOF与显式terminal分别测，保持运行中的合法继任，避免关闭一个stdio时误关原业务。
终态generation的只读观察可以保留，但不得借读取或旧cached值重新绑定/启动callback。

交付：actual main service/ports、临时断连/终态/正常继续的可复验正负与有界资源结论。
原Work恢复到check/currentCandidate/manualaccept仍依B/main原authority，不由I模块绿灯授予。
不运行unsafe live SIGKILL/procguard/globalps做此项证明。

### I5 namespace、backpressure 与有界压力诊断

完整成果：原多任务环境中容量有限、慢/错回调可诊断，pending资源按真实结果准确回收。

- kind namespace、freshcorrelation、原byte/pending/deadline限制继续唯一module管理。
- 超容量/超bytes在send前拒绝；settle/timeout/drop/rebind/terminal后bytes/waiter/queue/timer精确归还。
- slowStore、拒guard、缺payload、callbackthrow、重复/晚ACK和控制时序都给有限不同边界压力。
- 错kind/rawid/producer/frame不解锁别的pending，callback异常不变假ACK或allowed。
- 错误结果保留层/单位/原request和确定性，未知不推断写入从未发生。
- 不拉长timeout或新timer/queue掩盖挂起，不用600/1800重复happycase替代边界证明。
- collector也有总deadline/输出上限，自己的handler/connection/timer结束有证据。
- 只将通信资源事实交原owner，不把moduleclose授予process/child/socket/fd/journal完整quiescence。

页预算按整个实际编码wire响应计，chunk单位按真实字节计，不以解析后对象或base64字符长度替代。
失败点必须对应本次actualconsumer，source-only和I测试自己的transport不得冒充installed消费者。

交付：实际consumer、合法positive与独立negative、资源前/峰/后及精确命令exit，typedstrict与原接口兼容。
源码早交，发现B/main错误给最小复现，不跨owned改实现或E断言。
四独立channel是隔离证明，不是原scheduler容量/第五项等待/aggregate释放证明。

### I6 与 B/main/H 的同原 run 物理及持久交接

完整成果：通信块能支撑完整原任务恢复/多槽运行，并给其他owner可直接消费的事实和准确限制。

- 绑定原Application Work/question/answer/command/attempt与原Store，而不是seeded/equivalentguard代替。
- 对原receiver/ACK/receipt窗口传递准确result，已observed不重发、UNKNOWN保留原ID和账本。
- B/main原check/currentCandidate/显式accept/工件与原资源结论能贯穿同run；I不新候选或接受gate。
- 原scheduler2/4、fifth-item等待、UNKNOWN占用和释放由原core/queue/bindings与fullresourcebarrier决定。
- 给B/H自己的timer/waiter/queue等真实资源记录，不维护第二slotqueue或生命周期。
- 重开后的端点/producer/version/lease来源明确，旧credential/配置/readreview不提供新grant。
- source与D/Esame-packageconsumer分清，缺包内entry不借checkout补齐；runtime变更由正确后继freeze处理。
- 交维护手册、actualsourceclosure、RPC错误与排障、原数据/资源来源，不引无关研究依赖。

重启后回调应由原authority重新取得，不能把上一个进程的live map/函数对象序列化成新的许可。
各owner的证据只覆盖自己的真实边界，I不替B证明物理结束，也不替H/E证明最终使用或发行。

交付：B/main/H共同可重跑的原run支持记录与精确未达，E仍独立给最终产品oracle。
六完整成果满足真实出口才结束goal，不以147tests、四endpoint或一份manual当整体产品完成。

## 独立备选队列

- main原方法已交立即消费；B原任务链未到只阻对应proof，继续typed兼容、实际callbacks、错误/压力/文档。
- H未到给exactsource/run/公开入口，不替H/E造独立绿灯；物理安全不足不妨碍纯通信工程。
- 原命令接口缺失给实际可编译consumer/RFC，不新authority或绕old source来凑测试。

## 整包完成条件

- 更新 reports/runtime-channel/wave34-status.json：六成果actualsource/inner/outer/原ID、commands/exit、正负与未达分列。
- source早发后继续第二包/独立队列；所有成果含实现、实际consumer、兼容/错误与主线可维护交接。
- 只提交I owned显式路径到原origin，不upstream/reset/改他人dirty/root/contracts/config/lock/HTTP/App/transport。
- 保留12用户实例5180/8796至5191/8807及全部state/profile/tar/ledger/history/dirty。
- 自动real vendor/model/native0，B UNKNOWN cap4与E原pilotBLOCKED保持，不reset/topup/refund/补样/价格研究。
- 无unsafe live SIGKILL/procguard/globalps、substringkill、外来凭据/真实CLIfallback、新Driver/CAC/桌面/自动接受。
- 不新增第二state/queue/ledger/coordinator/lifecycle/wiregrant；source/controlled/native/recovery/installed/收益分层。
