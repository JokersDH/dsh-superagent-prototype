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

## 主线源码交接（此前检查点）

- main明确指定D可冻结的源码为 83f79e8249efd68f429f2b6828ea233278071737。只以这份源码构建当前候选，不追之后仅docs/tests的提交；若D发现必须改运行代码的实际阻断，先交main采用，再明确必要后继，不能夹带分支额外代码。
- 这份源码增加本机Codex登录检查/未登录指引，个人模式不再提供固定scratch执行器/检查，新实例只明确导入用户项目，不自动写共享starter仓库。旧已登记项目及用户十二实例不操作。
- 241契约用例、17项原链/容量/新准入回归、11项实际启动进程回归通过；product/console严格类型检查、生成物一致性和链接检查通过，Runner wire hash仍为74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d。
- 正常React/HTTP首次启动、未登录提示、明确项目导入、正常重开4场景通过，截图 /tmp/pa-ms03-startup-ui-wCUJHB；CLI使用私有替身，仅证明source UI，不计真实项目交付或安装准入。
- 实际安装的Codex通过正常tools/dev/start.mjs启动检查：独立state /tmp/pa-ms03-normal-source-fnqlyj/state、UI61314/API61315，个人模式/原生准入、0个Work；正常stop后自身实例已退出。只做version/login status检查，实际turn/start为0，私有日志/状态保留；未启动探针coordinator或任务。
- 最终清单仍0/6，真实任务0/4；D接上述source冻结候选，E先零模型准备，再用准确包完成独立旅程。此处不是完成汇总或发行许可。

## 本次验收及继续任务

2026-11-20复核：用户确认仍是原D/E目录。main核对原工作树（均无dirty）、reflog、origin分支及owned文件时间后，最新仍分别e247e7b7、cd9e473a，E尚未合入98dc3298的修复指令，没有更新后的实际consumer或真实旅程证据。不能将同一提交再次算为新完成，也不要求D重复已通过的打包工作。

main另从准确outer ZIP全新解压，以包内Start.command/Node、全新HOME/CODEX_HOME和一致私有根，实际验证正常首次启动、开发禁用且无fixture、GUI保存配置（不回显/不进浏览器存储/不发模型）、0个Work和原Stop.command正常停止。证据 /tmp/pa-main-m03-installed-bUaljs，source83f79e82/buildd3ba0ec6dccc5eac；只用无效演示连接、新建私有状态，未借凭据/触碰十二实例，新增模型/native发送0。此为main集成证据，不替代E双项目/控制/重开的独立结论；无需重包，原六项仍待最终闭合。

D交付e247e7b782ec12a01de8685eb1199683f47afce2；E交付cd9e473a86655959ac803c6701369208045caa99。D已完成固定包，E只完成零模型准备，其四项真实旅程仍NOT_TESTED，没有本期独立最终安装结论。继续原六项，不开里程碑04或新wave，不因源码/静态检查加分。

固定source 83f79e8249efd68f429f2b6828ea233278071737，build d3ba0ec6dccc5eac：

- Outer：/Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec/PersonalAgent-Preview-d3ba0ec.zip，63575237B，SHA256 163b32170680bcbdb324a4fd8edc631bdfb685633911a787c3b3de353577075b。
- Inner：/Users/hh/Desktop/joker/pa-artifacts/m03-target/m03-target-d3ba0ec.tar.gz，20631227B，SHA256 52eee9083b4d2256a58189327c93605c157e38f5cd44894482a82c6198f56123。
- main独立按实际ZIP字节复验CRC/路径、全部6866个inner文件摘要/23个内部link、6874个outer文件摘要、369个原始源码文件对冻结git83的字节，全部通过。未执行包代码/模型/信号，静态通过不代替安装旅程；原包保持，不为本次docs提交重包。
- E准备源仅语法检查通过，不准入真实使用。main在自己新建临时材料中复现：①reserve后没有任何实际发送，used却从0变1；②两个拟用项目spec-tools/accept-tools的node --test均exit0但tests0；③linked Git worktree复制后保留原.git指针，applyPatchToCopy失败且原baseline index摘要变化。复现分别在 /tmp/pa-ms03-e-admission-CInVo8、/tmp/pa-ms03-e-project-repro-92Mx5J、/tmp/pa-ms03-e-linked-copy-O0aqQR；只有这些新建自有临时仓库被操作，未改E树或用户项目。
- E还需对当前消费入口做最小调整：从默认W36切到上述外部固定身份，不允许只把cohort名字改成m03-frozen；全新83实例允许native已准入但needs_project，先明确导入，不能要求自动starter。普通入口须使用本包Node/launcher及一致私有roots，不能把inner bin加全局process.execPath当外壳安装证明。不运行整套历史e4队列。
- 最终清单仍0/6；本次main真实发送0。总上限仍4（main预留1、E最多3、D0），不是新一轮补额；开跑前核对原私有实际发送记录。预留只是防并发，不能作为计费消耗；明确未发送的setup失败可修复后重跑，UNKNOWN业务发送先核对且不能重发。

## 发给Agent D（整段复制）

~~~text
继续里程碑03原任务，不开新wave。你本次e247e7b7交付的83f79e82/build d3ba0ec6dccc5eac包已由main独立核对内外SHA、完整文件清单与369个原始源码文件，静态通过；E还未完成真实同包旅程。
沿用 /Users/hh/Desktop/joker/superagent-agent-d、codex/g3-local-distribution；保留dirty后安全fetch/merge最新origin/main，读 docs/product/MILESTONE-03.zh-CN.md“本次验收及继续任务”。保持现有准确包、SHA和用户状态，不为docs/tests或移动HEAD重包。
本段只负责该包在E正常使用中的安装/启动/配置根/内置运行时/正常启停阻断；给E准确包和原入口，出现你owned的具体阻断就持续修到main采用、明确必要后继、E同包复验。没有具体阻断则待命，不另开升级/备份/签名/多平台维护队列，不重新生成成套报告。真实模型预算0，不碰十二旧实例/未知资源，不借凭据。
检查点三行：清单x/6、剩余、用户决定。交接最小commit/实际命令exit/包身份/证据/限制即可，SOURCE_READY不是本期完成。
~~~

## 发给Agent E（整段复制）

~~~text
继续同一个里程碑03到原六项独立最终验收，不开新wave。你本次cd9e473a是零模型准备，不是双项目交付已完成；D固定包现已具备，真实Codex额度早已获用户授权，不再等待“D未冻结/预算未授权”。
沿用 /Users/hh/Desktop/joker/superagent-agent-e、codex/g3-product-acceptance；保留dirty后安全fetch/merge最新origin/main，读 docs/product/MILESTONE-03.zh-CN.md“本次验收及继续任务”。当前原目录仍cd9e473a且没有后续文件修改；请实际修改并提交，不把阅读/准备/旧提交当作本次完成。只改原 tests/product-acceptance/；main给出的以下三项都有自有临时复现，先在你的实际consumer修完再发真实turn，不改main生产代码或放松产品断言：
1. reserve不能算实际消耗。按实际写出的turn/start计；可保留在途预留防并发，确认未发送的setup失败能撤销在途预留；已发送/发送未知占用且保留原ID，不能新ID重发，不重置旧grant/ledger。先修该计数消费者，不另造调度/授权系统。
2. 当前两份spec-tools/accept-tools的node --test都是0测试，不能作为真实项目原检查。选两个具有真实代码、现有可执行且非零检查的Git项目/真实备份，保留原package/check/依赖声明与基线来源，不能重写package.json或用新增空检查凑通过。先实际跑原检查验证前置，再用两次预算完成一次缺陷修复、一次小功能。
3. patch验证副本不能保留原.git文件/目录/外部指针或写原索引。新建空目标、按明确文件边界导出基线，保留原检查；对正常repo和linked worktree都断言原文件/index/HEAD/状态不变，拒绝非空目标及越界链接。main复现中你现有helper失败且改了自有临时baseline index，禁止照此操作真实项目。
只针对本期的固定外部身份验包：source83f79e8249efd68f429f2b6828ea233278071737/buildd3ba0ec6dccc5eac；outer /Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec/PersonalAgent-Preview-d3ba0ec.zip，SHA163b32170680bcbdb324a4fd8edc631bdfb685633911a787c3b3de353577075b；inner SHA52eee9083b4d2256a58189327c93605c157e38f5cd44894482a82c6198f56123。不能只改cohort标签继续用W36，错误身份必须在启动前拒绝。全新实例native已准入但needs_project是正常状态，先明确导入，不能要求自动starter。
给本期消费者一个聚焦的可执行入口：零模型准备可单独运行，真实执行必须显式选择一个任务、核对实际余额，不默认批量发turn；交接写出准确命令和exit。不要只添加NOT_TESTED占位或把本期挂进整套历史e4。修完后直接沿同一个包持续做完：包内Node和正常outer入口/一致私有roots启动→GUI配置保存与就绪→两个原项目的真实Work→原问题/同Work补充/停止→原检查/currentCandidate/人工接受→下载patch在独立原基线验证→正常重开查看两个原Work/消息/候选/产物/接受记录。通过正常UI操作；原审批/澄清未触发或受plan模式限制就明确记录，不能借旧实验PASS或探针API。无法完成的条目给main具体阻断，不把NOT_TESTED或可选case汇成六项完成。
你仍最多3次实际Codex turn，全员4次含main预留1，不刷新预算、不自动批量live；先核对原私有发送记录。普通主对话网关没有新增调用额度。setup没发送可修复后重跑；UNKNOWN业务先核对、不重发。用聚焦的本期入口，不重跑整套历史e4/维护/研究队列。
生产缺口交main/D最小复现；有必要的运行代码后继由main明确再接续验证，不跟移动HEAD、不私自重包。没有用户第二台Mac实证时跨机NOT_TESTED。保留原dirty/state/十二旧实例，不借凭据，不额外SIGKILL或清UNKNOWN资源，不把全局Node/开发checkout当安装前置。持续修复、联调、复验到同一结果结束，不在单个fix或SOURCE_READY停下；检查点只报三行，最终一份范围准确的结论即可。
~~~
