# B：原始业务通道、崩溃交付与四槽连续交付

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、`codex/g1-runtime`，保留原工作树、两份历史 report diff 和未跟踪 b16。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[主线检查点 0080](../../docs/rfcs/WP-16/0080-main-observation-export-and-runtime-checkpoint.md)。
再读 [0081](../../docs/rfcs/WP-16/0081-wave-31-reviewed-architecture.md)、[0082](../../docs/rfcs/WP-16/0082-wave-31-three-release-program.md)、[实际验收](../../reports/releases/wave31-admission/runtime-channel.json)。
固定 B `fbc933166758f446ba8907ce93795d04d34d11d7`；同步最新 origin/main 后重新固定 source，不用整分支覆盖 main-owned 文件。
本包为三个连续交付包、十二个完整产品成果，是此前四成果的三倍实质工作；不是把四项拆成十二个标题。
建立或继续一个覆盖 B1–B12 的 whole-package goal，不设置 token 预算，不把发布检查点当作整包完成。
每个成果尽早提交可运行实现和消费者，提交后继续下一项；外部依赖只阻断对应项，不等待主线逐次回复。

## 归属与已验收事实

- B 管 runner-service/RunnerLink、认证传输/routes/dispatch/begin/prepared 和 physical lifecycle；排除 I 的 attach-channel src/test。
- main 管原 ProductExecution/Application/Broker 组合、root/contracts/config/lock/HTTP/UI；A 管迁移，E 管 required assertions。
- 需 main-owned 接线时交真实 caller/port 和精确最小 diff/RFC，不在自有目录复制第三 coordinator 或新生命周期。
- 实际服务 12/12、adapter/guard 8/8、direct strict 和同 blob NativeProductAttempt strict 已过。
- remote 回调旧 stdio frame0 已闭；fresh nonce、namespace/prune、显式 CAS、2KB 有效预算、五块载荷不重派旧小修。
- ordinary Completion/check/currentCandidate/显式 accept/delivered4 工件 5PASS 保留，不能当作 recovered delivery。
- 新缺口是 born 仍凭直接子进程现值和部分 argv 取得 signal authority；不可执行旧 live SIGKILL 工具。
- 主线窄合实际七文件通道及可选薄 ports/RunnerLink 两小修，不带 DriverKit review/budget/index/resource-facts 或 fixtureentry override。
- main 原 NativeProductAttempt 的 current/原 command digest/live AnswerAdmission 不变；source 合入本身不创建恢复许可。
- vendor/model/native turns0；B cap4 UNKNOWN 不可花；E 原研究预算 BLOCKED，不能 reset/topup/refund 或换实验。
- 保留十二服务 5180/8796 至5191/8807、所有 state/profile/tar/ledger/history 和 B/C/E dirty。
- 不新增 Driver/CAC/桌面/自动接受/动态 DAG/另一调度器，不扫描全局 socket、不读其他凭据。

## 交付包一：同一个原 Work 的实际三回调

### B1 独立出生 authority 与可安全运行的原恢复工具

产品成果：给后续真实故障链一套只能作用于本次精确出生资源的工具，并保住已过通道行为。
- spawner 从原 ChildProcess、原 executable/完整有序 argv/root/config/operation 捕获 immutable spawn intent。
- opaque handle/private registry 不能由 born(pid) 的 ps 快照、pgrep 直系关系或单个 node token替代。
- 完整资源集在首次与每次 TERM/KILL 前 fresh 核对；缺失、混合 UNKNOWN、身份变动保留原材料。
- 已修的 frozen record、缺 exactArgs/plan 拒绝、每 signal child-set 检查不得回退。
真实消费者：原安全工具调用者使用同一 handle，原 signalOwned/escalate 不保留 raw PID fallback。
- full own spawn positive 与无注册的第二 direct child 同时存在，后者即使 argv相似也0 signal。
- copy/retarget、少 argv、错 root/config/op、UID/start/recycled、资源遗漏都有零信号负对照。
- birth失败/ps失败/解析失败不清根、不兜底 child.kill；先全 mock spawn/ps/kill。
- pure controls 全过才允有限 own live；未完成先继续 B2 的进程内工作，不阻断整个包。
证据：交 helper/caller source、原意图与 fresh观察、spy计数、exact source/命令/exit。
- 不是将 required field 加上就完成；必须证明原始来源独立于待核对的 observed value。
- 保留 actual service12/adapter8/directstrict 的有限正回归，不重复无风险全量 soak。
- 不改 H/E 安全断言，给独立 owner 可运行复现及 source。
- 此项发布后继续 B2–B4，不能以安全修复结束包一。

### B2 原始登记与真实 attached RunningAttempt 应用入口

产品成果：原应用能为已有 Work 找到同一个登记 Runner，并调用实际业务 attach入口。
- 消费 main 新通道源码和原 A loadRecoveryRunner/immutable registration，保留 pinned dev/ino/credential/source。
- 交可被原 ProductExecution 使用的真实 RunningAttempt/caller，不只 exported wrapper 或 inspect/cancel demo。
- 原 Work/Ticket/Assignment/attempt/contract/fenceEpoch/current binding 与 host/profile/policy 全部来自原 Store。
- original begin 已记录时不得再 begin，不建新 Work/attempt/Runner/credential 充作恢复。
真实消费者：由一个实际原 Application 创建的 Work 贯穿 registration、Runner准备与 attach。
- 使用明确本机 fake 协议与真实 ProductDriver/Runner，禁止发现实际 vendor CLI 后自动 fallback。
- 正向 inspect 和原命令入口可用，原 tuple/child PID/start/session/request 连续。
- foreign/source/socket替换、valid staleepoch、contract变化/current binding ended 在写前拒绝。
- 证明拒绝发生在 guard/receiver之前，不能只展示最后 error 文本。
证据：source、真实调用链、原登记读回、receiver命令计数与原资源身份。
- main-owned 最小接线 diff 提交待集成；B-owned 可运行 caller 先发布，不能仅写 RFC 等待。
- 缺某 main入口精确指出方法/类型与原复现；同时继续 payload/fact接线独立项。
- 普通 normal5PASS 作正对照，不能替代本原登记消费者。
- 不合历史 DriverKit收费路径，不新增共享 schema/迁移/receipt ledger。
- B2 接通原 entry 后继续 B3/B4 的三回调与原问题闭环。

### B3 三个回调进入原 A Store 和原 Broker

产品成果：attached client 的 fact、payload、native intent 真正服务同一个原业务 Work。
- factSink 经原 runtime ingress/UoW 生成 durable ACK，不用空 participant、合成 seq 或 persisted:true。
- payload read 从原 immutable payload Store 返回原 ref/body/digest，不拿 requestId 当 payload内容。
- native intent 调 main/Broker 原 target/version、current command digest 和 live AnswerAdmission fresh guard。
- 每次 intent 独立审查，旧 allowed nonce、缓存布尔值、sink存在不能提供写权限。
真实消费者：同一 ProductDriver 的 policy/question/answer facts 与 payload 回调都经过实际通道。
- 在原 A public readers 核对 critical facts/dispatch/answer/delivery，不另造状态表。
- 正向实际原问题可见且答案 native_applied；payload 与原 frozen ref byte equality。
- missing/deny/throw/current变化、错 target/version/body/receipt/payload 在实际 effect之前拒绝。
- 两次合法不同 intent 观察到两次 guard，保留业务 command.id 与 fresh frame.id 的区别。
证据：同 run 原 Work/question/answer/command/attempt IDs、回执、guard/receiver/effect计数。
- readback 必须来自本 run通道写入；独立 normal fixture 的问题/答案不可拼接成原 callback证据。
- 记录 callback错误与 UNKNOWN，不把 timeout猜成未写或自动重发。
- 保留 single transport owner：remote只走 remote，sink只走 sink，stdio只走 stdio。
- 不修改原权限源或绕过 policy.prepared 等待来使 fake成功。
- B3 必须交真实应用成果，完成后继续 B4 双client同问题交接。

### B4 原问题的同 Runner 双客户端接管

产品成果：client A 离开后 client B 用原身份接手原问题并继续实际业务。
- 两 client 接同 Runner/child/session/原 AStore，channel generation 显式 CAS，业务 fence不随其变化。
- pending fact/payload 保留原 ID/ref/remaining deadline；pending native intent 保持 indeterminate不自动批准。
- 旧 client不能 poll/reply/close新owner请求；remote接管后旧stdio三个callback均0双发。
- 原 Application/QuestionBroker 回答原 question/version/native target，不创建替代问题。
真实消费者：B2/B3 的同一个实际应用入口用两个连接完成一次交接。
- 正向原 begin只1次、question原ID、answer原ID与 native_applied 或准确未知在原 Store闭合。
- 原 A使用其旧generation而非新current generation，foreign也不改变owner。
- duplicate/late reply、wrongsource/epoch/receipt、旧nonce 与关闭旧连接0越权副作用。
- 原资源、artifact workspace 和 queue归属不因换client丢失。
证据：一条完整同 run trace、两client身份/代际、原问答与原事实读回。
- H可复验本公开 consumer，I可用实际端点定位错误，不能向H提供人工拼成的结果JSON。
- 首四成果整体验收必须含 original Store/Broker三callback，不能完成B1后把B2–B4都写依赖待办。
- 可无signal进程内实现先交；safe工具未过只阻 live故障，不阻正常原authority接线。
- 发布包一 runnable checkpoint 与准确范围后立即进入包二。
- 不把 module100/normal5PASS 或 source复制当包一完成。

## 交付包二：一次原业务崩溃到人工接受

### B5 精确 own coordinator 崩溃与新进程读回

产品成果：一个原 Work 的 coordinator退出后，继任新PID读回原Store并找到原Runner。
- 仅B1独立安全证明闭合后注入精确 own SIGKILL，每次signal fresh身份与完整资源。
- 原 Runner/child/socket/journal/credential 原位存活，继任不更换session/attempt或重新begin。
- 新进程消费原 A登记/currentbinding/payload/commands/dispatch/observations，仍经原入口。
- current host/profile/policy不足时明确拒绝，读取和登记不是执行许可。
真实消费者：包一同 run实际原Work，旧coordinator与继任必须是两个真实OS PID。
- 正向外在证明旧PID退出、Runner原PID仍活、继任读取同tuple并连接。
- negative wrong/recycled PID、部分资源/UNKNOWN0signal；无登记/旧binding/foreign端点0写。
- 保存 crash前后原receipts/queue/ledger，不清理未知材料、不重新生成工作凑成功。
- 无真人/vendor/native调用，受控fake身份清楚记录。
证据：PID/start/UID/fullargv/root/config/op、原登记和新进程入口/source/exit。
- B1未过时仅实现/测纯进程内恢复caller，准确标live步骤未达并继续B6/B7独立实现。
- 不运行旧b27/b28脚本中的不安全rawkill或全局清理。
- 继任可读不是恢复可写，必须继续B6原命令/问答判断。
- 发source后连续推进，不把一次活进程演示作为recovered交付。
- 与原调度/资源owner保持唯一生命周期。

### B6 原命令 ACK 与 native_written 未知窗口恢复

产品成果：同一原问题跨崩溃正确回答，无法判定是否写入时保持未知。
- 在原 beforewrite、receiver后ACK前、ACK后receipt持久前、receipt持久后建立真实fault窗口。
- 用原 A intent/observed/delivery状态与实际receiver记录判断，不把 commands.has 当已观测结果。
- 已observed/native_applied不重发；intent_recorded不等价收到；UNKNOWN不换command ID或重试begin。
- 新client仍每次调用原Broker fresh guard，旧native intent不跨generation迁移批准。
真实消费者：B5同run原question/answer/command/attempt，非各跑一条normal再拼窗口。
- 正向明确not_seen与durable/native_applied路径能按原语义继续，原答案版本保持。
- wrongbody/旧target/session/旧epoch/晚ACK拒绝，原effect计数不增加。
- 重开后读到相同durable与unknown状态，receiver未证实的写不宣称没有发生。
- timeout/closed/stale/deny/indeterminate 保留不同结果，不能统一可重试false。
证据：原问答/UoW/receiver/ACK/receipt四方同tuple与每窗口 effect计数。
- 真实中间窗口缺埋点交B-owned最小受控hook；不可修改原业务账本伪造观察。
- H独立原Store读回和I通信拒绝要能消费本run，而非只收报告摘要。
- fault预算是本地受控运行，不消耗真实模型/原pilot。
- 同run恢复问答后继续机器验证与人工交付。
- 不添加“命令发送成功即恢复完成”的状态捷径。

### B7 同恢复 Work 的冻结候选与注册检查

产品成果：恢复后的原Work产出真实冻结artifact并经过原registered verification。
- 原 execution.completionCandidate→application.verify→ProductCompletion链继续，不另建候选表。
- 原contract/scope/basecommit/workspace与artifact清单保持，冻结manifest/digest来自实际输出。
- 原全资源barrier确认quiescent后才生成current verification/candidate，未知writer不放行。
- 原check recipe来自注册定义，不跑任意agent上报命令或信任end_turn。
真实消费者：B5/B6原IDs继续到artifact/check/currentCandidate，禁止创建普通新Work充恢复结果。
- 正向原check实际执行、artifact可读、verification与full CandidateRef同版本。
- stalecontract/scope/manifest/body/checkdef变化拒绝，failed/unknown checks不产生可接受候选。
- child仍活/部分资源未结束时currentCandidate不能绕过resource门。
- 机器检查结果与执行器自然语言总结分开，保持已有验证语义。
证据：same-run artifact hash/bytes、checkdefinition/run/exit、原候选generation/verificationref。
- normal5PASS仅作对照，报告明确是否同一恢复Work完成。
- 不拿“已freeze”替代机器检查/人工criterion，不自动接受。
- 主线组合缺口交实际caller，B不拥有新共享contracts或HTTP/UI。
- 可发布check checkpoint，但继续B8人工接受与故障/模式收尾。
- 精确留下不能完成的步骤与原数据，不换subject。

### B8 原恢复候选显式接受与模式/迟到收尾

产品成果：用户通过原应用显式接受恢复候选，交付原artifact并持久重开。
- 使用 WorkView.actions.currentCandidate 完整ref，经 Application.accept_candidate记录同候选。
- 维持machine/human criteria、current验证和resource门；controlled actor不是质量收益证明。
- 同run验证read-only/closed/ended/changedpolicy的拒绝，late ACK/late effect不改变已退役版本。
- 检查结束后process/child/socket/fd/timer/waiter/queue/journal/Runner实际状态，不把moduleclose当quiescence。
真实消费者：原主应用commands/readports，artifact下载与location读回仍指向原Work。
- 正向显式接受recorded→delivered、同4或实际数量artifact可读、重开结果一致。
- staleCandidate/verification/contract、未人审、unknown资源或readonly模式均不接受。
- 接受前候选ready与人工动作时间按原outcome口径记录，不编造人工审阅耗时。
- 只清精确已确认结束的本probe资源，UNKNOWN保留并影响结论。
证据：same Work→question→answer→check→candidate→accept→artifacts与资源全链。
- 包二完整成功才称原业务recovered delivery；普通交付/source/mock不是同义。
- 更新操作/故障文档与source，准确native/installed未测范围。
- 包二发布后继续原调度2/4槽，不等待下一次派工。
- 原A/Broker/Completion仍唯一authority，不新autoresume gate或ledger。
- 无SIGKILL准入则保留该项未达，继续包三可无signal的调度工作。

## 交付包三：原调度器多槽、取消与重开

### B9 原调度器两个混合槽真实前进

产品成果：原scheduler两槽可以并行正常/待答/交接工作，队列真实等待并前进。
- 使用原Application/Execution/queue/binding，两个实际attempt而非两个Work列表行。
- 一槽待答一槽执行/恢复，per-slot source/credential/generation/cursor/payload/receipts隔离。
- 第三项按原容量等待/拒绝；slot何时释放由原barrier与持久binding决定。
- 不改最大槽契约、不建另一个调度器或手动写DB释放。
真实消费者：主应用创建/查询/答复，actualB/I原Runner执行，H可外在复读。
- 正向两slot实际运行，第一正确结束后原queued项由原queue推进。
- wrongslot/foreigncredential/错payload/lateintent不能跨槽批准或影响另一项。
- UNKNOWN writer保留容量，不能按phase delivered或单PID absence释放。
- 回调背压与控制优先级可观察，不能用延长timeout掩盖队列阻塞。
证据：原attempt槽时间线、queue due、bindings/resources、receiver与guard分槽计数。
- 单槽原纵链未过不宣称两槽恢复，仍可独立完成正常与waiting调度消费者。
- 保留主线已测普通queue行为，不重写原application lifecycle。
- 输出有限运行与可重复步骤，不以长soak凑任务时长。
- B9交后继续B10四槽实际aggregate。
- 不引入第二协议/native模型来增加矩阵数量。

### B10 四槽容量与完整 aggregate 资源归还

产品成果：四个实际槽混合状态下容量、控制与最终归还均有原始事实支持。
- 四槽包括normal/waiting/交接/未知或cancel，至少第五项真实等待/拒绝。
- 汇总完整process/child/socket/fd/timer/waiter/queue/journal/Runner，不只一个writer PID。
- 原屏障每slot及aggregate均fresh，partial/UNKNOWN不能被已结束其他槽覆盖。
- slot归还驱动原持久queue继续，不直接设置ended/accepted或插假receipt。
真实消费者：B9原应用consumer扩展实际四槽，source与原运行身份都可追溯。
- 正向峰值4、第五项等待，已证结束slot释放后第五项真实开始。
- 超容量、跨槽凭据、晚回复、resource遗漏与UNKNOWN保留有明确负对照。
- 一个槽取消/失败时其余槽正常进展，不会被global close/旧client误关。
- 所有计数取原binding/queue/实际进程观察，非调用方数组长度。
证据：开始/峰值/结束完整资源、slots/queue、原ID/attempt映射和出口状态。
- 四Work不等于四Runner，报告注明真实创建与running数。
- H synthetic resource ledger只作逻辑测试，必须补actual resources才报产品矩阵。
- scope限定本机受控源，不称长期稳定/native兼容。
- 发布source继续B11控制故障与B12重开交接。
- 不清全局端口或用户现有实例来腾资源。

### B11 取消、控制中故障与未知资源保留

产品成果：原业务取消真实停止本attempt资源，控制半途失败不会错误释放槽。
- 原cancel→authenticated recovery control→stopPhysical→完整resource barrier保持唯一路径。
- 覆盖cancel前/中/后client断开、重复控制、部分child退出与晚ACK。
- sent:true只代表命令准入，fresh proof才可判断quiescence；不新增第二stop机制。
- 观察失效/身份变动/未知资源保留原material与占用，终态/CLI exit准确一致。
真实消费者：四槽run中挑原slot做控制，其他槽receiver与queue状态持续观察。
- 正向精确原资源关闭、barrier确认、binding ended与原slot释放一致。
- missing/foreign registration、socket replacement、stale command和UNKNOWN控制拒绝/保留。
- 重复控制不重复native answer/begin、不清其他槽资源、不吞不确定异常。
- 清理每次signal都遵循B1；可用原协议正常关闭时仍记录实际退出而非推断。
证据：original command/proof/资源结束与原queue进度、未知留存路径。
- H独立观察不是新的release authority；B不改E gates使测试通过。
- pure故障可先完成，live依赖安全准入不反向阻塞其他业务接线。
- 保留旧normal stop已过范围，不重复称当前产品没有stop。
- source交后继续重开/同tarline支持。
- 不把kill发送成功记录成物理停止成功。

### B12 原状态重开与当前发行线交接

产品成果：同事可按清晰步骤重开原多槽/交付状态，发行owner有完整必要源和消费者。
- 原AStore reopen后Work/question/answer/commands/candidate/artifact/binding/queue一致。
- 已ended不复活、UNKNOWN不重发、原accepted/delivered仍可读；不借恢复read权获得execute权。
- 给D/E当前same-tarline的实际必要runtime闭包与操作输入，不用sourcecheckout补包内缺失入口。
- runtime字节改变由D freeze、E exactartifact复验；docs-only不伪造新refreeze要求。
真实消费者：原正常/恢复/多槽run的同一state重开，按原公开读口复验。
- 正向原artifact与完整候选来源可读，已准入操作保留，原queue继续或准确held。
- wrongroot/oldsource/missingartifact/readonly/invalidreview不会执行、补造或跨root读内容。
- 操作文档分别说明normal/module/controlled recovered/native/installed已测与未测。
- 最终source/status清楚记录十二成果、未达、依赖owner和原证据，不按测试数抬完成度。
证据：runnable消费者、exactcommit/blob/命令exit、原run/IDs/资源、必要文件清单。
- 更新 `tests/native-acceptance/reports/wave31-status.json`，保留旧报告和所有ledger。
- own显式paths推origin原分支，不pushupstream/reset/覆盖dirty。
- main原契约/组合变动通过最小可评审diff交接，不能整合收费研究模块。
- 最后提交仍未闭合事项，goal只有整包真达成才complete。
- 本包不等于vendor/native/release/价值实验获准。

## 独立备选队列

- main接线未到，交已能运行的原A/Broker consumer和最小caller，再做本owner回调/故障/多槽实现；不是只写计划。
- I输入阻塞只影响对应communication case，继续原normal/ACK/store/资源/重开工作，不跨I owned源自行再写一份。
- H输入未到可交公开consumer/原run材料，继续自身实现；不替H/E编独立结论。
- signal安全未过，禁止live故障，但继续进程内三callback、原问题、机器检查/人工接受及无signal容量验证。

## 整包完成条件

- 每个成果必须含实现、实际consumer、合法positive、独立negative及准确source/exit；模块双桩不替原authority。
- 十二成果和三个runnablecheckpoint连续完成才结束；checkpoint发布后继续独立队列，不能等待下一轮派工。
- preserved old scope不能改label；B原budget UNKNOWN/E原study BLOCKED不变，模型/vendor/native0。
- 不制造新table/ledger/coordinator/Driver/CAC/自动接受或新用户授权，原十二服务不重启。
- 报告里保留 `NOT_REACHED` 的具体原IDs/consumer缺口，不能用测试数、运行时长或新stage数抵扣。
- 遇到main-owned变更交完整必要闭包，不单独抄一文件丢依赖；保留可复验正负和原安全边界。
