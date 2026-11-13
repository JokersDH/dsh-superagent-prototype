# E：完整拒绝门槛与准确新包独立验收整包

继续 `/Users/hh/Desktop/joker/superagent-agent-e`、`codex/g3-product-acceptance`。
先读 START-HERE、product-spec/README、本轮 README、WP-16/0060/0061 与本轮 D/E验收报告。
建立或沿用覆盖整个结果包的 goal，不设 token预算；三个可运行里程碑后继续独立阶段。
仅修改 `tests/product-acceptance/` 的断言/工具/证据；生产源码、根契约配置锁、HTTP/UI归 main，迁移归 A。
状态写 `tests/product-acceptance/reports/wave23-status.json`；保留所有历史 untracked runs和旧source/tar结论。

本轮保留真实595普通范围：200PASS/0FAIL/15NOT_TESTED，包内consumer四文件匹配，实际REUSED及PID/start/digest正确。
main8c8fdef 已完整集成普通发行源码；D有不可变a9b后继，但尚无该包E最终结果，不能重贴595结论。
先补 required reuse gate 的四项缺失/矛盾拒绝，再独立测准确a9b或必要main候选，不把真实旧scope抹成全部失败。

## E1 固定真实完整正对照与范围

固定当前E HEAD、clean测试源码、最终595 run、tar/source/build/schema/ABI及完整required集合。
使用真实完整报告作为installed-alpha正对照，不合成whole green报告，不降低required集。
保留原595实际个人读取/同包来源/复用/安装测得范围，旧e4e真实reuse FAIL仍独立存档。
full-product、native、value未达分别保留；161 required通过只说明原工具定义的普通范围。
验收：准确原报告在记录时间下通过，当前重验的时间/源码/输入另记，不伪装为历史运行。
任何新包先核不可变tuple再测，测试源码身份不代替产品包身份。

## E2 required gate 拒绝缺失过程身份

修 `reviewReuseIssues` 中 processes可缺失而通过的情况，明确必须有实际原/复用进程身份。
PID、process start与实际实例关联必须有效，缺失/null/空值/类型错误/不同start均准确拒绝。
不能用“字段存在时才比较”把未观察当通过，也不能要求一个未实际实现的第二执行生命周期。
正对照保留真实同文件REUSED，观察到的原PID/start保持；拒绝重启或替换后假称复用。
验收使用完整595正对照后，分别只删一个必要观察、改一个有效start/目标PID；错误归因到准确case。
不修改D生产来迎合旧断言，不重派已关闭的REUSED正常终态修复。

## E3 required gate 拒绝缺失诊断与矛盾结果

该已支持实际health digest的包必须有原digest与复用后digest，格式/相等性/来源都要成立。
删除digestAvailable/healthDigest/sameDigest不再跳过检查；显式不支持只能用于真实不支持包的限定scope。
不同/缺失选择、改端口、unbound请求必须有真实观测和明确拒绝终态，缺失结果或未知状态不能通过。
不同选择返回RUNNING同PID，即使没有reused字段也不是拒绝；不靠布尔字段缺失逃过检查。
第一里程碑：完整真实positive、四个既有反例全部拒绝，并增加必需的独立有效矛盾控制。
发布源码和有限命令后继续E4–E10，不等待新包才修自己的gate。

## E4 同包身份与consumer字节绑定

把每项required的source/tarSHA/bytes/build/schema/platform/ABI/mode/operation与canonical subject严格比较。
producer、数据subject、consumer package/file来源分开；四个真实consumer SHA/bytes来自不可变tar。
同包完整positive后，用真实另一包entry/tuple替换单一输入验证拒绝，不能只手写假字符串作为来源负例。
必要脚本/consumer不在目标包内则该installed项NOT_REACHED，源码checkout不能补包内缺失能力。
保留已经通过的595→真实a9b foreign-consumer拒绝；新目标选定后重绑实际正对照。
验收：缺field、跨source/包、entry哈希不符、来源origin改变准确拒绝且不会开始安装/模型动作。

## E5 准确选择 a9b 或必要主线后继

优先消费D不可变a9b155c/build9fdc283f55927f6f/schema18/sha413dee2f...，保留全部旧tuple。
若D交实际运行字节更新的clean-main后继，按新tuple独立测，不把a9b结果贴到它上面。
main源码8c8fdef已到；main不用等E最终结论才能继续提供source，E不因此阻塞源码交接。
冻结运行字节先于E最终验收；docs-only变化不要求重复冻结或整套重跑。
验证包清单、内部links、native binding ABI、console/coordinator依赖；外部绝对路径或checkout补丁不得混入。
验收：开始真实流程前准确tuple/file验证通过，所有输入根归此次独立probe。

## E6 同一数据链与两格式实际恢复

消费A持久数据配方、C单一参数化driver与D包内入口，绑定原Work/question/answer/attempt/native_applied及SDK候选。
对默认workflow1与显式2实际create/verify/restore同一源到第二根，读取原ID与回执，不只比较family数量。
包内prepare/start执行未同意403→明确选择后candidate/history/frozenbody200，保留真实Broker和原结果身份。
同时核queue held、业务422、provider不增、完成请求不重发；normal/recovered/fixture/vendor范围各自记录。
第二里程碑交准确同consumer双格式核心流程，producer与consumer provenance缺任一不得用弱fixture凑PASS。
A/C/D依赖未到只阻本项，继续E7/E9与离线gate控制，不建立第二份私有数据权威。

## E7 optional诊断与实际权限守卫

只在真实含712的目标包测试 `context/sources?scopeReview=1`；595缺该后续API仍为历史时间范围。
核reasons/partial/withheldSourceCount/authorization none与实际正文状态一致，默认response不新增field。
合法新签窄路径、增加排除、validity变化应保留原body/Scope/receipt权限守卫与拒绝原因。
每个负例从独立合法positive开始，不能把之前已失效的签名拿去证明另一个原因。
未知计数不杜撰，不额外访问不在授权范围的artifact/candidate/history；查询重复/非法参数准确拒绝。
验收记录实际入口、source状态、文件读取次数或可信观察，解释输出绝不能成为授权。

## E8 普通安装、复用、升级与失败保护

只对准确候选执行有界cold/reuse/no-executor/multi-state；不同选择/端口/配置不能静默复用。
真实same-file REUSED须原PID/start/health不变；失配拒绝需保持原实例且不暗中stop/spawn。
安全旧包→候选及16→18按实际exit/status/pointer/operation/data核对；保留升级后的新数据。
D安全finally/归属问题未闭合前，不直接重跑其危险live验证脚本；交精确复现并继续安全独立项。
每个故障窗口有正对照/截止/精确自有清理，归属UNKNOWN保留材料并失败，不冒险停其他状态根。
验收不以两个普通start冒充managed升级，也不以短时序列证明长期稳定。

## E9 有界可用性与观测归还

围绕同包核心用户流程测有限SSE、刷新、重开、并发只读、队列/FD/子资源归还。
浏览器验收只覆盖本包确实变化的界面及桌面/窄屏关键路径，保存准确截图/console错误与source。
重开不增provider、不重发旧完成请求；support私有0600/脱敏/拒绝覆盖并可由同包命令发现。
设场景deadline与整体deadline，不无限轮询外部agent或用更长等待隐藏FAIL。
任何需信号的资源先证明probe出生PID/start/UID/root/operation，禁global扫描、路径相似和共享install推断。
验收输出短序列实际范围，long soak/跨机器/跨ABI未测保持未测。

## E10 分层最终结论与第三个里程碑

第三里程碑交准确同包required最终结论、全量subject/consumer绑定、错误归因与未测范围。
分别报告module/controlled/ordinary-installed/recovery/native/value，普通安装不等B/native或BLOCKED试点。
保留真实595 measured范围、新a9b或后继准确结论、旧e4e失败，不能重标source或把部分positive称fullproduct。
更新wave23-status及可重复有限命令，只改拥有路径推原origin分支；不碰生产/rootlock/main UI或A迁移。
整个goal未达继续独立队列，不在checkpoint停工，也不将P1 acceptance遗漏当生产权限绕过来扩大结论。
真实vendor/model/native0；B cap4 UNKNOWN不可花；E pilot24turn/200000token/USD5/单在途BLOCKED，不reset/topup/refund/补样。
十二组5180/8796至5191/8807、所有state/profile/tar/ledger/runs保留，无新Driver/CAC/桌面/自动接受/动态DAG。

## 独立备选队列

D新候选未到：完成完整595gate与真实foreign来源控制，已有准确a9b可先独立验证，不借新源码补旧包。
A/C单一driver未到：普通冷装/升级/只读复用和安全有界稳定性继续，真实同数据双格式项准确NOT_REACHED。
B/native/private/target/value未到：各自门槛保留，不阻ordinary installed；不增加模型预算或称fullproduct发布。
