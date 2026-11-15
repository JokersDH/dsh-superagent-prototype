# J：已接主线的项目模板与运行时事实

2026-11-15。工作目录 `/Users/hh/Desktop/joker/superagent-agent-j`，原分支 `codex/g5-project-recipes`，固定验收起点 `448a414ed116e4db33b4e23d0ff1a2283cfe4b23`。
保留全部历史/dirty，fetch并合并最新origin/main；读AGENTS、START-HERE、product-spec/README和[本轮README](README.zh-CN.md)。
共享事实见[0071](../../docs/rfcs/WP-16/0074-wave-29-architecture-and-reviewed-inputs.md)/[0072](../../docs/rfcs/WP-16/0075-wave-29-product-completion-packages.md)。
仅packages/project-recipes/、tools/project-recipes/、docs/project-recipes/、reports/project-recipes/；不改原授权/原App/HTTP/根锁/SQL。
十位外部A–J加main按正常节奏建设，不设当日deadline。建立整个结果包goal，无token预算；24阶段/4、8、12、16、20、24六个完整结果，source发布后继续，不在小修或PARTIAL处等待下一轮。
上一轮Scope声明原子兼容与same-config Application真关闭，61库/20工具/实际consumer通过。main0073已原字节接运行时observer、真实preview HTTP与原NewWorkForm，继续实际产品与同包消费，不重复造HTTP或matcher。
另读[0073实际模板入口](../../docs/rfcs/WP-16/0073-main-project-recipe-preview.md)。
状态写 `reports/project-recipes/wave29-status.json`，必须分source/controlled/installed/native/value/activation；静态检查和阶段数不提供产品准入。

## J1 消费主线实际接口

对齐0073和ProjectRecipePreviewInput/Fields，核实际root lookup→observer→matcher→原form→创建链，保留已关scope兼容。
不再以只有UserCommand schema通过作为成果；同一配置的actual Application/两个项目是现成回归起点。

## J2 元数据读取一致性

围绕文件变化/读取期间替换/大小变化/缺失与总预算复核现有observer，确定每个读取前后fstat/上限都覆盖。
不因纯lstat检查通过就给新打开更大/不同文件无限分配；原root白名单/NOFOLLOW/无脚本执行保持。

## J3 运行时与CLI同一实现

runtime observer与CLI继续复用同一模块，源/dist/exports和预算/错误语义一致，缺build只给可行动脱敏错误。
不重新把observer搬回只在tools可用的代码，不加第二库/collector/registry或根锁owner。

## J4 第一结果：真实主线可持续消费

交当前main实际preview/form消费者与完整元数据一致性/失败/预算正负和严格类型。
先发布可独立build的稳定source给main/D/F，继续整包，不重复旧atom修复当新成果。

## J5 观察内容与时间语义

区分稳定内容digest与本次observedAt，服务端每次真实新观察、相同内容可比较，过期输入不能升级为新授权。
原metadata内容/声明/布局改变会改变逻辑facts；时间戳本身不是permission或执行结果。

## J6 精确项目事实

显式已登记root由main决定，观察入口只取projectId，不枚举全机/兄弟/父目录；缺root保持明确unavailable。
不把缺manager/lock/engine填假默认，不把Node清单存在当原生工具已安装或兼容已测。

## J7 三模板当前输入

catalog/facts/config/selection版本与稳定字段完整，needs_input/unsupported在实际API中有准确code和可行动输入。
不得伪造sourceMessage走模型Proposal，不把hash或authority none当批准；根接口与schema由main改。

## J8 第二结果：当前运行时事实模块

交真实main已登记项目与CLI的同一观察/模板实现，更新当前依赖/打包closure给D。
零执行/安装/SQL写，支持当前Node目标；source交后继续应用流程，不等另一轮小修派工。

## J9 实际原字段兼容

维持原Scope声明atoms、完整exclusions/expiry、criteria/profile/goal，输出与main公共Fields精确可编译。
更多排除和原子的选择不改变原grant；unknown/矛盾输入不能变可执行默认，保留原Application拒绝。

## J10 重验和可编辑目标

跟main的预览→应用→明确创建前重验一起验证facts/config/catalog变化、用户goal编辑和旧观察。
相同字段不等于原input当前；不改变原业务commandId或复制命令幂等账本。

## J11 两项目原委托消费

提供main/F/E可重复的两根项目、显式atom/注册check/profile、有效与缺能力数据，通过原Work/currentCandidate/manualaccept。
每步真实调用与控制fixture/native层分开；不把main已交入口再标NOT_REACHED。

## J12 第三结果：模板到原产品确认

交当前J模块→main HTTP/原form→两项目原委托的稳定消费证据及异常，给准确source与包需求。
J不修改App或E断言，组合缺陷给最小复现；source结果不是installed/native/value准入。

## J13 多项目与同名隔离

两个真实独立根/真实ID、不同manager/profile/check、同名项目与切换都保持输入和建议归属。
不因文字相似复用配置或scope，重复观察不累计副作用，保留原同名测试成果。

## J14 monorepo精确范围

workspace root/member只能使用明确声明/已授权原子，不猜成员或把未知布局当普通单包。
需要更小scope由原配置授权流程决定；CLI不悄悄拓展或读父/兄弟目录。

## J15 三类模板与检查

回归修复、有限变更、验证跟进各给实用目标/标准，复用当前registered checks与项目profile。
未知语言/manager、无required machine或disabled profile解释清楚，不自动换fixture/agent或命令。

## J16 第四结果：多项目实用模板库

交三类模板在真实两项目/monorepo/缺能力下的完整建议和原确认输入，有完整positive与独立negative。
证明结果可复用，不以catalog条目数或测试数字代替main实际消费。

## J17 资源与异常恢复

读取/解析/总工作量有界，拒绝/中断保持原项目文件不变，输出新建不覆盖，重复观察可重现。
失败材料只含有限IDs/状态/digest，不加spill数据库或后台任务队列。

## J18 分发与消费者兼容

Node库、CLI的source/dist/exports依赖一致，独立fresh caller能build和运行，不借另一个checkout的node_modules。
main唯一根依赖/lock owner；D唯一发行工具owner，给必要closure清单不并改。

## J19 隐私与可观察数据

输出仅明确公开facts、名称/数量/digest和缺失，记录本次读取范围，配置并不证明工具已安装或native已测。
拒绝时不得回显metadata正文；任何可执行/安装/网络动作都不属于这个模块。

## J20 第五结果：完整工具与支持

交真实Node/CLI入口、失败/上限/新建输出/文档/可复现消费者，能供同事在合法范围使用。
零模型native、零安装/SQL/注册检查，原项目mtime/内容与用户state保持。

## J21 主线实际接入复核

消费main已发布的实际HTTP/form source和F字段映射，核同一project/config/facts/revision及原confirm。
只修J-owned缺陷；main组合问题给精确复现，不用探针专用空方法或复制第二matcher。

## J22 有价值的日常流程

用现有受控项目比较人工填写与模板预填所需字段/操作，记录观察事实和用户未达项。
不运行被BLOCKED的独立复核试点或声称因果收益；这只是零模型产品可用性观察。

## J23 公开开发交接

更新支持范围、接口不变量/顺序/错误/预算、三模板例子和准确fresh运行命令。
别重标历史35/20为当前42/30；每条证据绑定实际source与消费者，未测平台清楚。

## J24 第六结果与最终交付

写reports/project-recipes/wave29-status.json列J1–J24、六结果、main/F消费者、准确source/命令exit和未达项。
只提交四类owned paths到codex/g5-project-recipes原origin分支；whole goal未齐保持诚实，不以静态schema或文档冒充产品接入。

## 独立备选队列

main实际入口已到，继续当前observer一致性/读取预算、真实两项目/monorepo/CLI/类型/打包closure和实际API消费者。已关闭的原Scope兼容仅保留回归，不重复当新修；不能等待新UI或修改授权凑PASS。
每个请求、子进程与总流程有限deadline，依赖未到标NOT_REACHED并继续可独立项，不无限轮询，不造第二实现或探针专用空方法。
所有自动真实vendor/model/native0；B cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot BLOCKED，无reset/topup/refund/补样/价格配方研究。
保留十二服务5180/8796至5191/8807、全部state/profile/tar/ledger和B旧diff+b16/C lock/E runs/用户日志。只精确独立出生PID/start/UID/fullargv/root/config/operation且每次fresh后signal，unknown保留；不global发现、substring强杀或其他credential。
无新Driver/CAC/桌面/autoaccept/writer racing/动态DAG/第二生命周期；只显式自有路径推原origin分支，main用HEAD:main，不upstream/reset或清旧状态。
