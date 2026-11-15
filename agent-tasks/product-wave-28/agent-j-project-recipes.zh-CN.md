# J：实际项目可用的任务草稿与事实模块

2026-11-15。工作目录 `/Users/hh/Desktop/joker/superagent-agent-j`，原分支 `codex/g5-project-recipes`，固定验收起点 `46020ff2e2d748961835a64cc8bf1a39cb91d378`。
保留全部历史/dirty，fetch并合并最新origin/main；读AGENTS、START-HERE、product-spec/README和[本轮README](README.zh-CN.md)。
共享事实见[0071](../../docs/rfcs/WP-16/0071-wave-28-architecture-inputs.md)/[0072](../../docs/rfcs/WP-16/0072-wave-28-integrated-delivery-packages.md)。
仅packages/project-recipes/、tools/project-recipes/、docs/project-recipes/、reports/project-recipes/；不改原授权/原App/HTTP/根锁/SQL。
十位外部A–J加main按正常节奏建设，不设当日deadline。建立整个结果包goal，无token预算；24阶段/4、8、12、16、20、24六个完整结果，source发布后继续，不在小修或PARTIAL处等待下一轮。
状态写 `reports/project-recipes/wave28-status.json`，必须分source/controlled/installed/native/value/activation；静态检查和阶段数不提供产品准入。

## J1 原Scope语义对齐

本轮独立证明src/及排除项尾斜杠会被matcher误拒；prefix子路径草稿又会被同配置原Application拒绝。
按当前scopeWithin的声明原子包含语义工作，不为配方扩大原授权；保留.及原allowed/excluded字符串。

## J2 只产可用范围选择

选择只能引用既有grant atoms或明确needs_input；不把src/file作为src的新授权原子。
覆盖.、src/、src、排除项、空/父/绝对/反斜杠与相似前缀，正常输入保留原表示。

## J3 实际应用消费者

在同一配置下调用原createProductApplication和公开create_work，验证matcher称draft的输入确实可进入原委托。
结构schema-valid不等于应用可用；不新增candidates表、SQL、执行生命周期或更改core的授权判定。

## J4 第一结果：原项目实际可用草稿

交真实NativeProjectRegistry/root与原controlled配置的可用草稿、拒绝与原Application消费者。
修复现有42/30正向不回归，J4早交source给main/F后继续，不以路径helper小修停工。

## J5 可打包的只读事实模块

把main实际需要的有界metadata观察作为稳定runtime export交付，复用现有reader实现并避免tools/runtime两份复制。
只从caller明确选择且已有登记的root读取；不接受公网任意路径、home/env/credential或自动扫描全部项目。

## J6 完整读取预算与身份

保留NOFOLLOW/普通文件/fstat/文件与总字节/数量限制，核root变化、缺失、替换与截断不会生成完整事实。
不执行packageManager版本或scripts；结构化JSON解析，脚本正文不解释/执行/进入输出。

## J7 当前事实与版本

facts、配置、catalog和选择均有确切版本/digest/观察时间，原输入变化后必须重生草稿。
不从路径名/锁名推原生就绪或执行权；缺失与过期保持needs_input/unsupported而非猜默认。

## J8 第二结果：实际Node事实消费者

交main可编译runtime metadata/facts port和只读CLI，同一实现用于已授权项目而非只会读测试文件。
发布J8 source与最小依赖/打包closure给main/D；不改根锁或main registry/HTTP。

## J9 正式preview字段交接

复用既有Scope/RequiredCriteria/profile与原create_work字段，main持有会话/命令/授权与明确确认。
对齐main发布的实际preview接口；无接口给具体最小调用，不伪造模型来源/Proposal或第二确认权威。

## J10 状态与错误完整

三类任务的draft/needs_input/unsupported带闭合issue code与脱敏文案，字段/长度/来源可独立校验。
对恶意长文本/坏facts/未知协议有限拒绝，不在错误中回显脚本、凭据或私有绝对根。

## J11 旧输入与用户编辑

previewInputs对当前可信配置/facts和原选择重新校验，明确哪些字段需重生成，不能把自算digest当批准。
用户编辑仍由main原表单处理；J不发HTTP，不dispatch，不注册检查或安装依赖。

## J12 第三结果：草稿到原确认输入

交catalog→真实已授权facts→同配置草稿→原表单字段→实际Application可用的完整消费者。
main/F尚未合入的UI/HTTP准确NOT_REACHED，source早交后继续多项目而非等待整队。

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

写reports/project-recipes/wave28-status.json列J1–J24、六结果、main/F消费者、准确source/命令exit和未达项。
只提交四类owned paths到codex/g5-project-recipes原origin分支；whole goal未齐保持诚实，不以静态schema或文档冒充产品接入。

## 独立备选队列

main/F未到先关闭原Scope消费者不兼容、runtime observer、真实两项目/monorepo/CLI/严格类型与打包closure。先交正式可编译Node输入，不能只等新UI或修改授权凑PASS。
每个请求、子进程与总流程有限deadline，依赖未到标NOT_REACHED并继续可独立项，不无限轮询，不造第二实现或探针专用空方法。
所有自动真实vendor/model/native0；B cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot BLOCKED，无reset/topup/refund/补样/价格配方研究。
保留十二服务5180/8796至5191/8807、全部state/profile/tar/ledger和B旧diff+b16/C lock/E runs/用户日志。只精确独立出生PID/start/UID/fullargv/root/config/operation且每次fresh后signal，unknown保留；不global发现、substring强杀或其他credential。
无新Driver/CAC/桌面/autoaccept/writer racing/动态DAG/第二生命周期；只显式自有路径推原origin分支，main用HEAD:main，不upstream/reset或清旧状态。
