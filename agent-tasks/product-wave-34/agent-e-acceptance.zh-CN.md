# E：两个连续工程包，完整资源安全与同版本产品结论

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-e`，分支 `codex/g3-product-acceptance`。
先读 AGENTS、START-HERE、product-spec/README 和 [本轮 README](README.zh-CN.md)。
读 [0086 原生回调与支持消费者](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)。
读 [0087 验收架构](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)。
读 [0088 两包工程计划](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。
main `23d5a98e6e75a3b0fb08168431260a9935cf5674` 已提交0086 callbacks/support真实source。
source本身不是安装/native/完整恢复证明；先给固定W33独立结论，后继运行字节另立subject。
这是一个 whole goal：两个连续工程包，每包三个完整成果，共六成果，不是六条小修。
目标是独立证明完整方案 B 的实际产品，不以临时 ZIP、总 PASS 或只读 schema 代替工程闭环。
source 早、中、晚发布后继续第二包、联调与独立队列；一个 green 或一次提交不是终点。
不设时长、工时、同日 deadline 或 token 承诺，保留原 goal 和已存在预算账本。

## 已证范围与唯一责任

- 当前输入 `cc2f5fac`，实测测试源 `c2568908`；306PASS/0FAIL/20NT 原始记录保持。
- recorded199/200 是 R1 基础加新 W32 subset 的 mixed-cohort结果，不是整套 W33 verdict。
- W32 `e834/88eb`、outer `0a46` 现已有真正 actual ZIP 和非空 readonly 恢复 consumer。
- E33 新 consumer 使用包内 Node/原入口，已不再是旧“解 tar 冒充 ZIP”，不要重派旧缺口。
- helper 的 parentdead/no-set 已真关闭：未知保留，完整资源全退出才 clean。
- needs_input 假 applicable、wrong project 假 sameProject、notfound 及 actual outer 空 after 已真拒。
- 原 sameProject 声称但 scoped403、foreignPID42缺 start、旧 tar 空 after仍能过完整 report。
- 新 P1 在 callers：outer catch 后 rmHome，cohort 已 retain 后又 rmHome，helper正确不覆盖它们。
- H 新等待 available accept 后在 W32 真正接受/交付/重开；不要再松产品 gate 修旧抢跑。
- D 新 W33 `048f/f880`、inner `ee45`、outer `46e` 已存在且完整静态通过，不再只追旧 R1。
- D 新非空 Work/accepted/20 artifact 与四产物 bytes 已有真数据，保留 source/installed 适用层。
- D rollback raw BLOCKED 与 summary success 不一致，独立结论不能只看 summary。
- 只拥有 `tests/product-acceptance/`，E 是 required、assertions、oracle 与最终独立结论的唯一 owner。
- 不改 D/main 产品来让测试绿，不放宽授权、机器检查、trusted review 或资源屏障。
- 状态写 `tests/product-acceptance/reports/wave34-status.json`，测试源与每个 actual subject 都精确绑定。

## 工程包一：完整生命周期安全与原项目证据语义

先完成实际 caller 的全路径安全，再使用它们执行受控产品生命周期，不能只修一个 helper。
本包各成果都交实现、actual consumer、合法正向、必要独立负向及可运行 source handoff。
纯控制可以先交；必要安全条件未齐不跑新的 live 故障或用清理强过关。

### 成果 E1：caller finally 的完整资源与材料保留

让 outer/cohort/其他 lifecycle callers 从 spawn 到 catch/finally 都消费同一个完整 ownership 协议。
actual consumer 是 w33 outer/cohort cases、stopOwned/retain/release、私有 install/state/model/mock 处置。

- 保留 helper 已关的 parentdead/no-set，不重复声称旧反例没修，也不靠它替 caller 背书。
- outer 在 Start 已出生但 status/stop 抛错后，不能直接 recursive/force rmHome。
- cohort 在 stopOwned UNKNOWN、retainMaterial 后，不能继续删除仍被该 operation 使用的 HOME/install。
- failed assertion 只能改变产品结果，不能授予清理、signal、删除或放弃未知材料的权限。
- 显式跟踪每个 start 的完整 immutable birth/资源集合及所用 roots、Node、模型、mock。
- 用明确 preview/private roots 接口，不重设 HOME、借用户真实 Application Support 或隐式默认账号。
- 若共享显式 root consumer 未到，给 main 最小约定，继续纯控制，不复制第二入口或改全局环境。
- 关闭自有 loopback mock 与删除数据材料分开；server close 不证明产品资源全部静止。
- 只有所有关联已知资源均被准确重观测退出，才允许 release 整个 install/state/model 材料集合。
- 任一未知、缺集合、超时、查询失败、PID复用或迟到 child都保留，不能从 parent推出 children结果。
- 必要 positive 包括未启动根、合法完整已退出集合和完整自有资源的正常产品停止。
- 必要 negative 包括 spawn后失败、status失败、stop拒绝、UNKNOWN、assert失败和 retain后删除尝试。
- 对实际 caller source 做纯控制，捕获零误 signal/零误 release，不能只给抽离 helper 的绿测试。
- 不用 global ps、路径发现、强杀、删 record 或“失败也必须不留目录”的 finally 规则。

验收：所有 caller 的成功、拒绝和异常路径遵守完整 operation 安全，未知整份材料可被后续诊断。
早期 source 给 main/D/H：资源契约、实际 caller consumer、合法 positive、纯失败控制与保留结果。
修完源码后继续 E2/E3 与工程包二；不要跑危险 live 来代替 caller 纯控制。

### 成果 E2：所有 cohort 的完整资源映射与最终 oracle

让 physical-stop 结论来自固定 pre 集合和逐个 post 观察，不来自 clean/STOPPED/数组非空。
actual consumer 是完整 report 的 evaluateRelease、outer/cohort/tar lifecycle validators 和实际停止观察。

- pre 绑定每个原 PID/start/UID/fullargv/root/config/op，声明完整集合而非只列 parent 或一个 sleeper。
- post 必须一一映射 pre 的原身份，并有显式 alive、sameIdentity 和可核对的观察字段。
- 数量、唯一性、漏 child、重复 PID、foreignPID42、缺 expectedStart/UID 都不得满足 quiescence。
- PID 已复用只证明原身份已结束时才计，不得 signal新身份；缺观察或 unknown 不是退出。
- 无完整集合时 UNKNOWN；不能在 record已删除后取空列表，再把空列表当全集合证明。
- package STOPPED/exit、record状态、独立物理观察和工具 cleanup 分开记录。
- 把既有 stopFunctional 严格语义应用到所有 cohort 和 unconfigured/configured/delivered/reopen/negative阶段。
- 新 actual outer 的空 after已拒，继续补 foreignPID/no-start 和 cohort cardinality错误的完整 report负例。
- 旧 E32 tar lifecycle 的空 after仍误放，也要真正拒绝，不因新 outer更严格而漏旧 required。
- restored执行负向先 stop 后再捕获 after；不能把停止前 alive=true 的数组命名为停止后证明。
- 最终 oracle 需对完整真实 report mutation拒绝，不能只靠 producer assert 或独立小对象 validator。
- 每类合法完整 positive仍通过，实际正确的 R1/W32停止事实和物理观察不得被抹掉。
- 负例必须给具体拒绝原因，不能被无关 schema错误、旧报告过期或缺 fixture提前拦截来凑通过。

验收：任何 required case 缺原资源映射、明确观察或主张不成立，完整 tier 必须 fail closed。
交接：严格资源 DTO/reader/oracle 和 actual report 正反结果，E 保持断言 ownership。
source发布后继续原项目旅程和新 cohort，不以 PASS 数增加更新产品完成率。

### 成果 E3：两个原项目的真实 scoped旅程与重开

让原注册项目的 applicability、create/check/candidate/accept、scoped读取及 Work重开构成同一证据链。
actual consumer 是真实产品公开入口和其当前项目/profile/scope/criteria/合同身份。

- 两个项目分别有真正 draft/完整字段可应用，而非两个 needs_input 加一个 fixture项目的成功工作。
- apply 只预填，编辑后明确 create；Work/attempt/check/candidate/accept 属于对应原 project ID。
- 原 sameProject=true 必须同时满足完整 draft fields、同原执行身份和 selected-project 可读条件。
- scoped403 不得被 open200替代；7/30响应需绑定所选 project、窗口、coverage与当前scope。
- 全 report变异“同ID+假draft+sameProject但scoped403”现在仍通过，必须在最终 validator拒绝。
- 合法 narrowed fixture positive可保留，但不能满足原项目更强 required；NOT_REACHED依赖要准确。
- 原模式没有该 consumer时给 main精确缺口/输入约定，不能用fixture越权或换ID冒充产品支持。
- 接受前必须有available accept和原verification已就绪；H新正向已真关，不再修旧抢跑。
- stale negative在仍可接受的同候选状态单独派生，不能等成功接受后被review-unavailable先拒冒称原因通过。
- stop/reopen读到同原Work/phase/accepted/artifact IDs和全bytes，消息数不能替这些字段。
- 保留notfound、phase null、artifacts0已真拒的修复，再补wrong scope/project/字段与真实业务数据控制。
- 机器FAIL、trusted review、原批准与完整resource guard继续权威，不建第二业务或review账本。

验收：两个原项目各自合法完成，完整 report拒错项目、未就绪预览、scope403和假重开。
本包交中期 source与准确缺口后继续工程包二；原项目外部依赖不阻安装、oracle和数据独立队列。

## 工程包二：同准确安装、非空恢复与完整分层交付

在前包安全规则下锁实际版本，把原产品使用和持久业务证据接到同一个可重复消费的安装。
不把整块压成一次ZIP smoke，也不因为新main/source出现就改动正在验的subject。

### 成果 E4：actual outer ZIP 的当前产品安装与再启

先锁已有 W33 f880/46e 完成本轮独立结论，不等移动main；必要运行后继以后另立结论。
actual consumer 必须是所选 ZIP 的 bundled Node、Start/Stop/Settings、原CLI和冻结console/runtime。

- 不再拿R1 tar、当前checkout或作者全局Node给outer通过；E新W32 actual ZIP正向保留。
- 先核source/build/inner/outer/hash/bytes/manifest/runtime/LICENSE和entry，然后才消费包内入口。
- 明确新同一cohort的roots/config/模式/端口/健康/PID与原operation身份，重复打开不产生无主实例。
- 新根、已有私有模型配置、未配置退化、允许模型选择、导入和再启分别记录原真实consumer。
- 只用显式private root，不重设HOME、覆盖旧用户state或借默认key/auth；共享接口缺则等owner实现。
- 若固定包缺该显式root入口，该surface诚实HELD；不patch冻结字节或用HOME替换补证，继续独立队列。
- 原status STOPPED exit2与BLOCKED/UNVERIFIED不同；同tuple复用和错参数拒绝都要实际观察。
- config/key/BaseURL私有JSON与GUI模型选择范围分开，用户明确调用前不发送真实模型任务。
- main0086新callbacks/support需要真正入选运行字节后才验；原包没有后发字段是时间scope。
- docs/test-only不促D refreeze，main真实runtime改动形成明确后继后再单独切换cohort。
- current W33尚未E独立的范围准确标记，W32 actual outer和R1 legacy不重贴给它。
- 包/Node/LICENSE/entry损坏、不同root/build/端口、权限与legacy absence的拒绝保持不覆盖/不泄密。

验收：准确outer入口、产品可见能力和完整资源结果来自同一cohort，可独立重做而非源代码演示。
交接：原始entry/hash/命令exit、实际consumer与严格正负结果，不混base/target与两个source。

### 成果 E5：同 cohort 非空恢复、升级与回退字节证明

把已通过的W32非空恢复扩到选定当前cohort的真实反复使用与原管理操作。
actual consumer是安装产品原Work/问答/接受、backup/verify/restore、升级/回退及授权reader。

- E现有W32 accepted Work/eventSeq51/20artifact与实际readonly HTTP bytes/history是新增真进展，不重派为零。
- D新W33 source受控数据+同包backup/Store读取也保留，但不冒称原个人项目安装执行已通过。
- 记录producer/reader实际entry/hash；当前source准备数据时必须证明相关产品bytes与冻结包一致。
- 所选cohort至少有原Work/合同/accepted/问答及全部引用artifactbytes，不能只取前三个称全量。
- 新根readonly保持原IDs、history/goal和字节；Store直接读、公共已授权200、无授权403分别给结论。
- 恢复marker不授执行权，业务422、provider不增加、真实pending queue held与已完成不重发分别验证。
- 没有待处理queue就不宣称测了通用held；错误table查询不能catch成空数组制造无任务结论。
- backup/格式recipe/manifest/hash/data roots不可跨cohort拼接，v1/v2与personal bundle分协议记录。
- D rollback raw BLOCKED必须保留；成功需另有原receipt/exit/operation/pointer/数据证据，否则诚实HELD。
- binary rollback不覆盖升级后新增数据，不降schema；真实生产迁移只消费A已准入入口。
- 缺artifact、同长度内容变异、wrong source、错误映射、活跃目标和目标不健康的负例从合法正向派生。
- 每个恢复与负向启动都先固定完整资源，原stop后观察；UNKNOWN整份材料保留，不删除安装runtime。

验收：同准确版本的原非空业务经重开/搬根/管理操作保持身份和全部字节，原动作不重复。
晚期交接：最终required/report/oracle、原始bytes/data/资源事实与各层限制，不由摘要填未知项。

### 成果 E6：整体 tier、独立 negative与完整可消费交接

形成main能据此判断产品已达/未达的结论，避免统计绿灯替代原目标语义。
actual consumer是完整report、requirements、release oracle、cohort映射和最终用户/开发者说明。

- 保留E306/20NT与199/200的R1+W32历史角色，不能把mixed tier称W33全部required已测。
- 当前目标逐case绑定actual producer/consumer/包entry hash，新增或更强scope有自己的真实positive。
- ordinary、controlled fixture、个人原项目、historical native、当前native、恢复和收益单独给结论。
- 全report独立negative覆盖源码/subject、cross-artifact、foreignPID/start、假applicability/scoped403和错误重开。
- producer assert与最终validator缺一不可，不能用gate fixtures通过证明真实product consumer已可用。
- 外部依赖未到只阻对应scope，给精确输入与最小owner复现；不能用新的helper/报告编号凑成果。
- 闭合的helper/noSet、actualW32 ZIP/非空恢复和H合法accept不再作为未做项反复派发。
- 可运行source先发布，让main/D渐进消费；继续独立队列、同cohort联调和完整两包goal。

验收：每个产品主张有准确正向、独立反向与不可变来源；错误材料无法通过更强scope。
最终交接给main/D/A/B/C/I/H的是可重做结果和准确余项，不是增加一个总PASS数。

## 独立队列、预算与安全完成条件

先修caller纯控制再live；安全依赖未齐继续oracle、协议/subject映射、旧兼容、数据和文档核对。
六成果均需实现、actual consumer、合法正向、必要独立负向与source handoff，只有计划或schema不算完成。
无原项目/当前安装正向就记SOURCE_READY/NOT_REACHED，保留原失败，不以PARTIAL结束可做的工程。
自动真实vendor/model/native0；B cap4 UNKNOWN不可花，E原24turn/200000token/USD5 pilot仍BLOCKED。
不reset/top-up/refund/补样/价格研究，不用用户后续主动使用冒充本轮自动验收预算。
保留所有state/profile/archive/ledger/history/dirty/runs/五日志和十二5180/8796至5191/8807实例。
任何signal仅完整独立birth/PID/start/UID/fullargv/root/config/op/fullset自有资源，全集合先验且每次fresh。
禁止global discovery、forcecleanup、重设HOME、路径认领、借凭据、真实CLI fallback和未知材料删除。
不改D/main产品实现或其他owner，不新Driver/CAC/subteam/桌面/自动接受/第二生命周期或账本。
只提交显式tests/product-acceptance路径到原origin分支，不upstream/reset；wholegoal覆盖两包连续工程。
