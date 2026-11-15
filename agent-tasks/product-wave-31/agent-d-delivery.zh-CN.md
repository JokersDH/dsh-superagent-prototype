# D：三段连续发行与同事复用计划

继续 `/Users/hh/Desktop/joker/superagent-agent-d`、`codex/g3-local-distribution`，日期2026-11-15。
保留历史并合并最新origin/main，读AGENTS、START-HERE、product-spec/README及[本轮README](README.zh-CN.md)。
读[0080主线导出与运行时检查点](../../docs/rfcs/WP-16/0080-main-observation-export-and-runtime-checkpoint.md)、[0081验收架构](../../docs/rfcs/WP-16/0081-wave-31-reviewed-architecture.md)、[0082三段交付计划](../../docs/rfcs/WP-16/0082-wave-31-three-release-program.md)。
建立或沿用覆盖全部三个交付包、十二个完整成果的wholegoal；用户一次下发后连续执行全部结果。
允许跨多个工作日持续推进，无当日deadline、token预算或耗时承诺，source早/中/晚发布后继续独立工作。
仅拥有 `apps/launcher/`、`packages/portability/`、`tools/distribution/`，状态写 `tools/distribution/reports/wave31-status.json`。
main拥有根契约/配置/锁/HTTP/App/授权，A迁移、E独立required，其他原ownership不变。

R1锁定源 `82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2`、build `8296720d8a25f38c`。
R1 tar为 `/Users/hh/Desktop/joker/pa-artifacts/wave30-target/wave30-target-8296720.tar.gz`。
SHA256 `04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543`，20481470字节。
6849项/197源码闭包已独立过，schema18、darwin-arm64、Node24.21.0、ABI137、SQLite3.53.4。
真实0076窗口、0077表单/工作台、J/G dist与五类mode已在R1，旧无window/fixture误绑问题不再重派。
E目前实际1fba ordinary189/functional190真通过，R1尚未E独立验；不能重贴旧报告，也不抹旧进展。
R2是新功能lane：仅main实际0080/G导出/J/B已验source组合后才确定必要后继，与R1冻结字节严格分开。
不要让E追移动目标；E工具/文档修补不推动R1重冻，新runtime变化才R2或必要新身份。
全员真实vendor/model/native0；BUNKNOWN不可花，E原24turn/200000token/USD5/oneflightBLOCKED不reset/refund/补样。
十二组5180/8796至5191/8807及全部state/profile/tar/ledger/dirty保留，禁global发现/借凭据/真实CLI fallback。
仅完整独立birth集合且每次signal前fresh才可处置自己资源，UNKNOWN保留材料；无target授权、桌面、CAC、autoaccept或第二ledger。

## 交付包一

目标：固定R1并交可独立验收、可由同事实际使用的当前普通产品，不因后续lane移动字节。
四个成果都基于同一不可变R1；先交准确输入让E立即工作，再持续完善开发consumer与指南。

### D1 不可变R1与开发证据交接

实现范围：把R1的source/tar/build/schema/ABI、manifest、完整files/link和已测userflow整理成准确交接。
不重建同字节新tag，不覆盖R1、1fba、1ba、ce64等旧候选或原失败材料。
actual消费者为E现有frozen-package loader、H只读preflight、D package checker与同事安装入口。
developer工具的source/entry/hash、实际导入的APP根和运行包consumer分别记录，避免当前checkout补冻结能力。
修陈旧文档/中间NOT_REACHED和错误fixture标签，保留原报告作为历史，不改写既有原始观察。
窗口9/J6/F8是installed-byte自测，不写成E独立required或实际native证明。
提供一个明确R1 manifest入口、最短只读校验和执行recipe，消费者不用猜临时目录。
必要正向：从原tar重新展开到新private根，元组和每项hash/size/link与原始记录完全一致。
必要负向：wrongSHA/size/build、陈旧source、坏entry、外部link、缺manifest或跨sourceconsumer拒绝。
归档读取/成员/解压/总字节/时间有界，输出新根受限、拒绝覆盖，不带个人state/profile/token。
运行包身份不由文档HEAD决定；metadata变更不成为新执行生命周期或权限。
验收：E能直接载入同一个R1，并看到原始数据和developer evidence适用scope。
source交接包含源码清单、明确owned-path差异、有限命令/exit、输入hash与未达范围。
第一稳定source先推原origin分支，随后继续D2–D12；发布不是暂停或等待E绿灯。
R1实际功能差错给最小source/tuple复现，只有runtime修复才必要新候选身份。
E测试工具缺口由E修，D不改其assertions，也不为工具修补反复freeze。
独立可做的报告一致性/闭包/support并行推进，不能因一个外部结果未到停掉整包。
本成果完成是准确可消费R1，不是多一个静态发布标签。

### D2 完整mode与双format开发consumer

实现范围：同R1核normal/restored personal和fixture、有/无review、两个snapshot格式与原资源政策。
实际消费者为包内daemonArgv/start/health/record/stop、原SDKmock/context与C唯一manifest-target consumer。
保留正确fixture恢复身份、normalfixture惰性assistant及一般health检查，不能松root/start/UID/stop守卫。
两format依据实际snapshot/restore-report，原Q/A/native_applied、Work/候选/source内容和artifact完整。
source/producer、manifest、target、包entry/hash和实际进程身份分别绑定，不凭文件名或DBSHA等价补格式。
恢复readonly不启旧queue/native/provider，不继承旧native认证/grant或target执行权。
必要正向：五类mode的request/argv/health/record一致，原scope读取与包内STOPPED可复现。
必要正向：两format独立目标根被同R1消费者读取，原IDs/digests与允许transform准确。
normalfixture仅显式mock请求走SDK，不借真实profile；查看/启动不发送真实modelturn。
必要负向：wrongmode、wrongroot/config、陈旧PID/child、mixedunknown、错误format、scope/content/artifact漂移拒绝。
FTS/event等允许变化必须按A/C已准入精确规则，不以完整familyignore掩盖业务改动。
先完整合法positive再单变量negative，schema早拒绝不重复当内容proof。
birth在spawn时记录完整集合，任何signal前核全集合、每个TERM/KILL再fresh，未知不删除。
安全工具未通过E新knownchild/no-record边界前，只做pure/数据读取，不使用危险liveforceproof。
验收：mode/内容/权限/stop/资源归还一致，逻辑proof与physicalquiescence/启动许可分开。
source交接给E完整matrix/consumer参数、原始pidstart计划和有限exit，不只PASS总数。
R1已有真实五mode/双format进展保留，只对新增风险必要重验，不机械全历史suite。
本成果让当前候选有完整可重复开发consumer，不另造验证authority或候选ledger。

### D3 同tar安装升级、重开与只读恢复

实现范围：与E锁同R1贯穿cold/no-executor/multi-state、upgrade/reopen和backup→新根readonly。
actual消费者是R1包内pa命令、console/API、原restoremarker和数据reader，不借checkout脚本补产品实现。
必要正向：新private根可启动普通工作台，无执行器准确未就绪，原草稿、J/统计/context路径可达。
same-file REUSED核原PID/start/health，停止后按原流程reprepare/reopen，原完成请求不重发。
安全baseline到R1及16→18核exit/status/pointer/operation/data，不以两个start冒充managed upgrade。
backup包含可迁移数据/artifact，restore到新根保持readonly，不复制认证/profile/旧session/可执行grant。
两state共享install也不互认config/data/端口，已有unknownwriter/queue/marker屏障不删除。
必要负向：wrongroot/copyrecord/错误review/expiry、UNKNOWNlive、坏bundle、目标不健康和新数据保护准确拒绝。
rollback不能用旧快照覆盖升级后新写入制造通过，未实现的恢复动作准确未达。
每场景有有限deadline、完整positive和精确资源集合；旧用户十二服务不作为样本。
E独立required而D只是候选自测，双方实际source/tar/consumer不一致就分别报告。
工具cleanup成功不改写产品BLOCKED/超时，unknown保留private材料不假报干净。
有限SSE/刷新/客户端重连和daemon恢复分开，不把短流程称48h/native稳定性。
验收：安装/升级/重开/恢复数据一个完整生命周期与同tar输出，普通功能不外推target授权。
source交接发布actualrecipe、命令/exit/时间、原数据/资源前后计划和准确缺口给E。
E最终未到只阻准入声明，D4同事指南/support继续，不等整团队同步完成。
docs/tool变更不重冻，R1runtime确需修复才另立身份并保留旧结果。
本成果不是清空失败目录后重跑的一份绿报告，而是可独立重做的普通生命周期。

### D4 同事独立冷装与R1支持包

实现范围：另一位同事在自己的独立目录按R1固定输入完成校验/冷装/使用/停止/诊断。
actual消费者为当前pa help/status/doctor、工作台导航、模板/窗口和private支持输出。
先列实际平台/Node/ABI/普通功能范围，无执行器体验准确，不宣称未测native/private/target。
指南给最短模型配置/项目导入/preview/apply/明确create/check/candidate/manualaccept与来源核对。
说明facts/config/catalog变化需重应用、unknown网络重试同commandId，不承诺跨reload exactly-once。
必要正向：独立新根按手册运行两项目普通流程、stop/reopen、backup→readonly和问题上报。
必要负向：缺依赖/坏tar/错ABI、已有输出、无执行器、不可委托项目、auth错误与readonly动作限制。
support新输出0600、目录受限/no-overwrite，token/modelkey/nativecredential/旧授权不入材料。
保留必要source/tar/operation/错误/资源事实，脱敏不把unknown或失败抹掉。
H只读诊断是输入，不是停止权；所有安装/停止/迁移只走已准入D/main入口。
同事无需读取作者checkout或其他home凭据，作者临时root不成为运行依赖。
验收：R1独立directory操作可重复、模式/数据/退出和指南一致，原用户数据未迁移重置。
source交接包括同事recipe/supportschema/准确R1scope与四个R1结果索引。
E对同tar完成前保持待验，不用developer8/9/6测试代Efinal。
这四个R1结果完成后继续包二，新功能lane不能反向移动已交R1字节。
若新runtime修复阻断R1功能，单列必要后继而不覆盖原tar，E明确选择测哪份。
正常节奏允许持续，不作今天完成/耗时承诺，不以文档完整冒充installed成功。
本成果是同事实际可试用且能诊断的R1，不是宣传页或另一套安装器。

## 交付包二

目标：在R1不变的同时，接main0080实际已验运行source形成独立R2；不让E追逐移动target。
R2只纳入main已经发布并真实组合的G导出/J/B等source，未准入实验通道不因有文件进入默认能力。

### D5 R2稳定source与功能输入表

实现范围：锁0080实际source及每个运行slice、publicschema/endpoint/entry，列R1到R2真实字节差异。
actual消费者是main observation export、J原表单、已验B普通运行闭包及现有launcher。
G导出读取原scopedinsights，不把显示格式反向解析成新数字或新增collector/ledger。
Jpreview仍authorizationnone，Bsource采用不等于原Work恢复/native/slot准入。
必要正向：source和接口能从发布checkpoint直接调用，普通旧能力保留。
必要负向：未发布/dirty依赖、来源不明或未准入slice不自动并入默认R2。
root锁/契约/HTTP组合由main，D只列准确依赖/打包要求，不改候选工作树。
运行图说明Node/browser边界，rawanalysis/credential/experiment输入不进入browser或tar。
R1继续供E，不因R2开始就把R1称过时无效或强制用户升级。
验收：一张真实source差异表决定R2内容，非“最新分支包含所有功能”的宽泛描述。
source交接先发布可运行build输入和最小owned差异给E/main，再继续D6–D8。
若0080接口未到，独立包兼容/数据保护/support工作继续，不能另造替代HTTPauthority。
预算0和旧权限不变，不为R2补真实native/模型样本。

### D6 R2完整运行闭包与冻结

实现范围：contracts-first构建G/J/原runtime/coordinator/console/launcher必要闭包与exports/nativeABI。
actual消费者为原build/stage/freeze、R2包内命令/HTTP/UI，不从global安装或作者checkout补缺。
必要正向：cleansource到release/stage完整自校验，G导出/J与承诺slice确实装入。
必要负向：缺dist/workspace、陈旧console、错ABI/hash/entry、外部link、secret/runtime材料拒绝。
记录source/build/tarSHA/bytes/schema/Node/ABI/platform/SQLite和完整file/link/manifest。
从tar重新展开逐项比对，运行entry和asset同source，source-only测试不重贴installed。
新运行变化才freezeR2，docs/tool修补不推动重复冻结，R1与旧tar全部保留。
先固定不可变R2给E，再要求独立final，不形成source/freeze/E循环。
验收：R2具备可重复构建recipe和单一准确artifact元组，E可明确选择R1或R2。
source交接含consumerhash、功能/未达范围和R2相对R1迁移约定。
不因B文件进入闭包声称业务恢复或native全通过，保留实验/默认路径区分。
只发布owned路径到原origin分支，不更改根锁或Erequired。
完成冻结后继续真实安装兼容，不把新tag当R2整个goal完成。

### D7 R1到R2安装升级与资源管理

实现范围：R1→R2有界upgrade/rollback/重开、普通无执行器/多根与新数据兼容。
actual消费者为原managed upgrade/pointer/journal/数据/stop与readonly恢复链。
必要正向：明确baseline/candidate二进制不同，R1数据在R2可读，新写数据保护和mode一致。
必要负向：UNKNOWNlive、跨rootconfig、错operation/pointer/ABI、目标失败和post-upgrade写入保护。
不能用旧备份覆盖新数据让rollback绿，不以两个启动冒充managedupgrade。
完整资源集在任何signal前证明，每次TERM/KILLfresh；已退出parent不等全部children退出。
E工具未知或partialset不具清理权，失败留private材料，不扫描其他服务或删除marker。
有限场景deadline与完整positive，只有新风险需复验，不机械重复旧全部矩阵。
验收：R1/R2数据、二进制、pointer、进程和退出一致，功能失败不能靠工具收尾修饰。
source交接给E固定tarpair、原始operation/资源/数据前后事实和最短repeatrecipe。
ordinaryR2不依赖B恢复/private/target/value，缺这些只列未达。
R2runtime修复需新identity但不覆盖R1/原R2，docs-only继续同字节。
这个成果完成是一次真实安全升级生命周期，不是更多mock状态字符串。

### D8 R2新能力与支持交付

实现范围：同R2验证G导出、J明确确认、新已验运行slice和原context/source/UI正常可用。
actual消费者为0080实际GETinsights/export、现有表单、App导航与private support。
必要正向：两个project、7/30、rowpartial/layer/currency/unknown和导出同源，模板明确用户动作才写Work。
必要负向：wrongproject/window/auth、badsource、readonly、陈旧facts/identity与旧响应不扩大权限。
导出是显示/观察数据，不是新统计账本、执行授权或收益证明。
support0600/no-overwrite/脱敏，报告不带token/profile/rawprompt/私有原文或旧grant。
验收：R2ordinary实际同tar能力与数据来源一致，E独立required，不由D摘要签release。
source交接发布R2指南、同事recipe、功能范围/未达和四个R2成果索引。
完整R2交接后继续包三；R1和R2各自不可变，不能把E旧R1结果贴R2。
本阶段不复制I/B实现、不增加Driver/接受权威或自动native任务。
Efinal未到只保待验，同事指南/复现工具独立继续，不无限轮询等人。
实际source发生变化就精确标时间scope，组件模块存在不等用户入口准入。
本成果是可支持的新能力发行，不是导出一个JSON或复制一套发布gate。

## 交付包三

目标：让独立同事可复用、可迁移、可恢复当前ordinary产品，并能复现高风险失败；不混target授权。
四个结果选择明确R1或R2元组运行，不把不同候选数据/日志混成一条链。

### D9 独立同事复用与迁移路径

实现范围：新directory/本机独立状态的配置、包搬运、依赖/ABI检查和已有同事数据只读预检。
actual消费者为已准入pa/preflight/配置/registry，H只提供只读观察，实际迁移由D原入口。
必要正向：原包可在另一新private根运行，无作者目录/绝对Node依赖，项目按明确本地路径重新绑定。
必要负向：旧profile/credential/session/grant混入、wrongABI/平台、路径冲突/已有root/权限不安全拒绝。
不能复制home/native凭据、force marker或静默扩大scope；迁移数据不等迁移执行权。
当前只测darwinarm64/Node24ABI137，其他组合准确未测，不复制本机node_modules称支持。
保留同事已有状态和旧tar/ledger，输出新根受限，不覆盖活state。
验收：同事按手册能完成允许的搬运/配置，失败可理解、可回退且不改旧数据。
source交接含平台/路径/数据边界、实际命令/exit和可复现最小包输入。
先以自己新fixture/readonly装置证明，不对用户十二实例做迁移演示。
依赖未到就交准确预检和未达，不造新安装器/registry/授权层。
同事可用范围和执行未就绪真实，normal功能成功不外推native或多用户ACL。
本成果是实际可重做迁移路径，不是一段跨平台承诺。

### D10 完整备份恢复到readonly与原数据核验

实现范围：完整非空Store、artifact、原Work/Q&A/candidate/观察/模板资料的backup→独立新根readonly。
actual消费者为原backup/verify/restore、A/C精确内容proof和包内prepare/start/history/source。
必要正向：原ID/digest/target/fingerprint/format对应，原正文/候选按明确review允许范围读取。
必要负向：缺artifact/坏digest、foreigntable/FTS/event异常、wrongreport/format/target、scope收缩和旧receipt。
允许变换由精确subject/operation约束，不忽略整个业务family或删WAL伪造一致。
restore不带旧writer执行权、credentials/grants/queue启动，物理quiescence与逻辑proof单列。
未知资源/不完整inventory不变empty，损坏源不覆盖或自动修复个人DB。
验收：一条完整真实数据链可重读且权限不扩，恢复后的普通support/stop准确。
source交接给E固定数据subject、包tuple、原始验证/拒绝和finiteconsumerrecipe。
两个format如被承诺分别实际restore，metadata与报告一致，不能只靠文件名。
使用私有非空受控数据，真实vendor/model/native0，原账本不作恢复预算。
缺targetactivation独立未达，任何备份回执/空DB不成为新授权。
本成果是完整数据恢复，不是一次空库copy或仅DBintegrity绿灯。

### D11 高风险恢复故障与资源失败处理

实现范围：在完整positive后验证恢复/升级中断、丢record、parent退出child仍活、部分写和未知观察。
actual消费者为原pointer/journal/restore/launcher/资源plan，不新建第二执行生命周期。
先pure注入证明unknown不变gone、完整precheck和逐次fresh，再对精确出生probe做必要live窗口。
必要正向：失败有确定exit、原数据保留、合法终态/下次显式恢复可解释。
必要负向：陈旧/foreignPID、修改argv/root/config/op、mixedunknown、超时/ps不可读均零误signal/零材料删除。
已知parent退出不能跳过已知child集合，packageSTOPPED/no-record不能自动清理活资源目录。
不运行B/H未准入SIGKILL脚本，不globaldiscover，不以杀随机sleep进程称业务恢复。
验收：每个风险从独立合法positive开始且到达目标边界，保留失败与known/unknown完整证据。
只挑真实新增/尚未证实窗口，有限deadline，不重复无变化长soak或全历史矩阵。
source交接发布精确故障recipe、资源身份、数据/pointer/操作前后和未达范围。
产品拒绝和工具收尾分层，任何fallback不会把原功能FAIL改成PASS。
修复ownedsource后持续其他独立工作，跨owner最小需求给main/E，不改其权限/断言。
本成果是可处理并解释失败，不是强制把所有失败目录清空。

### D12 发行复现、指南与完整成果索引

实现范围：另一个开发/同事按版本固定指南重建/校验/使用/升级/备份恢复/support并定位问题。
actual消费者为现有build/stage/freeze、包内帮助、Eoracle及私有诊断，不另造tracker/gate/ledger。
源/锁/外部依赖/license/ABI、tar/manifest/entry/asset与实际功能范围可逐项追溯。
必要正向：R1与R2各自准确recipe和报告，不用当前HEAD改写旧候选身份。
必要负向：缺文件/跨source/错包/覆盖输出、陈旧文档、不完整资源或缺实际consumer时准确拒绝/未达。
用户指南按真实工作台/模板/窗口/来源入口，短流程不宣称48h/native/效率收益/多机器支持。
支持材料私有去敏可复现，旧state/profile/tar/ledger/dirty与全部失败记录保持。
验收：三个交付包、十二成果都有source/consumer/正反/命令exit/时间/元组和明确完成条件。
source交接最后汇总wave31-status与稳定接口，早中晚检查点后持续wholegoal而非小修停点。
只explicitownedpaths推原origin，不upstream/reset/清历史，无新模型allowance。
未达B原Work恢复/private/target/value准确单列，不拿ordinary结果抵消。
R2运行字节若没新变化，最终报告修补不要求又冻一份R3同字节。
本成果完成是可持续复现与同事交付，不是多一个release标题。

## 独立备选队列

R1等E安全工具：source/tar、数据consumer、指南/support继续，不使用危险forceproof补验。
R2main0080slice未发布：锁R1继续同事试用/迁移/恢复工具，交最小依赖需求，不私造HTTP/authority。
A/C或B/private/target未到：ordinary与readonly数据链继续，缺能力准确未达，不删marker/queue/unknown。
所有外部等待有限，source早发持续推进，旧预算/十二用户资源和历史材料保持。

## 整包完成条件

三个连续交付包的十二成果均有真实实现、actualconsumer、完整positive/必要negative、source及可重复命令exit。
R1固定829，R2固定实际新元组，D/E同tar对齐；docs/tool变化不移动候选，未集成能力不写成已支持。
完整birth资源集合和逐次fresh、UNKNOWN保留、不global发现/误signal规则所有路径一致。
ordinary/functional/datarestore/native/private/target/value分别结论，0真实vendor/model/native和原blocked预算不变。
十二用户实例与全部state/profile/tar/ledger/dirty保留，无桌面/CAC/autoaccept/新Driver/第二ledger或授权生命周期。
