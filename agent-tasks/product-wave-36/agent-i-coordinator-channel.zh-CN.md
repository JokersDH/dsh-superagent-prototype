# I：唯一通信、真实运行采用与维护交接的完整子系统

2026-11-17。继续 `/Users/hh/Desktop/joker/superagent-agent-i`、`codex/g5-coordinator-channel`。
保留历史/dirty/state/ledger，fetch合并最新origin/main，固定actualsource。
读AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读[0092：主线completion/history消费](../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)、[0093](../../docs/rfcs/WP-16/0093-wave-36-reviewed-architecture.md)、[0094](../../docs/rfcs/WP-16/0094-wave-36-whole-subsystem-closures.md)。
依据[独立验收](../../reports/releases/wave36-admission/runtime-channel.json)，建立/继续一个whole-subsystem goal覆盖四个端到端产品闭环。
旧I1–I9实现/证据/未达继续，不清零，不以9→12堆微阶段；扩到生产、默认consumer、同版本/维护。
早中晚source尽早交后连续所有闭环与独立队列，不等小修派工，不设工时/token/day承诺。

## 当前输入与所有权

- I只管attach-channel src/test与runtime-channel docs/reports；B管service/transport/RunnerLink/物理生命周期。
- main管原App/Broker/current/command authority和共享契约/root/config/lock/HTTP/App/transport，E唯一产品oracle。
- main原clone port、同class callbacks已交，stdio/attached共用原guard；不再造anotherdata port。
- I inspectRunningAttempt/owns为pure conformance/owner projection，不是permission或原factory provenance。
- launchShape/反射注入private endpoint测试明确保component标签，不当实际runtime.launch返回handle。
- B旧unboundlease/oldlease/foreigncancel/helperId已闭，I状态旧handoff不得继续当当前阻断。
- 新B自然terminal后原physicalquiesce被拒和exited-child readopt更新birth有P1，分别属B控制兼容/工具。
- 不改B/main源、root/config/lock/HTTP/App/transport或E断言，不新第二state/queue/ledger/gate/coordinator/lifecycle。

## 产品闭环一：sole channel的lease、原guard与RPC生产契约

产品出口：原产品只有一套通信实现，当前lease、业务authority和原物理control分别明确且可由默认consumer使用。

- owns/next都只投影原owner，不bind、不刷新许可，不通过旁路activeLease缓存生成authority。
- 首次unbound/old/foreign/terminal claimedlease操作前拒绝，合法CAS不让foreign请求改generation。
- callback generation与business fence分开，valid旧epoch≥1/当前≥2、完整contract/producer/body独立核。
- main原beforeNativeWrite void成功经awaitwrapper才显式true；未包装void、missing/deny/throw/current改变/已消费map均拒。
- 原同class/current/commanddigest/liveanswer map唯一，不复制等价guard、缓存allowed或把sink/登记当grant。
- 原nativeFence→index→allowAnswer→send→runtime.feed顺序保留，raw RPC不等业务写权限。
- 合法原quiesce/fullresourcebarrier与虚假callbacklease/新业务feed分开；sent不等applied/quiescent。
- 自然terminal后物理finalize必须与main实际waitExit→quiesce契约兼容，但callback/feed/rebind仍terminal拒绝。
- 不能把terminated/open admission称confirmed或通过放松终态guard修兼容；向B/main交明确typed消费者要求。
- cancel envelope/lease完整client/server同版本，旧新组合明确拒绝/版本原因，不自动降级barecancel。
- 保留timeout/closed/stale/deny/indeterminate差异，不承诺safe-to-retry或新commandid重放。
- frozenwire/新Node-local控制加法由main/B RFC审，I不造command grant或第二authority。

默认消费者与验收：

- actualmain/Bservice原RPC/receiver与currentguard共同验证正常、first/old/foreign、activecancel、naturalterminalfinalize。
- typed client/server arity明确，消费者不能把server的producer参数错当client lease；strict/exactOptional实际编译。
- 原框架错误shape保持，诊断有界脱敏；不以添加code改main已观察的拒绝语义。
- source和完整必要闭包早交；I pure/reference消费者不冒称B/default路径已调用。

维护出口：default产品使用同一lease/guard/RPC契约，异常能定位到owner且不触发新工作，旧闭合范围精确保留。

## 产品闭环二：真实launch返回对象的三回调默认采用

产品出口：main真实原running的port/callbacks在原Application/Broker任务中实际被唯一channel消费，而非只有shape测试。

- 使用runtime.launch返回running，不使用Native实例this、反射private endpoint或手写noop feed/stop当原结果。
- inspectRunningAttempt核完整producer tuple/registration/callbacks/handle关联，可传原current binding作期望。
- 该pureguard只是conformance，当前性/原beforeWrite与权限仍由main/Broker逐次判，不能把ok当grant。
- callback来自同次running：fact原copy/source/register/StoreUoW/policy-ready、payload原reference/body、native原map。
- 先await初次bind/poll再发可能引发intent的begin，避免在stdio owner时产生pending批准后接管。
- 原business command可暂走running.feed/stdin，callbackhandover本身不要求替换原命令authority。
- 若需零native测试真实factory，优先已有RunnerHost/RunnerLink依赖边界的实际inprocesshost，不把注入shape升级为launch。
- same rawid跨kind namespace保留，freshnonce与businessid分开；错receipt/payload/body/producer拒绝不假ACK。
- 原callback可选字段缺失只拒，Node函数不进HTTP DTO/日志/持久JSON，不序列化为跨进程许可。
- 原question/version/target/session/answer与原delivery必须可追溯，seeded/等价guard各保其component scope。

默认消费者与验收：

- 正常三callback、原payload/receipt、逐intent原guard、旧nonce/缺/deny/throw0错效果在actual原consumer中闭合。
- main/B/H共享同run原IDs与receiver/Store/guard计数，不能拼不同demo或用port字段存在替真实调用。
- callbackpump由原running lifetime/current/timeout监督，原finally停止，不把helper默认短deadline静默当产品寿命。
- 四guard/helper/data模块文件的必要依赖按actualimport核，不引无关responder/review/budget路径凑采用。

维护出口：普通用户默认任务真实采用本块，main/B能按同源typed接口维护；旧I1–I9未达在此继续而非清零。
source早交后继续unknown/继任与耐久协同，不在pureguard或一个import完成处结束。

## 产品闭环三：unknown、继任与durable ACK的原业务协同

产品出口：同一个原任务断连/接管/错误时保数据和原账本，不迁移批准、不错误重放，并支持原交付继续。

- temporarydetach保fact/payload原ID/ref/remainingdeadline，nativepending为indeterminate而非not_sent。
- mainterminal fix保持，late receipt/payload/writeadmission/newbind不能复活；合法协议id与EOF/stop/shutdown分别记录。
- 原generation CAS与业务epoch分别保持，oldA用原generation，旧close/reply不能伤继任。
- settled/timeout请求精确prune，不在新owner重发幽灵项，不因接管刷新deadline/许可。
- 原receiver/ACK/receipt与Store intent/observed/delivery支持not_seen/unknown区分，不从timeout猜未写。
- 已persisted/applied不重发，UNKNOWN不换ID/清ledger/refund；不添加另一receipt或恢复coordinator。
- 原Work/attempt/question/answer/session/contract/Runner/登记不变，新process读已完成行不是业务恢复。
- 原QuestionBroker beforeWrite从当前原state重新取得，旧函数/live map不序列化当新grant。
- 原同run继续frozenartifact/registeredcheck/currentCandidate/availableaccept/显式交付，I不新候选/接受gate。
- 正常、故障/unknown、source/controlled/native/recovered分层，方法测试不替App/Broker路径。

默认消费者与验收：

- actualmain/B原run两个consumer的原事实/回执/guard与H独立材料一致，freshintent需fresh原决定。
- late/duplicate/错kind/id/source/旧批准/旧target/current变化都有合法对照和0错settle。
- activecancel和naturalterminalfinalize不混成同一假positive，原completebarrier继续由物理owner判断。
- 不用unsafe live SIGKILL/procguard/globalps做原恢复证明；必要controlled场景有限且资源有界。

维护出口：消费者能准确解释已完成/未知/需人工/可继续的状态；source交后继续所有闭环，不在模块handover处收工。
缺原resume factory给main/B实际可编译consumer与最小来源需求，不再造data port/生命周期。

## 产品闭环四：bounded背压、同版本兼容与B/H/main实际运行交接

产品出口：通信块在原多任务日常使用中有界、隔离、可诊断，发行/支持能用同版本证据维护完整产品。

- 唯一module管理pending/timer/correlation/queue，saturation在send前拒，settle/drop/rebind/timeout/terminal准确回收。
- slowStore、缺payload、guardthrow/deny、重复lateACK和控制时序给有限不同边界，不长soak重复happycase。
- kind namespace、原wire页预算、descriptor/chunk/reference/body分开，字节/seq/digest实际可重组。
- 总deadline/输出上限明确，自身collector/handler/timer/waiter/connection收尾有证据，不用force-exit冒充无遗留。
- per-slot source/credential/generation/payload/receipt隔离，一槽错误不关/批准其他槽。
- 四channel只证明隔离；原2/4scheduler/第五项等待/UNKNOWN占用/释放由原core/queue/bindings/fullbarrier证明。
- I交通信资源真实事实，不把moduleclose/单PID/shape stop的confirmed当完整process/child/fd/journal结束。
- 非空重开从原登记/current authority重建，不让新channel空队列证明原数据已恢复。
- typed错误、client/server参数、身份/版本/refusal兼容实际main/B消费者，不私自改frozenwire。
- exactsource/consumer入口/包内字节清楚，D冻结E独立验；checkout不补包缺entry，旧包不relable新source。
- 主线模型连接/readonly诊断不花vendor额度或授native权限，秘密/path不进可见诊断。
- B/H/main同原run交接call graph/authority/原IDs/资源/操作/错误材料，I不替其他owner给最终绿灯。

默认消费者与验收：

- 同版本真实consumer在容量/错误后仍能继续，UNKNOWN/缺证不错误释放业务slot或重发效果。
- 原任务使用、恢复与维护路径可由别人重复，不止I测试目录能import；E仍独立oracle。
- 已闭pure/helper/source范围保留，native/installed/recovery/value未测就未测，case数不抬产品完成度。

## 独立备选队列

- main原port/方法已交立即消费；B原业务未到只阻对应proof，继续实际typed/namespace/压力/兼容/错误。
- H未到交exactsource/run/入口，不代H/E造独立结论；物理安全不足不阻pure/inprocess通信工程。
- 共享API不足给actualconsumer/RFC，不跨I owned改service、生产schema/HTTP/App或新authority。

## 整包完成条件

- 一个whole-subsystem goal含四个更大端到端闭环，旧九项继续；生产/defaultconsumer/正负/同版本维护交接齐。
- 早中晚source发布后连续所有闭环与独立队列，更新reports/runtime-channel/wave36-status.json真实source/run/inner/outer/未达。
- 仅I owned显式路径推origin，不upstream/reset/清他人dirty，保留12实例5180/8796至5191/8807及所有state/profile/tar/ledger/history。
- 自动real vendor/model/native0、真实信号0，B UNKNOWNcap4/E原pilotBLOCKED，不reset/topup/refund/补样/价格研究。
- 禁unsafe live SIGKILL/procguard/globalps/socket发现/substringkill/借凭据/真实CLI回退。
- 无新Driver/CAC/桌面/自动接受/writer racing/动态DAG/第二statequeue/ledger/lifecycle，分清source/controlled/native/recovery/installed/value。
