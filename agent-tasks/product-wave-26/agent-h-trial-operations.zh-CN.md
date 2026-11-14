# H：安全只读工具与合法恢复输入支援长包

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-h`、`codex/g4-trial-operations`。
保留历史并合并最新origin/main，读AGENTS、START-HERE、product-spec/README与[本轮README](README.zh-CN.md)。
读[0066主线试用工作台](../../docs/rfcs/WP-16/0066-main-trial-workbench-integration.md)和[0067完整产品包](../../docs/rfcs/WP-16/0067-wave-26-integrated-product-packages.md)。
建立或沿用整包goal，无token预算；H4/H8/H12/H16四个完整可运行结果，提交后继续。
只拥有tools/trial-kit、tests/operational-soak、docs/internal-trial、reports/trial-operations四个原子树。
状态写 `reports/trial-operations/wave26-status.json`；不改B runtime、A SQL、D生命周期、E断言、main根契约/锁/HTTP/UI。

上轮20/20模块测试与真实600/1800fixture运行保留；301/601样本和392预期断流不改绿或重标产品soak。
先修REFUSED后包执行、token链接/权限、Node范围上界与raw时间checker四个实测缺口。
本轮增加 `tests/operational-soak/recovery/` 合法零模型输入支援，帮助B/main结束invalid harness循环。
它只复用原ProductRuntime/Broker/A公共store和已准入B port，不创建新coordinator/ledger/授权权威。
所有试验写自己新fixture根，个人state/homecredentials/native profile与十二旧服务从不参与。
H观察不是releaseauthority，E独立required；F/G得到准确去敏输入，不越owner集成产品。
每个结果有真实source/命令/exit、明确subject和方法/时间，unknown不等于PASS。
纯parser/报告修补不机械重跑40分钟；新风险有必要才做短时有限复验。

## H1 REFUSED之后零包执行

machinecheck在preflight拒绝subject/hash/file/manifest后立即停止，不再执行help/status/doctor或可选support。
只允许准确已核包通过必要完整性边界后进入显式allowlist命令，兼容性unknown与完整性拒绝分开。
完整tinyfixture positive后，错build/source/hash、损坏文件、缺manifest各自断言包命令调用数0。
拒绝保留私有报告与准确错误，不从存在bin/pa推断可安全执行，不回退其他CLI。
验收pure调用捕获及有限真实无副作用fixture；不要用用户包的失败命令演示拒绝。

## H2 凭据文件与成熟版本范围

token文件用NOFOLLOW及descriptor fstat核regular/private0600/owner/nlink，symlink/hardlink/替换/FIFO有限拒绝。
token只来自显式文件或显式env名，读取有硬大小上限，值不入日志/错误/诊断包。
采用成熟semver能力验证上下界，依赖需求交main锁定，不越权改根lock或依赖全局安装。
未支持的版本语法保持unknown，不把较高major自动判通过；旧>=23<24对24.21必须拒绝/告警。
验收完整private文件/合法range positive与链接/权限/边界/语法负例，所有canary均留在自有根。

## H3 原始运行checker独立核时间与样本

从startedAt/endedAt、monotonic elapsed及sample.at/elapsed独立推导持续时间，不信wallElapsedSeconds摘要。
核hash/count、时间单调/cadence、首末覆盖、失败/断流/清理与计数矛盾，材料读取/条数/字节有上限。
样本路径绑定run根、regular文件与明确允许边界，不跟随外部链接或读取任意home材料。
真实600/1800positive保留；endedAt等于startedAt却声称600、样本早停、乱序、漏失败分别拒绝。
验收checker不能因summary自洽而通过与原始时间/样本矛盾的输入。

## H4 第一里程碑：硬化的完整只读工具

交REFUSED零exec、安全token、成熟版本和rawchecker完整positive/negative及可运行CLI。
H原20/20可引用，新缺口要独立证明，不为纯校验修补重复两项长fixture运行。
报告说明既有长运行真实且限fixture，checker曾有缺口不抹掉其实际样本。
第一结果必须能安全给其他Agent使用，不只交零散修补或宣称readonly。
发布后继续H5–H16，main依赖未到仅阻对应semver组合不阻其他工具工作。

## H5 准确当前包preflight

消费已给a826或必要F App新main后继，显式tar/install/artifact/expectation和自己新输出根。
核source/build/hash/bytes/schema/Node/ABI/平台/依赖/file/link闭包，目录名和旧标签不作身份。
不安装依赖、不迁移DB、不写个人state，不拿checkout补包内缺项。
限制归档成员/路径/展开/总字节/时间，失败不继续执行包；原输入前后身份核对。
验收完整实际包只读结果与tinyfixture负例分开，跨机器/ABI未测如实unknown。

## H6 readiness与诊断的同subject只读消费

只按实际GET /v1/readiness/schema请求明确自有loopback目标，认证显式、deadline/字节限额、禁止redirect。
readiness只是配置事实；缺包身份继续package_binding unknown，不从ready字段获得执行授权。
核plainHTTP实际成功、401/500/timeout/未知字段/陈旧观察，失败payload不当有效readiness。
包help/status/doctor仅在完整性通过并指向自己新根执行；support不自动打开个人数据库。
验收包身份、远端观察和fixture来源分开，缺接口准确unsupported而非猜endpoint。

## H7 去敏诊断包和完整正负材料

输出0600/新根0700/no-overwrite，token/key/credential及个人根脱敏，未知资源和失败事实不被抹掉。
构造secret canary、已有输出、坏权限、部分失败、超大材料与来源不符控制。
保留足够source/tuple/operation/命令/时间/错误码供E复核，不含旧可执行授权或native session。
F/G获得去敏且明确layer/coverage的方法输入，H不签release或效率收益结论。
验收失败时报告仍可追溯且不泄密，不用吞异常或空集合制造成功。

## H8 第二里程碑：准包预检与诊断闭环

交准确当前不可变包的preflight、readiness、允许命令和诊断材料，完整正反与副作用证明齐备。
同事可在另一新根重复，拒绝结果不执行包、输入包不改、个人state不碰。
给E原始数据和CLIexit，E自行required；G错scope或未核工具不当authority。
第二结果是可用内部试用工具，不依赖B恢复或BLOCKED研究才交付。
发布后继续合法恢复fixture支援和新的短时观察。

## H9 合法零模型journal/native-fake输入

在 `tests/operational-soak/recovery/` 用现有schema/协议生成最小完整合法fixture，先通过实际解析正对照。
覆盖原journal producer/source/seq/payload kind/ref/bytes与认证登记事实，不用错字段演示恢复能力。
native-fake只能显式本机fixture，协议方法/审批/receipt遵循原消费者，绝不回退真实CLI/profile/provider。
输入与expected IDs/tuple/manifest绑定，命令/事实来自原API路径而非手写SQL或另造receipt-only服务。
验收合法解析与身份/帧/长度/缺字段/foreign source负例，失败发送/执行数0。

## H10 复用原ProductRuntime与Broker/A消费者

用原ProductRuntime、QuestionBroker、A公共store/UoW和已准入B port组合私有测试，不能新建第三coordinator或ledger。
产生真实原Work/attempt/question/answer/native_applied测试事实，命令、observed、result、unknown语义保持。
fixture state全新私有，model/vendor/native真实调用0；原用户数据、B历史账本和profile只读不进入fallback。
未准入B通道只能记录缺项并做合法fixture/datareader/拒绝，不以mock状态宣称业务恢复完成。
验收正常链的原ID、actual callback/receipt与读取结果一致，帮助B定位到协议或原消费者的真实输入。

## H11 有界故障recipe与可复用交接

准备原API消费者合法normal positive后，给begin/answer ACK/receipt/断流/大journal有限故障输入。
每例有精确source/tuple、截止、原始帧/错误code与send/observe计数，避免invalid harness掩盖产品缺口。
H不修改B运行时、mainguard或A SQL，不为旧probe新增空方法或绕过授权。
若需自有进程，先独立证明出生PID/start/argv/root/config/operation并每次signal前fresh；否则用同进程fixture。
验收能由B/main直接消费且准确区别fixture正常、拒绝、未达业务重连，不把副本数据叫跨进程恢复。

## H12 第三里程碑：合法恢复测试输入包

交实际可运行normal fixture、原API/datareader、故障recipe与完整正反证据，接口/entry/hash明确。
B未合格时仍交可用合法输入支援，业务resume准确NOT_REACHED，不继续重复无效journal循环。
不接管B实现或D生命周期，零模型边界、原唯一执行生命周期和公共权威保持。
第三结果是B/main能直接调用的工具，不只是文档里的假payload或另一个协调器。
发布后继续当前产品readonly观测与同事试用交接。

## H13 真实产品readonly与SSE有限观察

只对显式提供、独立证明自有的目标做GET/readiness/SSE/客户端重开，不自动start/stop/migrate。
fixture和产品、工具source和包source分别标识；SSE重连不冒充daemon恢复。
按新风险短时复验HTTP失败/断流/资源归还，既有600/1800实测原样保留，不机械重跑40分钟。
请求/连接/响应/采样/总场景均有边界，原始失败/unknown不改绿，时间只按实际测量。
验收无真实模型/命令/个人state写入，缺观察标unknown而非声称无泄漏。

## H14 原始观测和E独立核验输入

记录明确tool commit/hash、scenario、input tuple、root、实际起止/elapsed、样本hash/count/cadence。
E独立从材料重推结论，H的CONSISTENT/COMPLETED不是发布或授权凭证。
G获得layer/coverage和fixture-vs-product范围，F获得用户可理解的实际故障，不输出混合scope指标。
缺产品目标时在同进程fixture继续有限控制，产品观察准确未达，不读取用户十二服务补样。
验收跨包、缺字段、矛盾时间/样本与敏感值均被拒绝或清楚标记。

## H15 同事指南、迁移辅助与复现材料

更新当前包选择/readonly预检/四actions/readiness/诊断/问题复现指南，按真实main F App入口说明。
迁移只预检兼容/磁盘/路径/backup身份，实际安装/停止/升级由D/main已准入入口负责。
不复制credential/session/授权、不清marker/force switch，不自动修个人数据库。
和F/G/E对齐实际输入与限制，文档问题不让D重复冻包，必要运行变化才后继。
验收复现命令可执行且安全，不把内部字段、未实现接口或宽松fallback交给同事。

## H16 第四里程碑：完整支援与观察工具包

交硬化预检/诊断、合法零模型恢复输入/原消费者recipe、当前产品readonly短观察及完备同事指南。
更新wave26-status、四检查点、真实命令/exit/来源/时间/未达范围；wholegoal未达继续独立阶段。
仅原四拥有路径推origin原分支，不改生产/E断言/根lock，不清dirty或旧证据。
vendor/model/native0；BUNKNOWN不可花，Epilot24turn/200000token/USD5/oneflightBLOCKED，不reset/topup/refund/补样。
十二组5180/8796至5191/8807及全部state/profile/tar/ledger保留，无新Driver/CAC/desktop/autoaccept。

## 独立备选队列

main成熟semver依赖未到：严格unknown而非自造宽松解析，其他安全边界/诊断/fixture继续。
B port未准入：实际合法fixture/原API normal/datareader和负例先交，恢复业务准确NOT_REACHED。
新包/真实自有目标未到：已给a826只读预检、同进程短fixture和指南继续，不执行用户生命周期或真实profile。
