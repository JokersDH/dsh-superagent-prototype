# G：真实insights窗口、行语义与导出交接

日期：2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-g`、`codex/g4-usage-insights`。
保留历史并合并最新origin/main，读AGENTS、START-HERE、product-spec/README与[本轮README](README.zh-CN.md)。
读[0073实际模板表单](../../docs/rfcs/WP-16/0073-main-project-recipe-preview.md)、[0074架构与验收](../../docs/rfcs/WP-16/0074-wave-29-architecture-and-reviewed-inputs.md)、[0075完整产品包](../../docs/rfcs/WP-16/0075-wave-29-product-completion-packages.md)。
wholegoal覆盖24阶段，无token预算；G4/G8/G12/G16/G20/G24六完整结果，source早发布后继续。
正常节奏无当日deadline，实际能力/数据范围决定完成，不按轮次/人数/测试数提高准入。
仅拥有 `packages/usage-insights/`、`tools/usage-insights/`、`reports/usage-insights/`，状态写 `reports/usage-insights/wave29-status.json`。
main拥有授权/publicreader/API/App/根契约/锁，F拥有trial UI；G的raw Node分析只在server，不抢root或另造collector。

旧nested总cap和永久tombstone已真闭，主线已集成合格G source，当前c5为facing变化，不再重派旧修。
实际统计endpoint是 `/v1/insights`，围绕原7/30天输入/DTO消费；不要固定过时文件名或说主线路由缺失。
保留main独立50works/10000nested/2MiB/2s、authorizedreader、quarantine拒绝与header Work样本口径。
新1ba有统计但J无；main0073模板为独立新runtime，不把source进步贴旧包或统计结果当模板/执行权。
source enumeration coverage和row metric coverage分开，UI active依旧partial proxy，currency/unknown/metricid真实稳定。
不新增collector/gate/ledger/数据库，不研究价值、价格、模型计费配方，不用缺数据估零或补真实样本。
原state/profile/tar/ledger/dirty和十二服务5180/8796至5191/8807保持，不读其他home凭据/私有SQL。
真实vendor/model/native0；BUNKNOWN不可花，Epilot24turn/200000token/USD5/oneflightBLOCKED不reset/refund/补样。
每个结果有actualsource/输入digest/项目/窗口/单位/层/来源/覆盖/命令exit和明确未达，wholegoal持续。

## G1 固定当前insights接口

读实际 `/v1/insights` 请求/响应schema、主线publicreader和server分析到F displayDTO，按当前代码路径定位。
记录c5 facing变化与已集成版本差异，不把main ownscope/budget/admission适配当缺功能或要求重复collector。
验收endpoint/参数/返回/来源输入表准确，既有scope边界与旧闭合结果保留。

## G2 server与display契约

Node analyze/crypto/collector只在server，browser仅验证后的displayDTO，禁止raw evidence/credential/privatepath入包。
适配actualmain请求和字段，root依赖/导出/锁需求交main，不改App/F/HTTP授权。
验收实际调用与严格类型，不只local mirror接口可赋值或静态字段清单。

## G3 当前source/window/header口径

header样本按main实际枚举Work，行sample按各metric真实样本，generic outcome count不改header含义。
scope.projectIds/aggregation与7/30窗口来自已核输入，不从label猜，wrongproject不展示当前项目总数。
验收合法当前DTO与foreign/missingwindow/缺coverage，unknownCount无一致口径则null。

## G4 第一结果：当前API消费者适配

交actualmain `/v1/insights`→server分析→当前display/F consumer的可运行适配和完整positive/negative。
保留主线独立授权/预算和原Node组合，不建第二reader/gate修正结果。
发布source后继续G5–G24，不等新安装包才完成自己的工具。

## G5 两项目受控真实来源

用私有装置原公开入口产生两项目Work/Q&A/check/candidate/manualaccept/ReviewTiming，0真实model/native。
原subject/contract/attempt/source关联准确，同名Work不靠文字join，fixture/operator/native分层。
验收当前publicreader实际获得的字段与未知，不私读SQL或回填收益数据。

## G6 7/30天与窗口边界

按原接口测试7/30参数、时间窗起止/时区和重复观察，不要求真实运行30天或制造虚构历史。
source无历史覆盖时按可得性标partial/unknown，只有完整枚举的真空窗可测零。
验收entry.at/outcome.observedAt正确过滤，currentattention snapshot不混成历史积压。

## G7 分页、损失与重复观察

cursor/digest/source改变、权限拒绝、慢读取和总deadline遵循既有collector语义，不另开无界路径。
重复receipt/outcome/文件重读不双算，坏来源和未读不能变completeempty，known subset保持来源。
验收合法全窗positive与有限损失negative，原输入/旧报告不被覆盖。

## G8 第二结果：同来源7/30观测

交同一两项目public读取、7/30过滤/重复/缺历史的准确Node/CLI/API一致结果。
记录真实范围/原ID/inputdigest/窗口/来源损失和未测operator/native，不拼不同subject示例。
发布后继续source枚举与rowpartial，不以增加测试或benchmark替实际语义。

## G9 source enumeration coverage

overall完整只说明实际来源枚举在限额内完成，受限/拒绝/截断/权限损失不归零或填完整。
保留main预算接受前检查和quarantine拒绝，source loss/stoppedBy/unknown能追到原reader。
验收完整、部分、missing/not_collected/unsupported的同口径结果，F不需手工过滤修G数。

## G10 行metric coverage与proxy

ReviewTiming.activeMs即使source完整也依然partial visibility/focus proxy，不是人工思考/节省工时。
每行known/unknown/excluded/sample/layer/unit/currency分别保留，overall badge不能自动补绿代理行。
验收同一完整输入下source complete与row partial同时正确显示/导出，不制造效率因果。

## G11 usage与真实端点

缺input/output/reasoning/cost组件保持unknown，不假设订阅免费、查价或把缺成本补零。
queue只用真实queued/dispatched配对，duration/attentionage不改名queue，缺端点null。
验收有记录known子集与全未知，controlled/protocolfixture不升级nativeusage证据。

## G12 第三结果：coverage分层完整结果

交source枚举、rowpartial、usage/时间/unknown完整语义及真实display/report案例和负例。
source完整不宣称metric完整或收益，缺baseline不输出提升率/质量评分。
发布后继续稳定metricid、currency与可用导出。

## G13 metricid与行身份稳定

同metric不同layer/currency有稳定唯一row identity，排序/重复读取/窗口切换不碰撞或丢行。
count输出裸数字，unit/currency与值的呈现职责清楚，不双加后缀或把数值变难解析自由文本。
验收实际facing与main/F字段相容，当前c5变更不引入新的行语义或header误计。

## G14 currency与混层边界

不同币种/单位不合并，actual_native/controlled/protocol_fixture/schema/operator_note保持原provenance。
productinteraction事实与outcome样本分开，readiness/configuration不计入执行/质量/成本/收益。
验收混币种/未知/0分母/不同聚合与缺scope不做错误比较或转换。

## G15 导出数据与报告

沿既有analyze/report/verify和主线公开DTO做有界JSON/可支持格式导出，不新增collector或持久统计ledger。
导出保留project/window/sourcecoverage/rowcoverage/metricid/unit/layer/currency/sample/unknown和输入digest。
验收显示与导出同一数据语义，超rows/bytes明确截断或拒绝，不把截断报完整。

## G16 第四结果：稳定行与有效导出

交当前实际消费者、稳定rowidentity/币种/unknown以及可用导出/回看完整流程。
格式/字段新需求由main/F消费，G不在UI侧重新分析或绕过主线来源选择。
发布source后继续隐私/工具和当前包交接，不停在字符串格式修补。

## G17 CLI source与只读输入

命令明确当前Node entry/source/dist和inputdigest，陈旧build不悄悄分析，重复观察不覆盖/双算。
复用既有explicitloopback GET/streamingbyte/deadline/redirect拒绝和regularfile/digestpin适配。
验收真实合法输入与badargs/auth/slow/digest/limits，原数据/输出字节保持。

## G18 隐私与不可信文本

分享报告不含secret/原文/绝对路径/header/stack，free text转义且无任意HTML/link/命令入口。
输出0600独占新路径，rows/diagnostics/size有界，失败只清理精确自己创建临时材料。
验收canary/hostiletext/existing/symlink/diskfailure，不因脱敏丢失必要来源损失事实。

## G19 当前main真实App消费

给main/F actualdisplay数据和最短两项目7/30流程，四navigation/readiness在统计不可用时照常工作。
明确进入视图才采集，project/auth identity隔离late数据；G不改App/transport/Fsrc或授权。
验收当前合法row与错scope/缺window/partial/unknown真实消费，独立harness和实际App分开。

## G20 第五结果：日常工具与真实呈现

交CLI重复观察/私有报告/导出和当前App实际规则的完整结果，准确source/方法/未达范围。
0073模板是独立预览/确认能力，不从recipes/readiness数据推执行次数或收益。
发布后继续准确新包消费者、预算与最终支持。

## G21 必要新包交接

D交含当前G/J/main source的exacttar后，核package exports/deps/Node entry与display/API真实字节。
1ba有统计但J无，旧1cd无统计、ce64旧scope各自保留，不把source结果贴旧安装包。
验收source/build/hash/schema/ABI/entry一致，E独立required，缺包只阻installed项。

## G22 有限预算与新风险回归

只对本轮facing/API/导出改变的风险做有限bounds/unknown/scope/隐私控制，旧nested/tombstone不重派。
保留总records/events/works/pages/streambytes/deadline接受前约束，不为benchmark放开cap或补真实样本。
验收实际规模/环境/耗时范围准确，短测试不称长期soak或跨机器性能。

## G23 文档与维护口径

更新实际 `/v1/insights`、7/30窗口、source枚举与rowpartial、metricid/currency/unknown、导出/Nodebrowser边界。
删除过时“主线路由未实现”概括但保留准确未达，operatorbaseline无来源不输出因果/收益。
验收独立开发者从显式输入复现Node/CLI/F/包，不需要另一分析器/ledger或私有SQL。

## G24 第六结果：完整观测交付

交当前API适配、同来源7/30/coverage/稳定行/导出/隐私/实际消费者及同包handoff，更新wave29-status和六检查点。
只原三路径推origin原分支，wholegoal未达继续，不改root/F/A/B/E或清dirty/旧报告。
保持0真实vendor/model/native、原blocked预算、十二服务及全部state/profile/tar/ledger，无新collector/gate/ledger/Driver/CAC/desktop/autoaccept。

## 独立备选队列

D新包未到：actualmainAPI/source/当前F规则与工具导出继续，installed准确待验，不贴旧tar。
operator/native历史未给：受控/unknown范围仍完整交工具，不补样/价值价格研究/新billingrecipe。
其他owner缺项：最小明确输入和可调用结果先交，继续独立阶段，不等全团队或抢source权威。
