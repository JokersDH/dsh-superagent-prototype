# 0096：里程碑04的兼容准入与新根授权

日期：2026-11-24。状态：实施约束已提出，公共schema尚未修改；具体加法字段由B的实际零模型探测与main消费者共同验证后落码。范围仅为[里程碑04](../../product/MILESTONE-04.zh-CN.md)的两个出口，不改冻结Runner wire，不引入新核心生命周期。

## 为什么不能只加一个ACP包

当前`NativeProductConfiguration.profile`、runtime默认展示、execution的Codex策略解析、native-attempt的scenario和Runner工厂构成了单协议假设。未知Codex版本又分别被launcher/preview/coordinator按历史版本拦截。修改一个版本比较或新增一个Driver目录不能使默认工作台真正支持多协议。

`configuration.ts`要求native_test_passed才允许dispatch，Catalog的部分内部判定却接受inspection_passed。需要表达新的“协议兼容但产品未实测”事实，不能通过伪造历史PASS来解决。恢复目标仍明确not_granted；打开另一份数据库也不等于获得当前机器执行权。

## 决定一：探测、准入、实测分开

复用原Profile、CompatibilityIdentity、CapabilityObservation、ProbeReport与Catalog。B拥有具体CLI/schema解释和兼容判定，main拥有公共展示/命令契约及准入消费，D的launcher和wrapper消费同一事实。

| 事实 | 来源 | 不授予什么 |
| --- | --- | --- |
| 可执行身份与版本 | 当前目标文件与零模型version/schema检查 | 不自动代表原native证据仍有效 |
| 协议兼容 | 实际方法、字段、枚举、通知、ID及握手的逐能力检查 | 不代表真实工具/审批/交付已通过 |
| 当前可用操作 | 兼容检查、受控原消费者、当前权限策略和物理资源门槛的交集 | UI按钮或CLI自称支持不能扩大权限 |
| 产品真实验证 | 准确版本/协议/策略/安装的真实任务观察 | 不自动推广到所有版本、机器或模式 |

公共配置须增加或复用能明确表达“未验证兼容版本”的状态和逐能力可用性，保留历史native_test_passed的原意。若开放显式试用开发，必须由公共契约单列试用准入及提示，重新验证create/begin/answer/stop的原guard；禁止让inspection_passed在其他路径暗中成为全权限。

不能仅依赖schema证明实际进程隔离；原ProcessHost/策略/资源门槛仍须满足。任何缺失、方法不明、超时或无法解析均保持unknown/disabled。兼容模块不得维护第二张独立授权表。

## 决定二：每个profile注册一个Driver实现

保持`AgentDriverV1.inspect/serve/reconcile`和原`AttemptIO`为Driver接口，第二个Adapter用实际协议验证这一接口。B实现ACP内部请求/通知/权限映射和Runner工厂；main将原单profile组合接为受控的注册集合，不进行运行时任意插件加载。

| 消费位置 | 责任与不变量 |
| --- | --- |
| 原native-startup/configuration | 逐profile准入；ACP未装不阻断Codex；只展示安全DTO |
| 原NewWork表单及创建命令 | 用户选已准入profile，project授权允许，合同保存不可变id/revision，不自动选择路由 |
| 原execution准备/恢复 | 根据合同中原profile解析对应策略；不能用CodexSettings解析ACP，也不能将缺策略默认为宽权限 |
| 原NativeProductAttempt/Runner工厂 | 精确已注册driver/scenario，无HTTP/env任意工厂替换，无fixture回退 |
| Driver serve | 原合法begin后才prompt；并发响应answer/cancel，不能被长prompt Promise堵塞控制 |
| Driver reconcile | 原journal/资源/运行状态只读核对，不重新prompt；无恢复能力时明确降级，不假称已恢复 |
| 问题与答案 | 原target/session/question/command保真；协议只证明response_written时不得报native_applied |
| 停止 | 原完整资源静止/屏障才归还；cancel应答或session终态不代替物理证据 |

工厂注册只是选择已有实现，不创建第二个调度器或持久生命周期。公共语义缺口经main RFC评估，ACP私有线协议留Driver内部。两协议的ExecutionOutcome沿原profileRef和记录来源，usage未知如实记录。

## 决定三：恢复来源只读，新根显式授权后只接新Work

原restore/source-confirmation作为历史来源，原target材料/库存作为准备证据。main补授权命令与默认消费者；D补物理准备和正常启动，A在原Store/UoW内填真正缺失的持久事实。不能由launcher写一份私有permissions.json代替Application授权。

授权至少绑定当前principal、恢复来源确认、generation、目标真实根、配置摘要、项目映射、已准入profile/revision及当前操作幂等身份；使用前重验私有根/单writer/资源/当前配置。相同请求重放只返回原回执，结果未知先查询；身份/代次/配置变化必须拒绝并要求明确重新确认，不能挪用旧权限。

历史业务和原运行资源不迁移为活动授权，原held/UNKNOWN材料不丢弃；新执行根只能创建用户明确授权的新Work。旧问题答案、begin、native session和cached permission不得自动投递。恢复marker不是需要删掉的障碍，source根不能被改成normal来绕过。

目标已有未知writer、非空冲突、库存不全或源确认过期时拒绝，不清库/覆盖/重试同业务。授权状态和运行状态分开，不能因为写了authorization回执就认定服务已经启动。D正常启动消费准确授权后，仍沿原实例身份与物理资源流程。

## 实施与验收顺序

B先交共享版本probe/分类小闭包，main/D消费；B同时持续ACP。main并行新授权接线。E从公共接口对已验证/兼容未验证/不兼容/unknown做独立正反例，覆盖当前绑定改变和未知回执，不能由producer简化断言。

以上消费在受控路径成立后，才用同一个M04 ACP上限做真实任务。D冻结必须包含兼容及新授权的运行代码，E验准确包。同事完成另一台Mac首次任务和新根第二次任务，才有跨机/恢复真实交付结论。此RFC本身、纯函数或schema通过均不代表出口完成。

## 首个已实现的主线消费者（2026-11-24）

新根授权已沿原恢复source确认、D materializer、A库存和原目标Store接入默认恢复只读runtime。新增`POST /v1/recovery/targets/authorize`与`GET /v1/recovery/targets/:id/authorization`，工作台恢复面板明确核对项目/检查、准备目标、勾选授权；网络结果未知先保留请求，刷新后仅查询原回执。

授权使用按generation确定的命令ID，写入**目标自己的原command_receipts/EventLog/UoW**。source只保留原确认，不写授权副本，因此原ignoreCommitted逻辑指纹及held队列保持。新增可选logicalFingerprint、parentIdentity和项目baselineCommit属于HTTP恢复契约，不改Runner wire或迁移版本；旧记录仍可审计，但不足以产生新的目标授权。

目标原WriterLock守护提交。grant绑定principal、host、源确认/回执、目标material/generation、目录/父目录/数据库身份、项目配置和当前profile/可执行身份。普通demo启动识别recovery-target.json，未核到有效原grant不能启动执行；grant回执本身始终started=false/startupAvailable=false。新业务数据不要求恢复为空库，不依赖旧source五分钟后仍在线；换机器/根/数据库/父目录/profile不继承旧权限。

相关安全测试31项通过，其中授权专项15项；包括同ID丢响应调和、源指纹不变、复制目标拒绝、同目录数据库替换拒绝、父目录替换拒绝。contracts/coordinator/console严格类型检查及网页构建通过，共享Runner identity保持不变。实际浏览器已零模型操作默认React/Hono/Store链，刷新仅GET原授权；最终桌面和390px结果态独立审查通过，范围只到源码结果态，不等安装/真实执行/跨机。

D的下一消费者：使用当前目标授权回执与`verifyRecoveryTargetStartup()`接正常安装入口的新根选择，不移除历史restore marker。E消费上述原HTTP/UI和目标原回执，自行定义安装断言。当前固定项目配置变更会拒绝原授权，不能假称任意后续迁移/配置场景已覆盖。版本兼容与ACP公共注册仍待B早交源码后接入，本检查点不关闭L1④。

主线已发布目标授权源码检查点`0a2f8fc2`。随后只采纳D已完成的`6754e6cb`单文件只读support修复（主线`a784d65c`），没有导入D整枝或其候选包结论。main实际以旧的非空SQLite消费support，确认原文件摘要/目录和原表均不变、私有正文不导出；连同原support测试2项通过。最终DMG仍等版本兼容及正常新根入口一起就绪，不能用这两项测试提前冻结。

本轮真实模型发送为0。执行既有source-confirmation测试时，第一次误包含两项自有子进程SIGKILL，后一次名称过滤未排除它们，又发生两次，共4次；这是误执行，不是获得授权的实验，不写入或复用历史额度及验收。已在父测试与worker同时增加默认禁用的显式故障实验开关，专项安全测试证实没有开关时worker在创建Store前正常拒绝、没有signal。十二用户实例未操作，后续本轮不再运行该故障测试文件。UI验收服务器均通过自有stdin关闭入口正常退出，没有故障清理信号。

## 2026-11-26：组件验收及公共兼容投影

本节是同一里程碑的源码交接，非完成汇总。主线核对B `6c0207a0`、D `ddfd01b8`、E `3a54438a`后，原13项仍0/13，计分保持85/100与65.3%。当前[三段续工话术](../../../agent-tasks/milestone-04/continue-prompts.zh-CN.md)只给B/D/E，不启动第三条线。

**B接受最小诊断闭包。** 精确导入`catalog/src/compatibility.ts`及测试、`drivers/codex-native/src/index.ts`、`schema-probe.ts`及兼容测试，共5个原文件，未修改其字节。main先在B路径复现14个组件测试，再在main复现诊断9项；这些是fixture/受控检查，不是实际版本矩阵或真实ACP。ACP包/Runner工厂未接默认路径。

**ACP仍有三个直接生产阻断。** begin只发`command.inputRef`而不解析原ExecutionInput；策略缺失会补宽scope且未走原policy.prepared。answer把原payload引用当选项，正则猜允许/拒绝，工厂未向ACP传原beforeAnswerWrite。reconcile看到turn.ended/runtime.exited便报writer=quiescent。主线实际运行`/Users/hh/Desktop/joker/pa-artifacts/m04-admission-20261126/acp-input-repro.mjs`（零进程、零模型、fake transport）exit1，收到`opaque-original-input-ref`而非合法ExecutionInput正文。其他两组经源码独立核对，交B修同一实际消费者；修好前不宣布LIVE_READY。

B41里版本/可执行digest/配置指纹含固定fixture值，ACP把v1定义复制成observed，initialize本身不能证明全部权限/cancel/ID方法已观察。没有本轮完整持久输出便只记录B自述结果；B报告真实prompt0，尚待独立新grant发送账核对，不写成已核实六次可用。旧ledger/研究样本不修改。

**D/E安装结果收窄。** D新外壳0.1.2实际封装旧source83f79e82/buildd3ba，尚无main新授权和兼容消费，不是M04 F0。E报告明确HARNESS_ONLY/HARNESS_READY、兼容/恢复BLOCKED、同事实测NOT_TESTED，这部分限定有效；但其L1①只按字段存在判PASS、恢复从configuration猜字段、几处裸PID清理都应先改成真实consumer和原正常退出。暂不导入运行E工具，不混旧cohort。

**main已交公共事实接口。** `contracts/src/execution-compatibility.ts`定义版本/协议/schema/逐操作的native、controlled、protocol、unobserved证据层；`ExecutionProfileView.compatibility`为可选加法。`trialAdmission`明确为`explicit_trial`，引用当前身份/策略摘要和确认命令ID，仍使用inspection_passed，不能伪报native_test_passed；protocol-only、unknown、incompatible、fixture及没有原生/受控begin消费者的状态都不能因此开启dispatch。

`product/execution-profile-view.ts`消费B的一份CompatibilityVerdict，没有可信admission输入时强制不派工、操作均关闭。原NativeProductConfiguration可携带该安全profileView，runtime校验它与可信profile同id/revision/driver，经过原`/v1/configuration`发布；本次原runtime/HTTP消费者已实际跑通，没有创建Work、ticket或原生进程。它不是实际用户同意命令或新授权的实现，外部HTTP不能上传这个对象获得执行权；默认native-startup仍保持原准入，后续main负责真实consent回执及发送前检查。

本次明确选取的49项契约/投影/原HTTP配置/兼容诊断/Codex既有协议测试通过，contracts生成校验和coordinator/console严格类型检查通过。共享Runner hash保持原值。未跑B41 live探针、B42原进程消费者、E包启动或历史故障实验；本次main真实模型/故障信号为0。D接正常安装新根入口，E按公共接口定义实际断言，B修原payload/策略/答案/物理状态；main继续默认多profile、实际probe/consent和能力控制接线。

可消费的代码检查点为`33a69f44`及`4af915f2`。后者让恢复只读和未准入配置的逐操作enabled同步变为false，保留诊断/历史试用metadata但不展示可执行状态；同一原HTTP消费者已覆盖，49项回归复跑通过。三份续工话术引用这些固定接口，不需要等下一个共享类型包，也不把这份DTO当真实试用授权已经落地。

## 同日第二次续验：版本试用已成为实际主线消费者

代码检查点：`ddb43c89`采纳B的精确schema类型/required/partial修正及E独立恢复消费者；`83609dc6`接原Store版本同意、默认启动及UI；`b11ec430`接桌面切根与新接收协议。当前源码可以核对不同CLI版本并记录明确试用同意，但尚无本轮最终安装包或跨机结论，清单不按组件数量提前划全。

B `9dd07424`已修复原输入、答案和journal推静止三组问题的主要代码。ACP仍未准入默认执行：策略JSON尚无当前实际执行来源、inspect为partial/unknown且缺完整准入观察入口、fs/terminal声明与请求实现不一致。没有为了跑通而由main写造enforced/passed。原B新grant记录0/6、not_ready，未宣布LIVE_READY。

主线已实际接入：`GET /v1/executors/trial`仅检查、`POST /v1/executors/trial/confirm`要求明确同意，`GET /v1/executors/trial/receipts/:id`核对原未知响应。版本同意使用原command_receipts/EventLog/UoW，绑定principal、当前state目录/DB身份、machine、CLI身份和产品策略源码摘要；拷贝Store或更新身份不能继承同意。当前实例不热启用，下一正常启动重验后才可explicit_trial；实际新Work及begin前继续重验CLI摘要/原回执，变化时停止新发送，原运行身份不改写。resume等未核控制保持禁用。

配置事实明确分层：`codex-product-request-policy-v1`只指产品固定argv/thread sandbox/审批/网络参数及其执行代码摘要，这些字节可冻结；操作者全量native resolved config仍标unobserved。协议兼容不等于native已验。原CodexProductDriver仍须在thread/start实际核cwd/sandbox/network/审批并提交policy.prepared，之后才可begin，UI同意不能替代该屏障。

实际无模型检查覆盖本机Homebrew `0.164.0`、Node安装入口`0.164.0`及桌面内置`0.169.0-alpha.11.1`。最终代码`b11ec430`上重新核前后两种不同版本，schema摘要分别为`6ce9924fc181269820587dd6ed081029b09d4955bc26d23e6a6ece0a00e136a8`和`18790ab50329c539f7d04f47f2438c15e7bb743d40d413824fed48be40e97914`；均compatible_unverified、nativeTestPassed=false、操作enabled=0，未创建session/prompt或实际CLI试用同意。详细私有事实在`/Users/hh/Desktop/joker/pa-artifacts/m04-main-20261126/version-matrix/final.json`，不包含认证输出。

实际受控工作台已操作“查版本→勾选→原同意写后503→刷新→GET同一command”，未重复POST；另复现并修复重检失败保留旧勾选的状态问题。最终桌面/390px检查和回执态独立审查ship，范围仅此UI扩展，0.999.1为fixture而非另一真实CLI版本。页面同意明确说明当前没有自动任务、需正常重开。

D的`d33b5efa/827eddf2`方向正确，但切根存在output复用旧URL及task=nil不足以证明可切换。main按其两文件完成最小修复：每次launch清输出/递增代次，忽略旧回调，URL经过原status与当前选中root核对，只有原正常停止确认后允许切根，UNKNOWN保留；可选择历史恢复源（强readonly）或准备目标（须原grant）。launcher只在本安装确有`inspected-native-startup/1`接收协议时把执行准入留给backend，否则保留旧精确版本拒绝；显式discussion-only不变。最终wrapper已审SHA为`fcafba15e32daabfff908624a335f79abe2fdfea5f30a3fcca8556e2f0cbed94`。

实际demo现会在创建credentials/Store前拒绝未授权目标；readonly授权查询改用自有私有DB/WAL快照，避免只读SQLite打开原目录时写-wal/-shm。真实进程入口负例核到拒绝且原DB摘要/目录不变。E `d9c0fe9d`的独立`m04-recovery.mjs`已原字节纳入，在main新私有根复验18断言通过；后置反例有顺序局限，不升格独立每类覆盖。E整包脚本仍有未声明page、按bundle ID广播退出和query失败当退出的问题，未导入或运行它。

验证：113项明确选择的主线回归通过；15项launcher/桌面入口测试通过（与前者有重叠，不能相加成全产品准入）；verifier自身10项、严格类型检查、生成校验、Swift静态编译与网页构建通过。未跑旧fault实验；本段真实模型turn/故障信号0，十二用户实例未操作。源码已就绪供D/E消费，准确DMG仍等同包消费者；新版本真实交付、第二协议真实执行和同事实测均未借此认证。
