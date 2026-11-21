# 里程碑03：日常可用版交付

2026-11-19，用户已接受本目标及最多4次真实Codex任务。启动时0/6验收、0/4实际turn；起点main 6c6f7f6035cd986c7980d02fd6c8beb90b74b6a4。Recovery01/原生控制02已关闭。本文是唯一开工说明，完成时一份汇总，不生成新wave、逐轮验收JSON或十路任务包。

## 唯一出口与六项验收

用户在正常启动的工作台完成真实开发，再把同一版本安装包交给M系列Mac同事使用。仍在完整方案B工程内实现，不另造临时产品。源码、正常入口、冻结安装包、运行实例分别核对，旧包和十二旧实例不会自动升级。

1. 正常首次启动完成私有模型配置和Codex安装/版本/认证就绪检查；“保存配置”与“实际连接已验证”分开。缺执行器可讨论/审阅、明确禁用开发，不回退fixture。凭据不进Git、浏览器持久存储或安装包。
2. 在工作台导入两个不同的真实Git项目，分别完成一次缺陷修复、小功能。核对各自原project/Work/检查/候选，不用同fixture两个Work替代。先用已支持、已有检查且依赖就绪的Node/npm/pnpm项目；可用真实项目的备份副本，保留真实代码/检查并说明范围，不声称修改了原工作树。
3. 正常工作台展示真实进度，原问题中心可回答，同一Work可补充要求、显式停止。审批/澄清的实际触发条件及plan模式限制明确；没实际触发就不声称该次已测。保留原target/question/command和物理资源屏障，不用探针coordinator、私有注入或脚本直调业务API替代正常用户入口。
4. 原机器检查通过后查看完整patch/检查输出，明确接受当前候选；将patch应用到该项目基线的独立验证副本并跑原检查。接受不自动merge/push/覆盖用户原工作树，机器FAIL不能人工绕过。
5. 正常停止/重开本期自己的实例后，两个原项目、原Work、消息、候选/产物及接受记录可查看。不新做SIGKILL或故障窗口研究。
6. E用同一冻结源码产出的darwin-arm64包，在新安装目录/私有根/端口通过包内入口完成上述流程，不依赖开发checkout或未声明的全局Node/pnpm。用户自行安装的Codex及其自身认证是明确前置。若只在同机独立安装，跨机保持NOT_TESTED，不能声称第二台Mac已验。

只修阻断该路径的问题，其余进backlog；独立安装可用不等完整Beta/长稳/全版本覆盖。结束按原十二项重计分，不预加分。CAC、新Driver、桌面壳、自动接受、研究试点/路由收益、动态团队不在本期。

## 连续责任、冻结与预算

- main：唯一端到端负责人，修正常启动/配置/HTTP/Application/问题/App/集成的具体阻断；先交可用源码入口，再闭合同包使用。根lock/共享契约/共享文档仍main管理。
- D：主动，原 /Users/hh/Desktop/joker/superagent-agent-d、codex/g3-local-distribution；只原 apps/launcher/、tools/distribution/、packages/portability/。先准备正常启动与发行链，必要源修改早交main采用；待main明确发布源码commit后冻结一个候选并交E，持续修当前包阻断。不把自己分支未合main的代码悄悄装包。
- E：主动，原 /Users/hh/Desktop/joker/superagent-agent-e、codex/g3-product-acceptance；只 tests/product-acceptance/，独立断言。先零模型准备旅程/必要负例，D冻结后最终验同一包，不追移动HEAD、不复用旧PASS。缺生产行为给main最小复现，不代改别人的模块。
- B/F仅在main提供具体当前路径阻断后参与，原所有权保留；A/C/G/H/I/J待命。不为用满人数加维护线。本文尚未代发外部chat。
- D冻结前main采用必要源修改并验证；D以main明确commit构建，E记录准确source/build/包SHA。E若发现运行代码阻断，先修并由main明确必要后继/重测范围；docs/tests-only不自动重包。
- 本期真实Codex合计最多4次，以实际写出turn/start计。原预留main1/E3；11-20 main将保留1次转E，总额仍4；11-21验收确认E已实际发送4/4，main/D/E现均无剩余额度。最后控制任务未通过，不能重试、补样或自动加额。不必用满，额度不自动互借。UNKNOWN发送仍占用且不得重发；setup失败且确认未写turn不计。
- 实际发送前记录角色、候选及余额，发送后追加一次记录，仅放本期独立私有根；不改旧grant/ledger或新增产品调度账本。既有透明计数工具只能计数，不能替代正常入口；未准入工具不引入。普通主对话网关验证不在4次Codex额度内，本期不自动发送额外模型请求。
- 不自动批量跑live脚本；预算0角色不运行check:native-*等发模型命令。UNKNOWN业务效果先核对原身份，不用新ID/新begin补洞。受控/静态检查不花模型额度。
- 保留十二用户实例UI5180–5191/API8796–8807及state/profile/history/tar/dirty。仅操作本期自己启动且有完整原spawn身份的服务，不做全局进程发现、额外故障信号/强杀、状态清空、借凭据或接管未知进程。正常产品停止仍经过原屏障。
- 各自先看branch/status，保留dirty，安全fetch/merge origin/main；禁止reset/clean/force/盲目stash，不改他人树。只显式提交owned路径，外部agent推自己的origin分支，main才推HEAD:main。
- 交接只需source commit、真实入口/命令exit、包身份（适用时）、原ID/证据位置、未测范围和下一消费者。检查点三行：清单x/6、剩余、用户决定。SOURCE_READY后继续同结果联调/修复/复验，无阻断则待命，不扩独立队列。

## 主线源码交接（此前检查点）

- main明确指定D可冻结的源码为 83f79e8249efd68f429f2b6828ea233278071737。只以这份源码构建当前候选，不追之后仅docs/tests的提交；若D发现必须改运行代码的实际阻断，先交main采用，再明确必要后继，不能夹带分支额外代码。
- 这份源码增加本机Codex登录检查/未登录指引，个人模式不再提供固定scratch执行器/检查，新实例只明确导入用户项目，不自动写共享starter仓库。旧已登记项目及用户十二实例不操作。
- 241契约用例、17项原链/容量/新准入回归、11项实际启动进程回归通过；product/console严格类型检查、生成物一致性和链接检查通过，Runner wire hash仍为74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d。
- 正常React/HTTP首次启动、未登录提示、明确项目导入、正常重开4场景通过，截图 /tmp/pa-ms03-startup-ui-wCUJHB；CLI使用私有替身，仅证明source UI，不计真实项目交付或安装准入。
- 实际安装的Codex通过正常tools/dev/start.mjs启动检查：独立state /tmp/pa-ms03-normal-source-fnqlyj/state、UI61314/API61315，个人模式/原生准入、0个Work；正常stop后自身实例已退出。只做version/login status检查，实际turn/start为0，私有日志/状态保留；未启动探针coordinator或任务。
- 最终清单仍0/6，真实任务0/4；D接上述source冻结候选，E先零模型准备，再用准确包完成独立旅程。此处不是完成汇总或发行许可。

## 当前验收：4/6，真实额度4/4已用尽

2026-11-21复验E最新8776934164812e0a698f4888501a5ea39ea427fa；D仍e247e7b782ec12a01de8685eb1199683f47afce2。仍是同一里程碑，①②④⑤按限定范围闭合，③和⑥仍PARTIAL；不得写6/6或完整日常使用验收通过。82/100、完整B63.1%暂保留，最终按原十二项重评，不因本轮测试数量加分。

### 已通过的实际结果，保持不重跑

- 准确包source83f79e8249efd68f429f2b6828ea233278071737/buildd3ba0ec6dccc5eac，内外摘要与完整静态清单已由main独立核过。E准确包正常首次启动/私有GUI配置/原生版本认证就绪成立；模型保存不等连接已验证，没有新增真实主对话网关请求。
- 两Work a68880e9f1a46085f044fad0c74ff191和749f5756c3dd284886dd008de2341a18的原project/合同/attempt/currentCandidate/注册检查PASS/人工接受/completed/ended绑定，main已只读核对；全部52个原artifact摘要通过。按各冻结manifest导出自有副本，反向patch恢复基线、重应用原patch和原Node检查：修复FAIL→6PASS，功能原PASS→8PASS。副本在 /Users/hh/Desktop/joker/pa-artifacts/m03-main-check-j3po97z1。限定范围是两个真实仓库的零依赖token-engine子包备份，修复为人为注入回归，不是两个完整业务工程已广泛可用。
- E原同包正常stop/start后两个原Work/候选/产物/接受记录UI证据保持；main原Store核到原对象和产物。原E的/tmp目录在main侧不可见，产品私有Store/Runner journals/冻结内容仍可读，持久证据不能依赖临时根永久存在。
- 旧“预留被计消费”和.git指针复制问题已修；非零检查已有实际消费者，不再派这三个旧修复。最新cancel后同ID再reserve→sent正确，correctUnsent自由撤销已禁用，UNKNOWN调和不减少消费，main自有synthetic复验通过。

### 最后真实控制任务的独立结论

原Work6dd113a40e7656be47c023494c61c3e7/ticketa7c31233b1859ba7515169eab72e6275/attempt-b5f967fe-022d-45ad-b838-70dc20e87a6b。原Store只读确认11-20北京时间16:41:12.531原begin获native_accepted，16:46:39.983原turn.ended completed，16:46:40 writer.observed；16:56:38.159才原Work stopped，绑定ended。原user_questions0、deliver/steer回执0。只成立自然终态后的业务停止，不是运行中停止；问题回答和补充仍未测通过。

E如实提交result.ok=false，原未知发送后通过原事实核对为sent，没有重新begin。原Store全批恰有4个原生native_accepted/对应begin；v2环境准备阻断无原生发送，继续单列。当前预算4/4已用尽，main/D/E均0；旧研究grant仍不可用，不允许补样凑PASS。

持久E证据：/Users/hh/Desktop/joker/pa-artifacts/m03-e-live/control-send.jsonl 与 evidence/m03-control.json。E树中的 tests/product-acceptance/evidence/m03-control.json为本次失败记录；旧m03-final.json是之前双项目快照，不把其中旧3/3、⑥PASS或“3次=一次未发送+两交付”的表述当当前结论。历史快照保留并由最终汇总纠正。

### 只修直接阻断当前控制消费者的问题

1. main用最新代码原片段加synthetic参数直接执行，确认读取runningBinding在其const初始化之前，必抛ReferenceError。node --check虽过，不能替代该分支运行。本次live未达到此分支，不把它谎称为已证明的本次唯一失败原因。
2. main当前只读核到ticketFor使用的JSON路径能命中原ticket，无法证明E所写“错误JSON路径”就是live失败根因。要沿实际原数据重现观察误差，保留已观察的事实：原turn真实运行约5分钟，消费者在其间误报未观察到开始。不能仅凭core assignment.state=running认定物理turn仍运行，terminal后core也可能仍等待人工处理。
3. m03-control的processTree实际调用ps -axo全局枚举，违反现行边界；其“没有新增PID”不作为完整资源/物理静止证明。本次未采信这部分，不宣称它结束或清理了用户资源。当前消费者改用原登记固定资源及对应新鲜身份/原屏障；缺失、查询错误/超时一律UNKNOWN，不把[]当空闲，不发额外信号或做全局补查。
4. 问题未出现时，不应该让等待问题的消费者阻止其余可观察控制；受控验证需分别记录问题、原答复、同turn补充、运行停止/屏障，每项独立判定。未知发送不重试，终态后stop不能补作runningStop；组件/受控正例不冒充这次真实失败已修复通过。

这是一份同结果消费者修复责任，不是维护队列。预算耗尽后当前仅做零模型静态、纯/受控执行及原证据核对，不重新运行live脚本，不重建真实Work，不改变生产配置来制造问题。没有具体生产阻断不修改main源码，不为docs/tests重包。等这条零模型链完成，才有可审核的后续真实复验建议；不自动进入下一里程碑。

固定包继续不变：outer /Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec/PersonalAgent-Preview-d3ba0ec.zip，63575237B，SHA163b32170680bcbdb324a4fd8edc631bdfb685633911a787c3b3de353577075b；inner /Users/hh/Desktop/joker/pa-artifacts/m03-target/m03-target-d3ba0ec.tar.gz，20631227B，SHA52eee9083b4d2256a58189327c93605c157e38f5cd44894482a82c6198f56123。

## 最新准入：主线已补实际源码工作台消费者

2026-11-21收到E的3e55b482/e4dcb9b4。删除全局进程枚举、live --run固定exit2和原生/受控范围分开保留有效；但新增controlled链只运行evaluateControl并自行给state.answers、steers、barrier赋成功值。boundCommandPlan输出也未经过原Application/QuestionBroker/Driver或浏览器执行。main复现其PASS样本的target不符合原NativeQuestionBindingSchema、steer计划不符合原UserCommandSchema，因此仅作为内存纯函数样例，不是已完成原产品控制消费者，不升里程碑分数。所谓历史错误JSON路径还缺当次实际消费源码摘要，两个不同路径在当前Store命中数不同并不足以证明当次使用了哪份源码。

为直接推动同一结果，main已在57243a54fc1c5d6b1292b385d454081a93953521提供 tests/integration/original-control-browser.mjs，复用原 tests/integration/fixtures/native-callback-link.ts 的已有可信注入边界；不是新宿主、调度器或LLM循环。浏览器实际打开原App，通过原HTTP发送已由UserCommandSchema解析的创建/答案/锚定chat/stop命令，原Store/Application/QuestionBroker、生产CodexProductDriver、原Runner登记/回调/资源屏障真实消费。仅协议对端和资源由原受控ProcessHost替身提供，不启动Codex、vendor或模型，不声明物理进程/安装同包/native已验。

四个实际消费者场景通过：①原问题真实选项→同target回答native_applied→同thread/turn steer→运行中原stop与原屏障→ended；②没有问题仍能同Work steer/stop；③答案Store已写后丢HTTP响应，刷新只读核对，无第二次answer或原生写；④资源UNKNOWN不归还/不记屏障，保留原binding与材料。所有场景都由浏览器操作生产入口，原begin各1、同attempt、原标准wire请求ID为integer/decimal42。没有在测试中给Store填造答案/接受/屏障PASS。

实际命令：node tests/integration/original-control-browser.mjs /Users/hh/Desktop/joker/pa-artifacts，exit0，四场景；持久材料 /Users/hh/Desktop/joker/pa-artifacts/pa-control-app-tWp1ft（每场景原SQLite/Runner材料/运行截图均保留）。原callback/拒绝和2/4组合恢复回归4PASS，coordinator product严格检查通过。源码/测试改动不改变已冻结包，D不重包。真实4/4仍耗尽、里程碑仍4/6，E接这个可运行消费者做独立原身份/副作用/拒绝断言后，才有下一次真实同包复验的就绪依据；当前不自动发送或申请补额。

## 发给Agent D（整段复制）

~~~text
继续保持83f79e82/buildd3ba0ec6dccc5eac准确包和SHA，零模型待命，不重包。main新增的是零模型测试消费者57243a54，不是运行代码后继；不需要为docs/tests冻结新包。只有E当前路径暴露具体安装阻断才参与，别另开升级/签名/多平台维护。预算仍4/4耗尽，main/D/E均0，十二实例和原状态保留。
~~~

## 发给Agent E（整段复制）

~~~text
继续同一里程碑03的一个完整零模型消费者收尾，不开新wave、不发真实任务。安全合入最新origin/main并读 docs/product/MILESTONE-03.zh-CN.md 最新准入。main已验你e4dcb9b4：删除全局枚举、live拒绝和真实失败保持有效；但runControlledChain只给内存answers/steers/barrier赋值，没有执行原产品；boundCommandPlan里的target/steer也不符合原wire/UserCommand，故纯函数PASS不能作原产品控制链消费者。
主线已直接补好可执行输入：source57243a54，tests/integration/original-control-browser.mjs，命令 node tests/integration/original-control-browser.mjs <你新建的私有证据父目录>。它实际开原App/HTTP/Store/Application/QuestionBroker，走生产Driver和原Runner回调/屏障，仅协议peer与资源为受控替身，不发模型。四场景已过：问题回答→同turn steer→运行停止；无问题仍steer/stop；答案响应丢失不重发；UNKNOWN保留占用。原Callback/拒绝/2&4恢复回归保持。
不要再扩evaluateControl和自填PASS样例。你持续负责独立复验这个现成真实消费者：在原tests/product-acceptance/加一个聚焦零模型入口，消费主线已有真实组件/消费者及其原Store/HTTP产物，用你独立的断言核work/project/contract/ticket/assignment/attempt和原question/target/command全身份、一个begin、一个答案原生效果、真实deliver/native_accepted、stop请求在原资源停止前、原屏障后ended；缺观察/错身份/UNKNOWN仍拒绝。不能只读取主线打印PASS或借其summary作为独立oracle，不向原Store写假答案/屏障，不造第二生命周期。可复用主线fixture和正常UI路径，无需从头写Runner或另一套浏览器框架。
独立核对丢HTTP响应后的原answer表/回执/原native effect未重放，UNKNOWN场景原binding及材料保留、无barrier；四个fresh测试Store须放你自己新建持久目录，不碰之前真实Store/十二实例。补你发现的当前消费者问题，持续到一个实际独立入口exit0，不在加schema/记录或SOURCE_READY结束；若生产缺口只交main最小复现。
4/4真实额度已用尽，--run继续拒绝，不能跑旧live/continue/begin或恢复旧grant。原83f79包不变、原真实控制FAIL与本期4/6保持，受控通过不替代live；不要再改写为完整同包通过或拿合成ID绑定当原请求证明。最后只交一个源闭包、可运行命令exit、独立原ID/持久证据和准确限制汇总；不生成逐轮报告集，也不增加维护队列。等这一就绪依据验收后再由用户决定真实复验，不自动补额。
~~~
