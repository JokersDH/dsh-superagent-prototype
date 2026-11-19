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
- 本期真实Codex合计最多4次，以实际写出turn/start计。预留main最多1次源码排障/验证，E最多3次：两个项目正常交付，必要时第三次运行控制/停止。不必用满，D0；额度不自动互借，main可在总上限内先记录重新分配。UNKNOWN发送仍占用且不得重发；setup失败且确认未写turn不计。
- 实际发送前记录角色、候选及余额，发送后追加一次记录，仅放本期独立私有根；不改旧grant/ledger或新增产品调度账本。既有透明计数工具只能计数，不能替代正常入口；未准入工具不引入。普通主对话网关验证不在4次Codex额度内，本期不自动发送额外模型请求。
- 不自动批量跑live脚本；预算0角色不运行check:native-*等发模型命令。UNKNOWN业务效果先核对原身份，不用新ID/新begin补洞。受控/静态检查不花模型额度。
- 保留十二用户实例UI5180–5191/API8796–8807及state/profile/history/tar/dirty。仅操作本期自己启动且有完整原spawn身份的服务，不做全局进程发现、额外故障信号/强杀、状态清空、借凭据或接管未知进程。正常产品停止仍经过原屏障。
- 各自先看branch/status，保留dirty，安全fetch/merge origin/main；禁止reset/clean/force/盲目stash，不改他人树。只显式提交owned路径，外部agent推自己的origin分支，main才推HEAD:main。
- 交接只需source commit、真实入口/命令exit、包身份（适用时）、原ID/证据位置、未测范围和下一消费者。检查点三行：清单x/6、剩余、用户决定。SOURCE_READY后继续同结果联调/修复/复验，无阻断则待命，不扩独立队列。

## 当前交接点

- main明确指定D可冻结的源码为 83f79e8249efd68f429f2b6828ea233278071737。只以这份源码构建当前候选，不追之后仅docs/tests的提交；若D发现必须改运行代码的实际阻断，先交main采用，再明确必要后继，不能夹带分支额外代码。
- 这份源码增加本机Codex登录检查/未登录指引，个人模式不再提供固定scratch执行器/检查，新实例只明确导入用户项目，不自动写共享starter仓库。旧已登记项目及用户十二实例不操作。
- 241契约用例、17项原链/容量/新准入回归、11项实际启动进程回归通过；product/console严格类型检查、生成物一致性和链接检查通过，Runner wire hash仍为74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d。
- 正常React/HTTP首次启动、未登录提示、明确项目导入、正常重开4场景通过，截图 /tmp/pa-ms03-startup-ui-wCUJHB；CLI使用私有替身，仅证明source UI，不计真实项目交付或安装准入。
- 实际安装的Codex通过正常tools/dev/start.mjs启动检查：独立state /tmp/pa-ms03-normal-source-fnqlyj/state、UI61314/API61315，个人模式/原生准入、0个Work；正常stop后自身实例已退出。只做version/login status检查，实际turn/start为0，私有日志/状态保留；未启动探针coordinator或任务。
- 最终清单仍0/6，真实任务0/4；D接上述source冻结候选，E先零模型准备，再用准确包完成独立旅程。此处不是完成汇总或发行许可。

## 发给Agent D（整段复制）

~~~text
启动里程碑03“日常可用版交付”，用户已接受；不是继续旧wave或恢复里程碑。继续 /Users/hh/Desktop/joker/superagent-agent-d，分支 codex/g3-local-distribution。先检查branch/status、保留dirty，再安全fetch/merge最新origin/main；读AGENTS.md、START-HERE.zh-CN.md、product-spec/README.md及 docs/product/MILESTONE-03.zh-CN.md，以该文件为当前范围。
你持续负责一个完整结果：把main最新已集成的产品做成正常可启动、配置、重开的M系列Mac安装包，并与E闭合同包验收。只改原apps/launcher/、tools/distribution/、packages/portability/。先零模型检查/修复首次启动、私有根/端口、配置入口、运行依赖、离开开发仓后的启动；不能靠fixture/probe coordinator。
起点6c6f7f60已完成真实恢复/原生控制。必要source早交main采用，等main明确可冻结commit再产一个固定候选；交准确source/build/包路径与SHA、平台/运行依赖及外部Codex前置给E。当前包出现阻断持续修到main采用、E同包复验，不在SOURCE_READY结束，不追移动HEAD反复重包；docs/tests-only不重包。
你的真实模型预算0，不发Codex turn或额外故障信号，不跑会发模型的native脚本。不碰十二旧实例/state/包/历史，不借凭据、不清UNKNOWN材料。只显式提交owned路径、推原origin分支，不改根lock/共享文档/他人树。
交接只保留最小source/实际命令exit/包身份/证据位置/未测范围，不造新验收JSON/维护队列。检查点三行：清单x/6、剩余、用户决定。没有第二台Mac实证时跨机保持NOT_TESTED，不称完整Beta。持续做到同一包可被用户和E实际使用。
~~~

## 发给Agent E（整段复制）

~~~text
启动里程碑03“日常可用版交付”，用户已接受；不是继续旧wave或恢复里程碑。继续 /Users/hh/Desktop/joker/superagent-agent-e，分支 codex/g3-product-acceptance。先检查branch/status、保留dirty，再安全fetch/merge最新origin/main；读AGENTS.md、START-HERE.zh-CN.md、product-spec/README.md及 docs/product/MILESTONE-03.zh-CN.md，只验该文件六项。
你持续负责正常使用同一个安装包的独立最终验收，仅改tests/product-acceptance/。现在先零模型准备真实UI旅程、原ID断言和必要拒绝用例，不开研究/长稳/历史oracle维护。D交main明确冻结source的准确包后，用包内入口在新私有根/端口，从配置就绪、两个真实项目的修复和小功能、原问题/补充/停止、检查/patch/明确接受/应用验证、正常重开做到交付。核对两个项目各自原project/Work/候选/产物，不用同fixture两个Work代替，不用探针API替代正常UI。
本期全员真实Codex上限4次：你最多3次，main另预留1次，D0。两次用于两个项目交付，必要时第三次运行控制/停止，不必用满；只在冻结包、前置及实际发送计数就绪后发，按turn/start计，不自动批量live。setup确认未发不计；UNKNOWN业务发送占用并先核对，不能新ID重发。没有额外主对话网关预算，不挪旧grant/研究ledger。需要调整分配交main在总额内统一记录。
生产缺口交main/D最小复现，不削弱断言、不代改他人源码；必要后继由main明确source/subject后接续重测，不跟移动HEAD、不继承旧PASS。不依赖开发checkout；只有同机独立安装时跨机NOT_TESTED，不声称完整Beta。
保留十二旧实例及旧state/包/历史/dirty，不借凭据、不额外SIGKILL/故障信号、不全局进程发现或清理UNKNOWN。只显式提交owned路径、推原origin分支。检查点三行：清单x/6、剩余、用户决定；不造逐轮JSON/新派工队列，最终一份有原ID/证据位置的独立结论。交source后持续同结果联调及最终复验。
~~~
