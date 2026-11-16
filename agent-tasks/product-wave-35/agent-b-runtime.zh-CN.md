# B：原应用执行、恢复交付与持久调度的九项完整成果

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、`codex/g1-runtime`。
保留全部 dirty/history/state/ledger，fetch 合并最新 origin/main，固定 actual source 后开始。
读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读[0089：主线模型配置消费](../../docs/rfcs/WP-16/0089-main-model-configuration-consumer.md)、[0090](../../docs/rfcs/WP-16/0090-wave-35-reviewed-architecture.md)、[0091](../../docs/rfcs/WP-16/0091-wave-35-continuous-subsystem-program.md)。
当前主线 `8cd709ca` 包含模型配置消费源码 `4cde5883` 和launcher后继；B控制源未合，原Work/Broker激活与恢复未执行，不能当本轮已完成。
以[本轮独立验收](../../reports/releases/wave35-admission/runtime-channel.json)为准，不沿用旧阻断列表。
建立/继续一个 whole goal，覆盖三个连续工程包、每包三项完整产品成果，共 B1–B9。
这是比 wave34 更大的完整子系统交付，不是九个缺陷或微阶段；不设时长/token/同日承诺。
source 早发后继续后两个工程包与独立队列，不等待每个检查点重新派工。

## 已交输入与边界

- main23d5/后继已交原 clone attachPort、同 class readPayload/beforeNativeWrite/recordFact 与 attachCallbacks。
- 正常stdio和attach共用原方法，原current/command digest/live answer map仍唯一；不要再等待另一个数据port。
- 原voidguard只有await成功才经mainwrapper变allowed:true，缺/deny/throw只拒，不复用旧allowed。
- 旧foreigncancel写后拒、旧leasefeed、plain/prototype无spawn登记和H动作等待反例已闭，保持其正负回归。
- 新问题是首次未绑定lease仍可feed、原factorychild的公开pid可改后重新adopt，以及handle/producer attemptId不比对。
- 新control协议是producer envelope+lease的完整client/server闭包，不能只合server或自动降级bare cancel。
- B管原execution/catalog/policy-preparation/driver-kit/testing/drivers、Runner与native-acceptance路径。
- 排除I的attach-channel src/test；main管原应用组合/共享契约/root/config/lock/HTTP/App/transport。
- A唯一生产迁移，E唯一产品断言；不复制新queue/ledger/coordinator/policy owner或生命周期。

## 工程包一：可信原运行与业务控制闭合

### B1 原factory出生、登记和完整资源能力

完整成果：从真实spawner到登记、重用、退出与错误留存，任何公开对象变化都不能换掉原OS资源身份。

- 保留private factory provenance与exact handle identity，不再回退到instanceof、metadata或任意PID。
- 把原PID及成功观察的start/UID/parent/完整有序argv/root/config/operation放进私有不可变出生记录。
- 原child.pid被改、原进程退出后PID复用、另一factory的child都不能重新取得authority。
- re-adopt核原出生，不以一次新ps快照刷新成外来进程；never-spawn/prototype/plain/copy继续0信号。
- 全资源集含必要child/socket/fd/timer/waiter/queue/journal，每项独立归属，不由parent或路径担保。
- 每操作fresh核全，UNKNOWN/缺证/变化保留材料；cleanup与正常路径共用同一能力。
- pure先验覆盖原own positive与新公开pid篡改/复用negative，spy实际计数0，不跑live SIGKILL/procguard补证。

消费者/交接：实际原factory调用者与H可独立复验的source、出生/资源事实、命令exit和保留策略。
这些修复只是完整运行能力的一部分，不能修完B1便停止后续原业务接线。

### B2 原RunningAttempt回调激活与真实问题服务

完整成果：实际原Application创建的Work，通过原RunningAttempt的原回调服务同一个Runner与QuestionBroker问题。

- 使用runtime.launch返回的真实running，不用RFC旧示意的this、伪造handle或反射改private endpoint当原采用。
- 核handle.attemptId与port producer完整身份匹配，缺port/callback只拒；类型断言不是关联证明。
- 原callback来自同一次running，fact走原copy/register/Store UoW/policy-ready，payload走原reference/body。
- native走原current/indexed command/live answer map与原QuestionBroker beforeWrite，不复制等价guard。
- 明确await初次poll/bind再把回调消费者视为就绪，不在feed中偷偷抢占lease。
- 保留同run原Work/attempt/question/target/session/contract/epoch、原数据和资源，不新Work/registry补证。
- actualquestion与answer delivery/native_applied或准确未知进入原Store，seeded component只保原scope。

消费者/交接：原App→原Broker→三callback→原delivery的实际纵链、合法正向及foreign/缺guard/错body0效果负向。
main已交原方法不是恢复完成证明，但也不再是本成果的缺失依赖。

### B3 原命令authority、首次lease与合法物理cancel

完整成果：原业务能正常feed与停止，首次/陈旧/外来/终端控制都在效果前经过正确authority。

- 修未绑定claimed lease在activeLease为空时被放行；对声称lease一律核I现有公共当前性，不另建owner缓存。
- callback generation与business fence分别校验，valid stale epoch≥1对current≥2，不能用非法epoch0充证据。
- 原nativeFence→index→allowAnswer→send→runtime.feed与current必须保留，raw RPC不是业务许可。
- 合法物理cancel仍原quiesce/登记proof/complete barrier；无lease的原物理控制与虚假lease声明明确区分。
- 已闭foreigncancel/oldlease拒绝保留，所有拒绝看receiver/资源前后，不只最终error。
- 新cancel envelope/lease的caller+transport+endpoint+service成套兼容，旧client/server组合明确失败/降级规则。
- 不自动fallback bare cancel、重发新commandid或添加wiregrant；必要Node-local方案先RFC main审。
- 明确stop-polling与stop-business不同，不能以stopped对象或缓存receipt宣称新控制已执行。

消费者/交接：正常feed/cancel、firstlease、oldlease、foreign、closed、重复同ID与mixed-version的实际正负及错误说明。
source早交后继续第二包；不等待新模型、真实native或临时ZIP才做完整业务工程。

## 工程包二：同原任务从中断到明确交付

### B4 原Work问答、输入与持续执行闭环

完整成果：原目标和原问答驱动的输入/控制能持续进入同一个已登记attempt，原生结束不被误当交付。

- 实际原Application委托与原权限/合同/Scope进入原执行入口，不直接写业务表构造任务。
- 原问题的版本、native target、session及answer引用完整，迟到/失效/冲突答复不进入writer。
- 逐次beforeWrite由原Broker决定；讨论模型连接配置不等于agent执行授权或原生权限。
- 业务命令可暂保留原running.feed/stdin路线，回调远端接管本身不要求替换命令authority。
- input/continue/取消与原ledger保持原ID，不因断连新建Work或Runner。
- 缺执行器/权限/策略/输入的错误准确且可操作，UNKNOWN不当未发送。

消费者/交接：至少一条原目标→原问题→原答案→持续执行的真实产品consumer与必要独立负向。
固定fake/seeded只可开发支持，原使用入口未测时准确SOURCE_READY/NOT_REACHED。

### B5 同原run中断、ACK窗口与继任

完整成果：合法受控中断后继任仍使用原运行和原账本，不丢数据、不迁移批准、不错误重放。

- 优先有限无信号detach/输入结束/合法接管，不为证明恢复运行unsafe live SIGKILL。
- 原Work/attempt/Runner/session/request/contract/登记不变，原Store重读是判定来源。
- fact/payload可保原ID/ref/remaining deadline续接，nativepending为indeterminate。
- before-write/receiver后ACK前/receipt前后窗口区分not_seen、intent、observed与unknown。
- 已收/已应用不重发，UNKNOWN不改ID、不清ledger、不退款、不制造新“干净”任务。
- 新进程只读已完成行不是原Runner续接；完整原factory/当前权限重建才可称恢复。

消费者/交接：同run原问答/命令/receiver/ACK/receipt前后链及可复验unknown保留，不能拼多份不同demo。
如果原输入通道已断，使用通过B3准入的同Runner RPC，仍经原current与命令账本。

### B6 原冻结、注册检查、当前候选与人工接受

完整成果：B4/B5的同原Work最终经过原机器/人工门产生可读交付，而不是创建普通新任务替恢复结果。

- 原basecommit/workspace/Scope/contract与frozen artifact/manifest/digest相互绑定。
- 原registered check真实运行，失败/未知/部分资源未结束不产生可接受候选。
- 只用原completionCandidate→application.verify→currentCandidate，不建新候选表或accepted字段。
- 等原available确含accept_candidate，显式完整CandidateRef接受，保留human criterion与原barrier。
- oldcontract/checkref/candidate/body/晚ACK都在原门拒绝，不能自动接受或修改E断言。
- 同run工件下载/location与非空重开仍可读，只有确实观察的人审/等待时间才记录。

消费者/交接：同原Work问答→artifact/check→candidate→明确accept→delivered的实际source、原IDs和正负证据。
包二有完整出口才叫recovered delivery，普通normal5PASS或模块handover不能抵扣。

## 工程包三：原调度、持久恢复与可维护产品

### B7 原core/queue的2/4槽与容量前进

完整成果：原调度器在2/4实际attempt下处理混合运行、待答、恢复与取消，队列真实等待并前进。

- 以原core/queue/bindings投影实施，candidate AttemptSlotScheduler独立records/queue不能成为第二authority。
- 必须观察第五项原队列等待/拒绝、原attempt结束后队头继续，不直接写ended或本地promote替代。
- per-slot producer/credential/generation/receipt/payload隔离，一槽错误不关/错批别的槽。
- UNKNOWN/partial writer保留占用，完整原barrier而非调用方字符串confirmed决定释放。
- 实际process/child/socket/fd/timer/waiter/queue/journal/Runner集合齐，四channel/四Work不能充四槽。

消费者/交接：原scheduler/峰值/排队/释放/receiver/全资源的同run正负与准确剩余，未接原队列就保component标签。
不要为了引helper而复制原调度器或再加一个持久ledger。

### B8 非空原状态重启与同运行重建

完整成果：重启后原问答、命令、交付和未知占用连续，允许动作来自原当前authority而非旧内存许可。

- 从原Store登记恢复endpoint/session/合同，不让新Native构造的recoveryRoot冒充旧Runner。
- ended不复活，UNKNOWN不重发，原queue继续或准确held，callback函数/旧answer map不序列化成grant。
- 原profile/policy/environment/current重验，不从历史偏好、复制凭据、read review推执行许可。
- 原receipt重放与新效果分开，资源身份变化/旧版本/缺artifact在读写前准确拒绝。
- 重开要有非空Work/question/answer/candidate/artifacts与原绑定，空库不算持久恢复。

消费者/交接：实际原状态重开、接管/拒绝、容量/资源和原数据来源的可重跑记录，source与installed分层。
原budget和用户12实例不因重建/升级测试被清理或重新授权。

### B9 完整source交接、兼容诊断与使用支持

完整成果：main/H/I/D/E能消费同一可靠运行块，用户可理解失败并通过原入口完成工作。

- 交完整必要source closure、实际consumer、接口/RPC版本与故障处理，不能单抄一文件丢配套client。
- 各旧修复保留精准scope，新反例如实阻其tier；不把源码/受控计数称native/安装/价值准入。
- 同包producer/consumer字节由D冻结、E独立验；不relable旧tar或临时外壳包含未冻能力。
- 诊断脱敏且有界，不探全局进程/socket或借其他账号凭据；未知需原reconcile而非自动重试。
- 用户主动使用与本轮自动零模型验证分开，不用外部provider连通或配置成功代替原执行权限。

消费者/交接：原产品journey、运行/恢复/持久/支持材料齐全，可由main整合，不在首次source发布后停止。
九项实际完整成果达到出口才结束whole goal，不以case数、阶段数或运行时长替代。

## 独立备选队列

- main端口与原方法已交立即消费；新接口缺口给实际可编译consumer/RFC，同时继续业务/故障/兼容。
- I/H只阻对应proof，安全未过仅阻物理动作；无信号原问答、检查/接受和持久工作持续。
- 不等待真实模型、研究budget或新协议；不跨owned自写另一实现凑绿。

## 整包完成条件

- 状态写tests/native-acceptance/reports/wave35-status.json，九成果actualsource/inner/outer/原ID、commands/exit、正负与未达齐全。
- 三包连续执行，source早交后继续后续包与独立队列；只owned显式路径推原origin，不upstream/reset/清状态。
- 保留B两旧report+b16、他人dirty与12实例5180/8796至5191/8807及所有state/profile/tar/ledger/history。
- 自动real vendor/model/native0，B UNKNOWN cap4和E原pilot BLOCKED，不reset/topup/refund/补样/价格研究。
- 禁unsafe live SIGKILL/procguard/globalps/socket discovery、substringkill、外来凭据/真实CLI回退。
- 无新Driver/CAC/桌面/自动接受/writer racing/动态DAG/第二queue或生命周期/frozenwire grant。
