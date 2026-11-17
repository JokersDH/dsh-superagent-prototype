# B：原运行、默认业务消费与恢复维护的完整子系统

2026-11-17。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、`codex/g1-runtime`。
保留全部dirty/history/state/ledger，fetch合并最新origin/main，固定actualsource。
读AGENTS、START-HERE、product-spec/README和[本轮 README](README.zh-CN.md)。
再读[0092：主线completion/history消费](../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)、[0093](../../docs/rfcs/WP-16/0093-wave-36-reviewed-architecture.md)、[0094](../../docs/rfcs/WP-16/0094-wave-36-whole-subsystem-closures.md)。
以[独立验收](../../reports/releases/wave36-admission/runtime-channel.json)为准，建立/继续一个whole-subsystem goal覆盖下列四个端到端产品闭环。
旧B1–B9作为闭环内部的实现、证据与未达清单继续，不清零、不用四标题假装旧工作已完成。
本轮扩到生产实现→默认consumer→同版本运行/维护，不再9→12堆微阶段。
早中晚source尽早发布后连续完成所有闭环与独立队列，不等一项小修后再派工；不设工时/token/day承诺。

## 已交事实与归属

- main已有真实RunningAttempt的clone port和原同class回调，stdio/attached共用payload/fact/register/policy-ready/native guard。
- 原current/commanddigest/live answer map仍唯一，原voidguard await成功才显式true；不再等待anotherdata port。
- unbound claimedlease、旧leasefeed、foreigncancel写后拒、public child.pid改值及helperattemptId旧例已闭，保持准确正负。
- 新P1是terminal后原合法quiesce被拒，以及已退出child同PID复用后readopt刷新出生；不是重开旧terminalcallback漏洞。
- B控制四文件strict/基本7矩阵过，但默认waitExit→quiesce兼容未过，当前不得称默认业务已准入。
- I新增owns/shapevalidator是可选pure接口，B当前next判定已可拒假lease；pureconformance不授执行权。
- B管原execution/catalog/policy-preparation/driver-kit/testing/drivers、Runner/native-acceptance，排除I attach-channel src/test。
- main管原App/Broker/current/commandauthority、共享契约/root/config/lock/HTTP/App/transport；A迁移、E产品oracle唯一。
- 不新增第二queue/ledger/coordinator/policyowner/候选表或生命周期，不改他人断言凑绿。

## 产品闭环一：原factory、三回调与当前控制的生产默认路径

产品出口：同一原RunningAttempt从出生、准备、回调服务到正常/终态物理收尾，都可被默认产品consumer安全使用。

- factory保留原成功PID/start/UID/parent/有序argv/root/config/operation和子资源，私有出生不可由readopt刷新。
- 原child已exit、同PID新start/parent、另一factory、公开pid变化、plain/prototype/never-spawn/copy均不能取得新能力。
- 原own positive与旧handle拒绝不能替代readopt negative；每signal/cleanup核全，UNKNOWN保留材料。
- 禁unsafe live SIGKILL/procguard/globalps补证，只pure/inprocess与合法已知controlledconsumer，自动真实信号0。
- 消费runtime.launch返回的真实running，核handle/producer/current binding，不用this、伪造shape或反射private endpoint称原factory。
- 先await初次bind/poll，再允许原业务begin引发intent；callbacks来自原running，不复制等价guard或receipt。
- 原fact copy/source/register/UoW/policy-ready、原payload reference/body、原beforeWrite/map都走main同一方法。
- 缺callback/guard、deny/throw、错source/target/version/body/旧nonce在实际效果前拒绝。
- 原命令仍经nativeFence→index→allowAnswer→send→runtime.feed/current，callback generation不替business fence。
- 原合法无lease物理stop与虚假lease声明分开；旧/未绑定lease、foreign、terminal业务feed继续拒绝。
- 补默认自然结束后的原quiesce：保留原认证幂等物理finalization或等价fresh完整barrier适配。
- 不放松terminal callback/feed/rebind；terminated但admission=open不能被直接叫confirmed，barrier仍须closed/fullquiescent。
- 新cancel envelope/lease需caller+transport+endpoint+service同版本闭包，mixedversion准确拒绝，不降级barecancel。

默认消费者与验收：

- actual原running激活，而非只export helper；正常取消与自然waitExit后收尾都能完成原barrier。
- 同版本正向、first/old/foreign/terminal负向、旧新client/server和同IDreceipt重放分清效果。
- newbirth、post-exit finalize修复是完整路径的一部分，不能各交一个if就停整个goal。
- main若暂保留原stdio命令路线，仍可远端接管callbacks；不要求先替换所有RPC才能打通正常产品。
- 交完整必要source/consumer/命令exit/原ID/资源，D/E不得用旧包替此新运行字节。

维护出口：原运行owner监督callbackpump到原running.waitExit/current/timeout，teardown在原finally内收尾，不建第二生命周期。
接口不足给main最小实际consumer/RFC并继续owned实现，不能再等待anotherport或跨I目录自写module。

## 产品闭环二：原Application/Broker正常问答到检查、接受与交付

产品出口：用户从原委托入口创建的一个Work，经原问题/答案与执行，形成原验证候选并由明确动作交付。

- 原Application/Store/QuestionBroker创建原Work/Ticket/Assignment/attempt，不直接插表或换普通任务填链。
- 原目标/输入/Scope/profile/policy/environment保持，模型连接配置不等于agent写权限或原native批准。
- 原Question/version/target/session/request与答案payload完整，过期/冲突/错误目标在beforeWrite前拒绝。
- native每次调用原current/recorded body/liveAnswerMap，不缓存旧allowed或把sink/ready/登记当grant。
- 原RunningAttempt callbacks在默认执行路径中实际被调用，源级fixture/equivalentguard不能替原Broker。
- 保留原业务命令ID、core/Store ingress/ACK/observations，end_turn不等交付合格。
- 原workspace/basecommit/contract与冻结artifact/manifest/digest绑定，不覆盖原项目或扩大路径。
- 原registeredcheck实际执行，FAIL/unknown/活动writer不产生可接受候选。
- 只经原completionCandidate→application.verify→currentCandidate，不新增候选或accepted账本。
- 等available确含accept_candidate后显式完整CandidateRef接受，human criterion和资源门保持。
- 工件/download/location可读，原Work delivered与重开状态一致；真实等待/审阅数据才记录。

默认消费者与验收：

- 正常用户journey从原App命令到原交付实际可复现；原handle/问答/命令/receipt/check/candidate/artifacts同run。
- stale合同/问题/候选、缺权限/执行器/策略、错body/receipt/payload、机器FAIL给准确错误和0越权效果。
- 若测试真实factory，优先已有RunnerHost/RunnerLink依赖边界的合法controlledhost，不反射或假Running当真实launch。
- source/controlled/native分别报告；自动vendor/model/native0，不以“正常journey”花旧UNKNOWN或BLOCKED额度。
- 交source与默认入口操作/错误材料，不把一次私有CLI或固定fake输出宣传全产品完成。

维护出口：同版本正常使用不需要手工拼receipt或临时改参数；原main权威路径和可操作诊断可由他人维护。
callback/data基础已交应立即消费，缺特定主线组合点精确给方法与actualconsumer，其他原数据/错误工作继续。

## 产品闭环三：同原Work故障接续与原2/4槽资源安全

产品出口：同一原任务在受控中断后能继续原问答/验证/交付，原调度器依完整资源事实保留或归还容量。

- 使用无信号detach/输入结束/合法继任等必要controlled情形，不为证明live SIGKILL而跑危险工具。
- 原Work/attempt/Runner/child/session/request/contract/登记不换，新进程只读已完成行不算业务续接。
- fact/payload保原ID/ref/remainingdeadline，挂起nativeintent为indeterminate，不迁移旧批准。
- beforewrite、receiver后ACK前、receipt前后分别核not_seen/intent/observed/native_applied/unknown。
- 已收/已应用不重发，UNKNOWN不新commandid、不清ledger、不退款、不创建“干净”替代Work。
- 继任从原Store/current binding/commands/answers/observations重建，并重新取得原Broker当前beforeWrite。
- 同run继续原freeze/check/currentCandidate/availableaccept/显式交付，普通新Work5PASS不能抵扣。
- 原scheduler2/4由原core/queue/bindings投影实施，candidate AttemptSlotScheduler独立queue不成为authority。
- 第五项原队列真实等待/拒绝，原attempt有完整证据结束后原queue继续，不直写ended腾slot。
- per-slot source/credential/lease/receipt/payload隔离，一槽cancel/unknown/lateACK不关或错批别的槽。
- 原process/child/socket/fd/timer/waiter/queue/journal/Runner全集合，UNKNOWN/缺end证据不释放。
- release依据原completebarrier，不用phase、单PIDgone、moduleclose、JSONplan或字符串confirmed。

默认消费者与验收：

- 同原run问答→故障→接管→检查/接受与真实scheduler容量/资源时间线可对应。
- 原receiver/Store/外在资源独立对照，旧epoch≥1/当前≥2、foreign/late/冲突与未知占用全保真。
- 四channel/四Work/会计helper各保component scope，不称原2/4scheduler或同Work恢复。
- main缺真resume factory时交最小同原登记/当前authority的实际方案，不再造数据port/ledger或换runner。

维护出口：失败材料准确保留，用户/运维能区分可以继续、等待人工、保持UNKNOWN和安全停止，不自动writer racing。
source发布后持续所有闭环；不在一次重连或计数变绿处停工。

## 产品闭环四：非空重启、同版本诊断与完整运行交接

产品出口：原工作/交付/未知状态重开后连续，主线与发行/支持可消费同一完整运行块并维护日常使用。

- 原非空Work/question/answer/command/delivery/candidate/artifact/history和binding/queue保留。
- 原registration/session/current权限重建，不让新constructor recoveryRoot冒充旧Runner。
- ended不复活、UNKNOWN不重发，live函数/旧answer map不序列化为grant，原receipt重放不新效果。
- 原profile/policy/environment/Scope重验，不从偏好、复制credential或readonly review推执行许可。
- 当前命令与物理cancel、callback/业务epoch、source/installed版本有明确可维护契约。
- 缺执行器/认证/协议/旧lease/terminal/unknown给准确有界脱敏诊断，不全局发现或借别的实例凭据。
- D冻结实际新runtime字节，E验同包producer/consumer；不relable旧tar或临时ZIP包含未冻能力。
- 合法冷启/复用/停止/非空重开和关键错误在同版本consumer里实际验证，docs-only不假refreeze。
- main/H/I/D/E收到完整必要source closure、call graph、操作/排障与原证据，不wholesale混入计费研究源。
- 有真实人使用/收益才记录，不从PASS数、连接配置或受控点击推价值/创新收益。

默认消费者与验收：

- 同版本源与实际安装/运行字节各自闭合；原数据/权限/unknown错误负向不以fallback掩盖。
- 主线defaultconsumer真实使用本块，而不是仅测试目录能import；完整使用/恢复/维护材料由别人可重复。
- 旧B1–B9状态逐项映射到四闭环，已闭合保留、未达继续，不把重命名当完成。

## 独立备选队列

- 原port/方法已交立即消费；特定共享接口不足交actual可编译consumer/RFC，继续回调/命令/数据/兼容。
- I/H只阻相应proof，安全不足只阻物理操作；不等模型、研究budget、新协议或安装壳才能做工程。
- 不跨owned自修另一module、迁移、HTTP/App或E断言，发现source问题给精确复现与必要闭包。

## 整包完成条件

- 一个whole-subsystem goal，四闭环包含生产实现、默认consumer、必要正负、同版本/维护source交接；旧九项延续不清零。
- 早中晚source交后连续所有闭环与独立队列，更新tests/native-acceptance/reports/wave36-status.json与真实未达。
- 显式owned路径推原origin，不upstream/reset/清状态；B旧两报告+b16、所有dirty/state/profile/tar/ledger/history保留。
- 自动real vendor/model/native0、真实信号0；B UNKNOWNcap4/E原pilotBLOCKED，不reset/topup/refund/补样/价格研究。
- 保留12实例5180/8796至5191/8807，禁unsafe live SIGKILL/procguard/globalps/socket发现/substringkill/外来凭据/真实CLI回退。
- 无新Driver/CAC/桌面/自动接受/动态DAG/第二queue或生命周期/frozenwire grant，未测native/recovery/installed/value准确分层。
