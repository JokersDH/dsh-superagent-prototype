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
- 本期真实Codex合计最多4次，以实际写出turn/start计。原预留main1/E3；2026-11-20 main按本条在总上限内重分配为main0/E合计最多4，E已实际发送3次，最后1次只补工作台控制链。D0；不是新增额度或刷新旧预算。不必用满，额度不自动互借。UNKNOWN发送仍占用且不得重发；setup失败且确认未写turn不计。
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

## 当前验收与最后控制链

2026-11-20收到E新提交8b70fd0c2d60c029aee8985125e6e09e967a896b；D仍e247e7b782ec12a01de8685eb1199683f47afce2，固定包保持。此前仅准备cd9e473a和上次验收结论成为历史，不重复派其已修问题。

本次4/6完整闭合（①②④⑤，按以下明确范围）；③工作台控制仍PARTIAL，⑥完整同包旅程因③保持PARTIAL。本机82/100、完整B63.1%暂不重评，里程碑尚未关闭，也不是完整发行许可。

- ①：E同一准确包的首次启动、私有GUI保存（已保存≠已连接）、原生版本/认证就绪；main此前独立无认证启动/配置保存/正常停止通过。没有新增真实主对话网关请求或连接成功声明。
- ②④：原Store中Work a68880e9f1a46085f044fad0c74ff191与749f5756c3dd284886dd008de2341a18各有原project/合同/attempt/currentCandidate/注册检查PASS/人工接受/completed和ended绑定。main只读核对这些身份和全部52个artifact摘要，再按各自冻结manifest导出自有新副本，反向patch恢复基线、重新应用原patch及运行原Node检查：修复基线FAIL→候选/重应用6PASS，功能基线PASS→候选/重应用8PASS。五个文件/候选各自hash吻合，原项目/索引/状态未写。独立副本在 /Users/hh/Desktop/joker/pa-artifacts/m03-main-check-j3po97z1。范围是两个真实仓库的零依赖token-engine子包备份，其中修复是人为注入回归，不能写成两个完整业务工程的日常问题已解决。
- ⑤：E同包正常stop/start后两个原Work/候选/产物/接受记录的UI证据已交；main原Store只读核对保留的原对象和产物，未重启E实例。原E临时目录 /tmp/pa-e-m03-live 目前在main侧不可见，原Store/Runner journals/冻结工作区仍保留在产品私有根；最终材料须放持久私有目录供核对，不能靠临时目录永远存在。
- ③：原Store user_questions为0，没有原问题回答证据；原生已接收的dispatch事实只有3次begin，无同Work steer。前两次旧Work的stop发生在自然terminal之后，不能作为运行中停止证明。E已如实保留问题/补充未测；不得把普通终态stop或旧Milestone02的独立实验替代本包控制链。
- 额度：main只读核到3个实际native_accepted/对应原begin；v2环境准备失败的attempt资源为空、无原生dispatch事实，支持未发送。预算按实际发送仍3/4，而非按Work创建数。E总结中“3次=1次未发送+2次交付”表述有误，应为原merchantops真实任务1次（后停止）+两交付2次；v2未发送单列。UNKNOWN保持占用，历史材料不改写。
- 旧三阻断：预留本身不计消耗已修、两个原检查已有非零实际消费者、linked worktree不再复制.git指针且main自有复验原HEAD/index字节不变，均已形成新进展。当前最后一次live的直接阻断是两项预算助手错误：cancel后同ID再次reserve会被历史cancel遮掉，sent被拒；correctUnsent可用空证据字符串任意撤销已sent/unknown。main仅新建synthetic ledger复现，不改旧ledger；最后live前须修当前入口或禁用不安全校正分支，不能凭自述退额度。不要扩整套oracle维护。

固定包继续不变：source83f79e8249efd68f429f2b6828ea233278071737/buildd3ba0ec6dccc5eac；outer /Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec/PersonalAgent-Preview-d3ba0ec.zip，63575237B，SHA163b32170680bcbdb324a4fd8edc631bdfb685633911a787c3b3de353577075b；inner /Users/hh/Desktop/joker/pa-artifacts/m03-target/m03-target-d3ba0ec.tar.gz，20631227B，SHA52eee9083b4d2256a58189327c93605c157e38f5cd44894482a82c6198f56123。docs/tests-only不重包。未合入E整个脚本闭包；原不安全/过时live分支不作为main默认入口。

### 最后一次发送的分配

main依据原“总上限内先记录重新分配”条款，将原预留1次转E：本里程碑合计仍最多4次，E原已发送3次、只剩1次，main此后0次，D0。这是同一grant的内部调整，旧B/E研究grant继续禁用。不开新wave/新里程碑，不重复两个已交付Work。

这1次只针对准确包的一个新短控制Work：正常UI创建→实际原生问题上浮并回答→在同一原attempt/turn运行中补充→显式停止→原物理资源屏障后归还。普通on-request配置不保证request_user_input；可在当前实际能力内用本地命令的原生审批问题验证问题中心，不能偷偷改profile或换probe coordinator。补充用已有turn/steer，不需要重发begin或额外turn/start；已完成的旧Work再次continue会开新turn，不作为同一运行中补充。

先做零模型前置与原生能力/脚本检查，确保有可观察的在运行窗口，再明确执行最后1次。若实际未触发、失败或结果未知，记录FAIL/NOT_TESTED/UNKNOWN及原ID，达到总4即停止新增模型，不自动补样/重试或把失败改PASS；剩余条目由main按证据说明，不能自行放宽冻结清单。

## 发给Agent D（整段复制）

~~~text
保持里程碑03准确83f79e82/build d3ba0ec6dccc5eac包和所有SHA，不重包。E新提交8b70fd0c的两个真实交付已由main从原Store与冻结patch独立核到；现在只补本包的问题上浮/运行补充/物理停止这一个控制Work。
你继续原D目录分支，仅在E这条控制链出现具体安装/启动/包内Node/私有根阻断时修owned代码并早交main；没有阻断则待命。不要重复静态验收或另开升级/签名/多平台/维护队列，不刷新包。模型预算0，保留十二旧实例/state/dirty及历史材料。读最新 docs/product/MILESTONE-03.zh-CN.md 即可。
~~~

## 发给Agent E（整段复制）

~~~text
继续里程碑03最后控制链，不开新wave。保留原目录/分支/dirty，安全合入最新origin/main并读 docs/product/MILESTONE-03.zh-CN.md“当前验收与最后控制链”。你8b70fd0c的两项交付已有实际进展：main核到原Store同候选检查/人工接受/资源归还并独立重应用patch，6/8测试通过；不要重跑这两个Work或再次造双项目任务。
本期当前4/6完整闭合，③问题上浮/同Work补充/运行中停止仍缺，⑥完整旅程依赖③。main已按原条款将保留1次转给你：原实际3次+最后1次，总上限仍4，main/D此后0；没有新预算。原merchantops真实任务1次+两次交付=3，v2环境准备未发送单列，不把未发送算入这3次，也不退款重置旧ledger。
最后live前只修当前预算入口两项直接阻断：cancel后同ID再reserve被历史cancel遮掉；correctUnsent允许空证据任意撤销已sent/unknown。用实际发送边界核对，保留历史entries，未发送setup可解除在途预留，结果未知占额不重发；禁用自由字符串退额度分支即可，不另造预算平台/整套oracle。不要把“创建Work返回recorded”或“UI执行中”当作turn已实际写出的充分证据。
然后在同一准确d3ba0ec安装包的正常UI只发1个新短控制Work，连续做完：原生问题/审批上浮问题中心→UI答复并核原target/question/command回执→原attempt仍运行时发补充（turn/steer，同begin1）→运行中的停止→原物理屏障确认、绑定结束和槽归还。先零模型前置，准备可观察运行窗口；on-request普通模式不保证结构化澄清，可在实际能力内以本地命令审批验证原问题，但不能私改profile/用probe coordinator/绕正常入口。补充不是新turn；不要continue已终态旧Work替代运行中steer。
只剩1次：实际发出即计，setup确认未发可修再搭建，UNKNOWN业务先核对不重发。若未触发/失败/未知，如实记录并在总4后停止新增模型，不能补样凑PASS，不自动开新里程碑。问题/补充/运行停止各自缺证就各自未达；旧终态后stop和Milestone02不能替代本包本次证据。
同时把当前已有Store/原candidate/patch与最终截图/原命令ID和实际发送证据保存到持久私有目录（不要凭空重建缺失/tmp历史、清库或迁移原授权）。本轮main侧/tmp/pa-e-m03-live不可见，但原产品私有Store/Runner journals/冻结内容仍可读。最终说明真实范围是两个仓库的零依赖token-engine子包备份，修复为注入回归，跨机NOT_TESTED；不声称两个完整业务工程或已验证连接。
只改tests/product-acceptance/，有生产阻断给main/D最小复现；不改原Runner wire/共享root或他人树，不操作十二实例/未知资源，不借凭据/强杀。持续到同一控制结果的实现/消费/修复/验收，一份最终汇总即可；检查点仍三行。新commit、精确命令exit、原ID/持久证据及剩余项交main，不在SOURCE_READY结束。
~~~
