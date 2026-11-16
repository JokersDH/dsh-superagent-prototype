# I：唯一原通信、命令兼容与恢复交接的九项完整成果

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-i`、`codex/g5-coordinator-channel`。
保留历史/dirty/state/ledger，fetch合并最新origin/main，固定actualsource。
读AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读[0089：模型配置消费](../../docs/rfcs/WP-16/0089-main-model-configuration-consumer.md)、[0090](../../docs/rfcs/WP-16/0090-wave-35-reviewed-architecture.md)、[0091](../../docs/rfcs/WP-16/0091-wave-35-continuous-subsystem-program.md)。
当前主线 `8cd709ca` 包含模型配置消费源码 `4cde5883` 和launcher后继；B控制源仍未合，不把配置/表单可用说成原Work/Broker恢复完成。
依据[独立验收](../../reports/releases/wave35-admission/runtime-channel.json)，建立/继续一个wholegoal覆盖三个连续工程包×三完整成果=I1–I9。
这是更大的完整通信子系统工程，不拆九个fix；无时长/token/day承诺，source早发后继续后续包/独立队列。

## 当前输入与所有权

- I只拥有attach-channel src/test和runtime-channel docs/reports；B管service/transport/RunnerLink/物理生命周期。
- main管原App/QuestionBroker/current/command authority、共享契约/root/config/lock/HTTP/App/transport。
- main已交原RunningAttempt clone port与同class原payload/fact/register/policy-ready/nativeguard及attachCallbacks。
- 正常stdio/attached共用原方法，不再缺原回调来源；不把Node函数/旧live map序列化成跨进程许可。
- oldforeigncancel/oldleasefeed/prototype入口/Haccept等待已闭，保持回归；newunboundlease/公开pidre-adopt有独立反例。
- main模型配置只是连接/身份输入，不等于agent执行授权，不使自动vendor/model/native额度变化。
- 四channel/injected-private-endpoint/seeded Store测试各有scope，不称真实launch/原Work/Broker/4scheduler。
- 不写第二pending/state/queue/ledger/gate/server/coordinator/scheduler/lifecycle；不改B/main源或E断言。

## 工程包一：唯一实现的真实原方法与命令边界

### I1 真实RunningAttempt与原三回调采用

完整成果：实际原运行返回的回调通过唯一channel工作，内容/原Storereceipt/producer关联均可验证。

- 消费真实runtime.launch返回的running及其原port/callbacks，不拿this或构造shape冒充。
- 核handle、producer、attempt/contract完整身份关联，缺字段/错subject先拒而非靠类型cast。
- 不反射改private endpoint后称原factory已接；可以保留明确标注的注入组件测试。
- fact走原copy/register/UoW/policy-ready，payload走原reference/body，native走原current/digest/live map。
- 旧nonce/foreignproducer/错receipt/payload/body/缺callback0错settle与效果。
- 固定main/B/I actualblobs及consumer entry，necessaryclosure真实执行前后核对。

交付：actual原方法消费者、精确原ID/回执/字节、合法正向与独立拒绝及main可维护source。
不要再交anotherdata port；原Application/QuestionBroker未达到时保NOT_REACHED，不宣传全链。

### I2 原fresh guard的完整void/throw/晚调用语义

完整成果：所有nativeintent都由同一个原业务guard逐次决定，晚回复和异常不能生成许可。

- main原voidguard成功经awaitwrapper才显式true；未包装callback返回void仍须false。
- 缺guard、deny/throw、current变化、commanddigest错误、liveanswer已消费全部拒绝。
- 正常stdio与attached共用同map/原方法，不复制等价guard或缓存allowed。
- 延迟guard/重复同businesscommand/新nonce/接管中旧回调保持各自相关性。
- 原目标/version/session/epoch由原Broker决定；I仅保真请求/typed结果，不成为policyowner。
- 保留timeout/closed/stale/denied/indeterminate差异，不能把失败当未写/可自动重试。

交付：真实原class/Store与actualcaller的fresh/late正负、原guard计数与0错误效果，typed兼容。
原生/vendor效果仍未测就保留该层未知，不能用计数代价值或权限能力证明。

### I3 首次lease、旧RPC与原commandauthority兼容

完整成果：命令/控制由原authority发出，正确lease与producer被操作前验证，升级不会静默改安全语义。

- callback generation不替businessfence；原nativeFence→index→allowAnswer→send→runtime.feed顺序保持。
- newunbound claimedlease须先拒，不能因service缓存为空就放行；优先复用I现有公共lease判定不新stateowner。
- 正常、valid旧epoch≥1/current≥2、foreignsource/body/contract、旧lease与terminal正负清楚。
- producer-before-cancel-effect旧修复保持，合法原quiesce/barrier与虚假callbacklease明确区分。
- 新cancel envelope/lease需要完整client/server发布；mixed-version不明结果准确诊断，不自动降级barecancel。
- 原stdio业务feed可保留：远端回调接管不要求同时绕过原命令检查；真正断开后再用准入RPC。
- 必要Node-local加法接口由B/main RFC审，I不自造命令grant/frozenwire/新ledger。

交付：actualservice/RPCreceiver与原Store/currentguard边界、兼容typedconsumer、明确source闭包与负向效果。
第一包source早交后继续接管/错误/压力和原run交接，不停在接口清单。

## 工程包二：数据继任、终态与有限并发

### I4 临时detach与终态的完整同运行继任

完整成果：原运行可合法换连接保数据，明确终端不能复活lease或迁移批准。

- 临时detach保fact/payload原ID/ref/remainingdeadline，nativepending为indeterminate而非未发送。
- mainterminal fix保持：late receipt/payload/writeadmission与新bind均拒，别重造终态owner。
- 合法带id协议帧才算控制执行；协议拒绝、clientstop与输入EOF分别记录。
- 原输入EOF与显式shutdown分开，正在运行时合法继任不能被误关。
- explicitCAS用真实generation，oldA用其原值，foreignpoll不改owner，旧close不伤新consumer。
- 不因重绑刷新deadline/许可，不变原Work/attempt/session/contract/businessfence。

交付：actualmainservice与两个真实consumer的临时/终态/正常继续正负和准确资源收尾。
模块handovers不冒称原Work恢复，unsafe live SIGKILL/procguard不是开工或交付前提。

### I5 原ID、namespace与payload/journal共存

完整成果：并发与恢复读取保原内容、相关性和有限字节，不把不同协议/层的ID混用。

- fact/payload/native kind namespace唯一，same rawID跨kind不能错settle，duplicate只结算一次。
- 原reference/body callback与journal descriptor/chunk区分，真正序列/字节/digest可重组。
- 页预算按整个编码wire响应而非对象/字符串body，chunk按真实byte不是base64字符计。
- wrongreceipt/payloadref/body/source、非法offset/length与晚ACK在正确边界拒绝。
- settled/timeout request从唯一queue清理，继任不遇幽灵待办；不加旁路pendingstore。
- 原Store ACK/UoW异常不会变假persisted，transport成功不称业务/native完成。

交付：actual同端点callback+分页/块读取/原ID完整性消费者与必要有界正负、source与命令exit。
旧预算/nonce修复保精准范围，不重复派小修取代完整使用出口。

### I6 Backpressure、慢/错回调与诊断闭合

完整成果：产品并发使用中容量有限、控制可用、错误可判定且通信资源实际归还。

- saturation在send前拒绝，settle/timeout/drop/rebind/terminal后bytes/waiter/queue/timer精确回收。
- slowStore、缺payload、拒guard、callbackthrow、重复/晚ACK和控制时序各有有限不同边界。
- 不延长timeout或加第二timer/queue掩盖挂起，不以长soak同happycase凑时长。
- typederror保层/原request/确定性，unknown不推断safe-to-retry，不自动新commandid或refund。
- 诊断脱敏且有界，source/build/version差异清楚，collector自身也无遗留。
- fourendpoint只证明通信隔离，不授予productslotrelease或物理quiescence。

交付：actualconsumer、前/峰/后通信资源、合法positive/独立negative、strict/exactOptional兼容和可操作排障。
source发布后继续原App/持久/physical交接，不在容量测试绿灯结束第二包。

## 工程包三：原业务恢复、持久与整体产品交接

### I7 原Application/QuestionBroker同run恢复支持

完整成果：I通信块真实服务原业务问答、接管和未知窗口，而非只服务seeded fixture。

- B/main原Work/question/answer/command/attempt/contract与原Store是唯一subject，不新Work拼证据。
- 原receiver/ACK/receipt/observations保持not_seen/intent/observed/unknown区别，已应用不重发。
- 原beforeWrite每次fresh，pendingnative不能跨owner变旧allowed，错target/version/session拒绝。
- 同run继续原check/currentCandidate/availableaccept/显式交付，I不新候选/接受gate。
- 受控/注入/真实factory/原应用/native层分别标，没跑Native.launch就不能称它已通过。

交付：B/main/H可共同复验的原run支持、原ID/result/source/consumer与精确未达。
不复制恢复coordinator或业务账本，缺接口给actual可编译consumer/RFC并继续其他项。

### I8 原2/4调度、物理和非空重启交接

完整成果：原scheduler可使用通信事实判断原运行，不由I或accountinghelper变成第二资源authority。

- 2/4/fifth-item等待、UNKNOWN占用、取消和释放由原core/queue/bindings/fullbarrier决定。
- per-slot producer/credential/generation/receipt/payload隔离，一槽错误不关或批准别的槽。
- I交真实timer/waiter/queue/handler事实给owner，不用moduleclose/onePID等价process/child/fd/journal全结束。
- 非空重开从原注册/当前authority重建，函数/answer-map不序列化当新许可，ended不复活。
- 原资源UNKNOWN保留材料与容量，不能为跑通队列清状态或另起任务。

交付：同原run多任务/资源/持久支持记录，与B/H核对原事实，准确区分四channel和真实scheduler。
证据缺口由真实owner闭合，I不代B/H/E证明物理结束或发行。

### I9 完整采用手册、精确source/package与使用支持

完整成果：其他owner可以稳定维护唯一通信块，用户的完整journey有准确可复现支撑。

- 交实际调用图、原authority来源、必要sourceclosure、版本/错误/重建规则与consumer示例。
- 用真实running，不沿用attachRunningAttempt(this,...)无效示意；校验handle与producer身份。
- readonly模型配置/诊断不启动原native或授grant，秘密/本地路径不泄到UI或support。
- 同包consumer需用D冻结字节，sourcecheckout不补包内entry；旧包时间scope不改label。
- Esoleoracle给最终产品结论；I的source/controlled/native/recovery/installed/价值层分别诚实报告。

交付：可操作采用/排障/支持材料、同source与同包边界、原run与整产品使用的交接；九完整成果全达再结束goal。
不以模块case数、阶段数量或外壳ZIP称完整多agent恢复已实现。

## 独立备选队列

- 原方法/port已交立即消费；B原业务未到只阻对应proof，继续typed/namespace/压力/错误/兼容。
- H未到给exactsource/run/入口，不替H/E写独立绿灯；物理安全不足不阻纯通信工程。
- 新RPC接口不足给B/main实际consumer/RFC，不跨owner改service或另造grant。

## 整包完成条件

- 更新reports/runtime-channel/wave35-status.json，九成果actualsource/inner/outer/原ID、commands/exit、正负与未达齐全。
- 三包连续、source早发后继续后续包；只I owned显式路径推origin，不upstream/reset/改B/main/E或root/config/lock。
- 保留12实例5180/8796至5191/8807及全部state/profile/tar/ledger/history/dirty。
- 自动real vendor/model/native0，B UNKNOWNcap4与E原pilotBLOCKED，不reset/topup/refund/补样/价格研究。
- 禁unsafe live SIGKILL/procguard/globalps/socket发现、substringkill、借凭据/真实CLI回退。
- 无新Driver/CAC/桌面/自动接受/writer racing/动态DAG/第二statequeue或生命周期；完整工程不缩成纯fixture。
