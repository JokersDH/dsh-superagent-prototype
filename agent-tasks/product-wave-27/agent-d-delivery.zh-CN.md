# D：精确恢复例外与持续兼容发行长包

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-d`、`codex/g3-local-distribution`。
保留历史并合并最新origin/main，读AGENTS、START-HERE、product-spec/README与[本轮README](README.zh-CN.md)。
读[0068通道与配方输入](../../docs/rfcs/WP-16/0068-coordinator-channel-and-project-recipe-inputs.md)和[0069十Agent续包](../../docs/rfcs/WP-16/0069-wave-27-ten-agent-continuation.md)。
建立或沿用覆盖20阶段的wholegoal，无token预算；D4/D8/D12/D16/D20五个完整可运行结果，提交后继续。
用户取消今天完成目标，按正常工程节奏与门槛推进，不赶发布或为文档重冻。
只拥有 `apps/launcher/`、`packages/portability/`、`tools/distribution/`，状态写 `tools/distribution/reports/wave27-status.json`。
main拥有根契约/配置/锁/HTTP/UI/授权，A拥有追加迁移，E拥有独立required；十外部A–J加main各守拥有路径。

保留ce64普通一致候选：D完整6754项、closure96/96和E真实F App/readiness164required已通过。
同包E238PASS/0FAIL/16NT、真实截图/asset哈希是实质进步，不再派重复旧目标验收。
已关逐次signal fresh、childconfig/argv和mixedunknown负例保持，不重做旧安全修补。
原分支、dirty、所有state/profile/tar/ledger、历史失败与旧scope全部保留。
新重点是artifact/FTS/event例外的精确目标内容证明、两个format的真实同包消费与可持续发行。
新F hook或I/J/G仅在稳定接口与main实际组合后才进入必要后继，不能按分支存在宣称已集成。
普通安装/读取独立于B恢复/private/target/BLOCKED试点；逻辑恢复证明不等于物理writer静止或启动许可。
每个结果交source、有限命令/exit、准确tuple/consumer/data、完整positive/negative和未达范围。
发布检查点后继续独立阶段，不把局部PASS、文档计数或E待验当整个goal完成。
依赖只阻对应结果；给最小真实port需求，不创建另一套ledger/授权权威或复制A SQL。
source检查点同时记录实际工作树状态，未提交A/C候选不得被误称主线已准入代码。
用户数据不作为fixture输入，已有probe材料也须明确source/root/方法才可复用。
包内运行入口和开发工具入口分别给hash，当前checkout不能补冻结包缺失能力。
正常节奏以完整结果推进，短时观察仅说明实际测得范围，不承诺未执行的长时稳定性。
所有跨owner问题给准确最小复现，自己的独立队列继续，不要求团队同步停等。

## D1 固定当前候选与恢复输入

固定实际D HEAD、ce64不可变tuple、A/C producer/consumer source及每个restore-report实际身份。
新输入表区分原Store、manifest、snapshot、目标根、安装包和运行entry，不以路径名/文件名充当format证明。
保留旧dev-only/中间失败文件但标明最终证据优先，避免过时NOT_EXECUTED覆盖后来真实链。
核原target、binding/attempt/contract、question/answer/native_applied字段与实际producer关联。
验收输入表能由E独立复用，不需要猜临时根或读取其他用户state。

## D2 artifact内容与引用完整性

消费A/C已发布的内容proof，核原artifact引用、实际bytes/hash、缺失/新增/替换与完整coverage。
不能只比较artifact表行或把允许操作变更解释为忽略全部artifact；变更例外需绑定确切subject与原因。
合法原副本positive后，分别改变bytes、换同名引用、删required artifact、增加未声明内容，准确拒绝或明确未覆盖。
D只做包组合/只读断言，新的schema/proof需求交A/C/main，不私写生产SQL或第二验证权威。
验收错误在正文/候选被采信前可定位，未知不变成空artifact集合。

## D3 FTS与event操作例外精确化

区分可重建派生FTS与原业务内容；不能允许任意FTS行/搜索结果变化却仍声明原subject匹配。
event/coordinator/heartbeat等例外必须对应确切自有操作/字段/receipt，不把整个family排除。
用独立合法positive覆盖合法重建、合法本次记录、外来event、原消息篡改与额外业务结果。
保留writer/物理资源屏障，允许逻辑操作变化不能证明旧writer已停或解除执行隔离。
验收每个allowed/forbidden delta有真实原始差异、约束和拒绝原因。

## D4 第一结果：可独立消费的精确内容proof

交artifact/FTS/event例外组合recipe及完整正反控制，引用准确A/C接口和实际source。
报告确切允许transform/subject/字段，不能只交integrity/schema PASS或原路径相等。
新的proof源码未到只阻对应项，ce64普通候选和发行工具独立工作继续。
第一结果应让E重推每个例外，不把D自测当独立release结论。
发布后继续D5–D20，已有安全控制不因新例外退化。

## D5 两format真实同包链

同一次原Store由A创建/验证1与2，各经独立restore consumer到不同新根，再由C唯一manifest模式驱动。
顶层driver format和实际snapshot/restore-report必须一致，不再让v2文件里的默认v1标签充当版本事实。
每根分别验证target fingerprint、原Q/A/native_applied、answer digest、Work、候选和源正文守卫。
开发driver可外置但entry/hash明确，实际CLI/API/正文consumer必须来自准确安装包。
验收合法整链与独立target-only drift拒绝，保留已有21断言双根成功范围。

## D6 两根来源与运行身份

将producer source、A模块、C工具、原manifest、目标报告、包source/tar及进程身份分别绑定。
禁止用合成SHA、opaque echo或同根字符串代替真实期望和内容映射。
actualPID/start/APIstart、requested/live digest、scope与完整coverage缺项必须未达/拒绝。
不会为了probe删writer记录、marker、旧队列或忽略任意源变化。
验收每个数据路径可回到原subject，格式不同不等于另一个执行生命周期。

## D7 精确漂移与故障组合

独立positive后测试两根交叉、合法消息漂移、artifact替换、FTS异常与外来event，不重复使用已坏签名。
prepare/start/读取/cleanup和总流程有deadline，未知资源保留材料，每次signal前fresh继续保持。
证明错误目标不返回正文或候选，readiness与恢复描述仍authorization none/not_granted。
源有效/目标失效与源失效/目标未改分开记录，避免把一类故障当另一类证明。
验收负例确实到达目标检查点，不用早期schema失败凑通过。

## D8 第二结果：精确双format安装包整链

交两个真实format、准确metadata、内容例外与独立漂移的完整可运行包内流程。
D最后成功证据、中间失败和旧限制同时保留，E能找到哪个输入实际产生哪个结论。
E独立链未到只写待验，不能撤回D已有真实双根进展，也不能自授全部恢复准入。
第二结果是原subject到准确包消费者，不只是两个独立工具各自成功。
发布后继续新组件输入与必要后继发行，不等待B/private/target。

## D9 F新hook与main实际组合

消费main实际接入F `{enabled, identity}` hook及scope/window/coverage字段的source checkpoint。
核原四导航不变、auth/visibility/identity行为和普通对话草稿保留，不在D修改F src或App。
只有实际main source进入构建才声明新组件已集成，不把F独立harness结果贴旧ce64。
根锁/契约/配置需求由main处理，D更新准确闭包与包内consumer清单。
验收clean build/stage与source一致，新增界面不自动发送模型或执行任务。

## D10 I/J/G稳定输入的兼容发行

I attach-channel与B生命周期、J project-recipes与F UI、G可信summary各按0068实际接口接收。
未进入main默认路径的模块只列开发输入，不为分支存在或单测PASS扩大产品能力。
新依赖/平台前提/ABI/entry和license在closure准确记录，不从global安装补缺项。
兼容性差异交对应owner/main，不接管I/B通道、J模块或G统计权威。
验收原ce64能力不退化，缺组件真实降级/未提供，不让fallback调用真实profile。

## D11 必要后继freeze

运行字节确实变化后以clean实际source冻结一个准确后继，记录完整tuple/hash/schema/ABI及file/link闭包。
ce64与所有旧tar保留，docs-only或E测试工具修补不触发相同字节重复冻结。
运行字节先freeze再E最终，main先发source不等E；给E已经存在的准确输入。
UI/API/contracts/launcher和readiness同source，开发工具与产品entry分开。
验收重读tar即能恢复完全相同身份，不覆盖、重命名或改标旧包。

## D12 第三结果：稳定组件同包候选

交main实际组合的新F/合格I-J-G输入及必要后继，未集成项清楚列出。
给E独立required、H只读preflight和新I/J消费者最短准确recipe，不交猜测路径。
第三结果是可运行可验证的新包，不以文档列表或旧scope假装全部已集成。
无新运行变化时继续使用ce64，正常节奏收口，不追一个已取消的今天完成目标。
发布后继续普通安装、升级和同事试用。

## D13 普通冷装与多state

全新private根有限cold/no-executor/multi-state，模式、config/data/port与包identity一致。
无执行器不回退真实CLI/profile或fixture；普通讨论/历史读取与执行未就绪清楚分离。
same-file REUSED需原PID/start/health，不同选择/根/端口/登录明确拒绝且原实例不变。
只处置独立证明自己出生的完整资源，每次signal fresh，unknown保留state/material。
验收用户十二实例和全部旧数据不参与测试或清理。

## D14 升级回滚与数据保护

安全旧包→准确候选及16→18核exit/status/pointer/operation/data和完整资源集合。
未知live资源阻断切换，保留升级后新数据，不用旧快照覆盖它制造rollback成功。
只扩本轮新风险与必要positive，旧危险路径仍mock，不无限重复历史全矩阵。
两个start不冒充managed upgrade，报告变更不要求再次冻包。
验收每一项与当前candidate/consumer匹配，跨机器/ABI未测如实记录。

## D15 重开与同事流程

同包prepare/start/reuse/拒绝/stop后重新prepare/reopen，原数据可读、完成请求不重发。
有限刷新/SSE/并发只读观察provider/queue/FD/连接与子资源回归，短序列不称长期soak。
使用真实F入口和J草案预览时保持main确认，导航/模板选择不自动创建Work或run。
F用户反馈和H原始观察给准确复现，D独立核生命周期不从summary获得停止权。
验收常用路径能由同事在自己根执行，错误给出可理解下一步。

## D16 第四结果：同包安装升级重开

交准确候选cold/reuse/multi-state/upgrade/reopen的完整有限结果与原始材料。
E测试工具出现ownership问题时先停危险重跑，修测试工具不要求runtime重新freeze。
产品缺陷只改D拥有路径，跨owner给source/tuple/command/exit复现，不修改E断言。
第四结果具备真实同事试用recipe，未测能力不因普通成功外推。
发布后继续support、源码兼容与最终文档收口。

## D17 私有支持材料

support新输出0600、脱敏、不覆盖，不含token/model key/native credential或旧可执行授权。
保留失败的确切operation/资源/包身份，unknown不改成空集合，不先删活根。
与H只读诊断输入对齐，不让H接管安装/停止/迁移，也不读其他home凭据。
支持材料足以复现但不泄正文或私人路径，允许范围按实际产品规则。
验收canary、已有输出、部分失败和缺观察，错误不被吞掉。

## D18 源码与包闭包兼容

复核root要求、launcher全部runtime、portability exports、console/API与外部依赖/license/ABI一致。
新平台只按真实测量列支持，不能复制本机node_modules称跨平台或把unknown判兼容。
现有schema/版本协议兼容和恢复marker/队列语义保留；迁移追加且只由A拥有。
source、tar、安装入口、内部link和release manifest哈希逐项准确。
验收最小可复现build/stage/freeze命令，未测平台/Node组合明确。

## D19 指南与证据归并

给同事包选择、预检、工作台、模型/项目配置、审阅、升级/重开与问题上报最短步骤。
说明ordinary、controlled fixture、native及恢复授权边界，不靠内部模块名或过期缺口误导使用者。
整合F/I/J/G/H输入时保留实际source/layer/coverage，E独立结论不可由D总结替代。
旧成功与新阻断分别写，文档/报告不推动相同字节机械重冻。
验收索引能找到每个最终结果的原始命令、exit、时间和准确subject。

## D20 第五结果：完整可持续发行交接

交精确内容proof双format、稳定组件候选、普通安装升级重开、support/兼容指南和五source检查点。
更新wave27-status及剩余门槛，wholegoal未达继续独立队列，不以checkpoint停工。
只拥有路径推原origin分支，不upstream、不清dirty或旧证据，不赶已取消的日期目标。
vendor/model/native0；Bcap4 UNKNOWN不可花，Epilot24turn/200000token/USD5/oneflightBLOCKED，不reset/refund/补样。
保留十二组5180/8796至5191/8807与全部state/profile/tar/ledger，无新Driver/CAC/desktop/autoaccept。

## 独立备选队列

A/C精确例外未到：继续ce64普通试用、包兼容和support，不发明宽松ignore或第二proof权威。
新F/I/J/G source未组合：准确列未集成，ce64仍可复用，不为分支/文档频繁freeze。
E/H/B/private/target未到：独立ordinary结果继续，unknown/历史/账本保留，不扩大执行授权。
