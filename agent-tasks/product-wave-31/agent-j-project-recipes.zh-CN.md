# Agent J：当前事实模板、真实确认与迁移项目支持三包计划

日期：2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-j`，分支 `codex/g5-project-recipes`。
仅拥有 `packages/project-recipes/`、`tools/project-recipes/`、`docs/project-recipes/`、`reports/project-recipes/`，原role/工作树不变。
main唯一拥有contracts/HTTP/App/transport/rootlock与授权，F拥有trial展示，A唯一SQL迁移，B/I保留runtime/channel，E独占断言。
先读START-HERE、product-spec、[本轮README](README.zh-CN.md)、[0080](../../docs/rfcs/WP-16/0080-main-observation-export-and-runtime-checkpoint.md)、[0081](../../docs/rfcs/WP-16/0081-wave-31-reviewed-architecture.md)、[0082](../../docs/rfcs/WP-16/0082-wave-31-three-release-program.md)。
同步main已发布source，复用原Scope原子/排除/expiry/CheckRegistry/ApplicationConfiguration/ProjectRegistration与原确认流程。
main0073/0077真实serverpreview→trial建议/受限选择→原表单apply/edit/revalidate/create已实现，不再报告缺入口。
R1固定D8296720准确包行为不追新main；R2接当前facts/consumer/source和独立successor；R3迁移项目与同事长用支持。
已关atom/observer/字段完整性与同配置Application兼容保留，freshness/config剩余边界按0081实际source审查收口，不重复旧微修。

用户一次下发三连续完整包，建立/延续wholeprogram goal，无当天deadline、token预算或时长承诺。
每outcome早交可运行source/真实consumer后继续，包完成直接进入下一包，不等用户逐次派发。
J是确定性建议/只读facts数据，不新权限、runner/verifier、安装recipe、collector、ledger或执行lifecycle。
自动vendor/model/native0，脚本/metadata是数据不是可执行输入，不能自动register/install/run或自动换agent。

## 交付包一：R1准确包的当前事实与模板基线

结果是在锁定829RC实际能力下可靠观察项目、选择模板、预览并交原用户确认的完整数据产品。
RC缺后续source能力准确未达，不修改/覆盖RC，也不从checkout补包。

### J1 RC与当前项目事实来源

实现范围：

- 从D/E取得D8296720的source/tar/hash/build/schema/ABI/mode与实际Jobserver/matcher/preview闭包。
- facts来自显式注入公开观察或main已登记rootlookup，不从客户端root、cwd/home/env猜路径或补凭据。
- 只读必要Node/npm/pnpm/lock/manager信息，既有支持范围外language/platform准确unknown/unsupported。

实际 consumer：

- main真实project preview提供当前config/selection/servernow，F只受限callback，J不拥有API或表单authority。
- 包内/源码/fixture/installed各自标准确，source存在不表示RC包含晚功能。

验收正负：

- RC实际正确项目/配置/metadata可观察，缺注册root/不支持stack/未知版本给准确结果。
- 原事件/DB/registry/project不变，无外部命令/网络/脚本执行，秘密和绝对root不进入public建议。

source 交接：

- 交RC实际baseline、输入来源、支持范围与可编译sourcecheckpoint，不追新main重冻RC。
- 发布后继续J2完整freshness语义，不以一次metadata读取结束包一。

### J2 freshness、内容digest与配置边界

实现范围：

- 明确调用方now、observedAt、fresh/stale/future/invalid时间、scopeexpiry与配置version/schema的正式政策。
- 稳定factsContentDigest与包含观察时间的来源身份分开，去掉时间参与内容比较不等于取消freshness校验。
- 相同内容但未来/过期观察不能伪装当前，配置被替换/不合法不能凭revision相同通过。

实际 consumer：

- main当前serverobserver/previewInputs/assertDraftCurrent与JCLI使用同一政策，不能source/dist/runtime各写一份。
- library不产生执行grant/签名，fresh只表示适合再生成预填数据，原创建仍mainguard。

验收正负：

- 合法新观察同内容可重用，真实content/config变化要求重生成；future/invalidnow/expiry/旧schema准确拒绝或needs_input。
- 支持旧draft的版本策略明确，新增provenance不能默认为可信，已关反例保留准确scope。

source 交接：

- 交freshness/content/configcontract、实际main/CLIconsumer和时间/版本正负证据。
- checkpoint后继续三kind项目匹配，不能将一个future时间修补当整模板模块完成。

### J3 三kind模板与原scope/check/profile匹配

实现范围：

- 回归修复、有限变更、验证跟进都基于当前registeredproject/profile/check/requiredcriteria确定性匹配。
- 原路径atom字面包含、必需排除、externalActions和expiry保留，不用prefix/glob“自动收窄”产生新授权。
- package scripts仅名称/元数据，不转任意executable/argv或自动注册check；缺能力needs_input/unsupported。

实际 consumer：

- mainpreview返回完整scope/criteria/profile/goal，F显示与selection同serverfields，原WorkDraft/UserCommand确认仍main。
- J提供纯数据/稳定types，不重建模型Proposal、当前候选表或另一个检查runner。

验收正负：

- 三kind在真实支持Node/npm/pnpm项目可生成可审阅输入，同配置原Applicationscope兼容。
- blocked/readonly/unknownprofile、缺check、过期scope、错项目/foreignatom或不可表达额外约束不被静默丢弃。

source 交接：

- 交实际catalog/matcher/公开fields接口、currentmain调用与准确needs_input原因，不泄漏root或脚本body。
- source发布后继续真实确认consumer，不以UserCommand schema通过替代产品。

### J4 R1真实预览/用户确认与第一包交付

实现范围：

- 将J1–J3接到RC实际已有preview/原表单入口，明确预览、apply、goal编辑、创建前重验和explicitcreate。
- RC缺晚trial建议或window能力准确未达，保留原手动/模板入口，不注入checkoutUI补包。
- 未知创建响应仍由main原commandId/reconcile处理，J不接管发送ledger或创建Work。

实际 consumer：

- main/F原form和Application/check/currentcandidate/manualaccept消费J数据，A/C读原事实，不换确认权威。
- E独立核准确RC范围，J不以fixture/源码结果自授installed/native/release。

验收正负：

- 正确三kind预填/编辑/确认可追到原Work字段，preview/取消零业务写，旧输入变化需重生成。
- 过期/不合法/未注册来源准确拒绝，用户未明确操作时不执行任何模型或脚本。

source 交接：

- 发布包一完整source/actualconsumer/API/命令/exit/RCscope和限制。
- 直接进入R2完整当前source消费，不等用户再派剩余项目与兼容工作。

## 交付包二：R2三kind实际项目与完整原工作结果

结果是当前source可反复用于不同真实项目的模板子系统，可靠读取/重验/原确认并完成原产品流程。
新source/successor与829RC分开，main当轮导出/通道接线不是模板获得新执行权。

### J5 当前source的安全metadata observer

实现范围：

- 完善已有observer的NOFOLLOW/fstat、inode/size/mtime前后核对、root变更、shortread与非普通文件边界。
- MetadataLimits自身finite/safe/范围有效，file/count/累计bytes限制在接受前生效。
- parseJSON与现有结构化信息复用，lock作opaquebytes，不读取home/env/可执行hook或脚本正文来补能力。

实际 consumer：

- main已登记root→runtime observer及现有只读CLI使用相同实现，不能另造scanner/第二registry。
- 异常metadata只给脱敏code/target-relative原因，不把root/key/原文带到公共preview。

验收正负：

- 正确重复观察、文件被替换/修改、权限失败/symlink/oversized/坏limits都有准确有限结果。
- 缺文件/拒绝读取不能被当“无依赖/无脚本”的完整事实，未知不补空成功。

source 交接：

- 交最小runtime/CLI共享sourceclosure和main真实consumer、byte/文件成本与错误向量。
- 发布后继续配置/用户编辑语义，不重复安装/运行项目来判断metadata。

### J6 当前config重用与预览失效治理

实现范围：

- currentconfigschema/revision/project/profile/check/scopeexpiry和facts/catalog/字段identity都明确参与预览重验。
- 用户goal编辑只改变goal，完整scope/criteria/profile由当前serverfields保持，选择变化使旧apply失效。
- 不用hash/preview当authorizationtoken，不把配置事实或freshness推成native已测试/安装保证。

实际 consumer：

- main真实POSTpreview/原form提交前重验是唯一运行消费者，J早交稳定API让main复用。
- F只带restrictedselection，不能自行重构不一致完整fields；J不给其私有旁路。

验收正负：

- samecontent合法reobserve稳定，content/config/catalog/registeredcheck变化准确失效且可重新生成。
- future/stale/invalidschema/过期grant、wrongproject/profile和不支持输入不能借同digest穿透。

source 交接：

- 交正式不变量、实际当前main/CLI调用与兼容策略，不静默修改旧draft协议语义。
- checkpoint后继续多项目三kind全链，而不是停在新增一个assert helper。

### J7 三kind两项目原产品端到端消费

实现范围：

- 三种模板在至少两个不同已注册项目/检查/profile/managerfacts上实际进入原preview/apply/edit/confirm。
- 原Application/Broker/检查/currentcandidate/人工accept形成真实受控工作，原ID/contract/receipt/产物可追溯。
- 不直接写accepted/candidate终态，不自动register/install/run，已选择check仍走原verifierpolicy。

实际 consumer：

- main/F真实App/HTTP组合与A/C原事实consumer一致，不另起coordinator或只提供静态fixture。
- ordinary普通工作与B/I未准入原Work恢复各自分层，J不能以新的normalWork填recovered结果。

验收正负：

- 两项目/三kind正常、问题/检查失败/修正/明确接受和回原历史可复现，preview/取消不创建。
- 同名不同ID、不同check/scope/profile、unknownresponse同ID重试、旧body冲突准确处理。

source 交接：

- 交实际mainconsumer、输入/fields/原Work/verification/acceptance关系和准确source/层别。
- 发布后继续当前successor兼容，不把纯库三kind测试数当完整日常产品。

### J8 R2可打包模块与第二包交付

实现范围：

- 收口当前runtime/CLI/source/dist/exports/docs闭包，mainbuildcontracts后可构建J并供D发行。
- 新source进入独立准确R2successor，829RC保持不变；rootdeps/lock/importer只由main处理。
- 准确包中有main原表单/模板入口才声明同包能力，不以旧1fba/RCsource或packdryrun认证最新。

实际 consumer：

- main/D/E/F使用真实JAPI与准确文件bytes，Nodeobserver不进入browser，browser只用公开DTO。
- E独立required/browser/installed判断，J提供原始输入而不改其assertions。

验收正负：

- freshNode/实际包consumer无需其他Agentnode_modules，当前普通模板全链正确，错误closure/mode明确未达。
- privatekey/profile/home内容不复制，缺模块保持旧产品/手动委托，不自动加载别source补包。

source 交接：

- 发布包二完整module/actualconsumer/packaging输入与文档，source/RC/R2tuple清楚。
- 直接进入迁移项目与同事支持，不等用户再派最后一包。

## 交付包三：迁移项目适配、重复使用与同事支持

结果是同事迁入/重绑项目后可安全观察并生成当前建议的工具，明确信息不足与原检查/权限边界。
迁移适配不是复制原批准、执行profile或自行安装环境，也不是新的恢复/检查authority。

### J9 迁移/重绑项目的当前facts重建

实现范围：

- 消费main/D/A已准入projectregistration/restore资料，通过当前明确登记root重新观察必要metadata。
- 新root、同名不同ID、原profile/check缺失、lock/manager变化准确反映，不继承旧执行grant/credential。
- source facts与当前facts/content/provenance分别记录，rootmapping由原main流程管理，J不写迁移SQL或registry。

实际 consumer：

- main原导入/配置/preview与Jobserver匹配当前项目，A/C只提供原事实，D负责实际资料搬运。
- 不在J复制projectstore、恢复engine或另造账户/实例生命周期。

验收正负：

- 正确显式重绑Node/npm/pnpm项目可产生当前可审阅建议，未重绑/foreignroot/旧key缺失准确needs_input。
- 原数据/旧grant/个人实例不动，不用扫描home或运行install来猜迁移完成。

source 交接：

- 交迁移facts来源、当前登记root输入、真实例子与owner协作contract。
- 发布后继续迁移后的模板/检查适配，不把只读路径改名当整体迁移成功。

### J10 迁移项目的模板与注册检查适配

实现范围：

- 三kind依当前projectscope/profile/defaultcriteria/registeredchecks生成建议，原checkID/revision/policy不被metadata覆盖。
- 只支持产品已注册Node/npm/pnpm能力，unknownlanguage/workspace/member/version给needs_input/unsupported，不扩平台/语言执行。
- 不把package.scripts变executable；新增check只能作为requires_registration待人审数据，原可信流程注册/确认。

实际 consumer：

- main原NewWorkForm/ProjectSettings与verifier/environmentpolicy保持唯一，J匹配器给准确缺口和可编辑草案。
- F展示缺输入/不可用，不通过模板选择自动换agent、放宽排除/expiry或触发安装。

验收正负：

- 已重新登记且具备checks/profile的项目三kind可复现，unknown/blocked/readonly/原scope不兼容准确解释。
- oldgrant/旧source/checkrevision或同名foreign项目不能复用成当前批准，未确认零业务执行。

source 交接：

- 交实际迁移后mainconsumer/字段/缺口映射，不新runner/verifier/安装recipe。
- sourcecheckpoint后继续CLI/支持，不靠纯schema通过声称当前环境可执行。

### J11 长用CLI、错误恢复与开发指南

实现范围：

- 完善现有显式只读CLI的重复观察、输出文件/版本、limits与错误支持，不新增后台scanner/缓存权威。
- 新文件0600/exclusive、不覆盖，失败无假完整数据；文档解释freshness/content/config、needs_input与原用户确认。
- 提供实际普通/迁移项目使用例和版本/支持限制，不写未测语言/native/value或自动installrun操作。

实际 consumer：

- 同事按docs/project-recipes和main原入口操作，main/F拿typedpreview，H/E能复核source/输入/结果。
- J不执行版本命令、项目hook或模型任务来补未知信息，也不替main收集秘密材料。

验收正负：

- 多次相同输入稳定，合法新观察可解释，错文件/权限/symlink/大输入/旧版本有限失败且原项目不变。
- 首次上手与重开可回原手动流程，错误脱敏可定位，不要求手工改库/复制profile。

source 交接：

- 交完整库/CLI/docs/API、实际新同事例子和维护说明，不以README完成代替运行consumer。
- 发布后继续三包整合与独立验收输入，整goal未完成不提前停。

### J12 可重复产品模块与三包最终交接

实现范围：

- 收口R1当前facts基线、R2三kind实际项目全链、R3迁移适配/长用/支持，所有声明对应真实consumer。
- 维护版本/freshness/schema/scope/来源边界与runtime/CLI一致性，不增加权限、runner、安装器、ledger或模型loop。
- source和准确RC/R2successor分层，E独立verdict不由J的draft状态或测试数量替代。

实际 consumer：

- main/F/D/E/A/C通过现有公开inputs/ports使用同一匹配/观察实现，root/deps/HTTP/UI由main集成。
- 普通模板不等于B/I原恢复/native/private-target；缺外部准入精准未达，不伪造目标/结果。

验收正负：

- 三包真实library/CLI/当前preview/原确认/迁移适配可复跑，相关strict/build/有限positive-negative成立。
- 无自动register/install/run、vendor/model/native、旧实例/无关credential/globaldiscovery动作，原状态完整。

source 交接：

- 写 `reports/project-recipes/wave31-status.json`，逐包/12outcomes列source、actualconsumer、命令/exit、范围/错误与限制。
- 显式stage自有四类路径推原origin，不upstream/reset/清历史，整个三包真实完成才结束goal。

## 独立备选队列

- mainpreview/sharedschema未发布：先交稳定libraryAPI与真实root/currentconfig例子，继续CLI/compat/故障，不另造API/UI。
- F日常接线未到：给同serverfields和restrictedselection需求，继续main实际preview/普通/迁移数据，不复制formauthority。
- R2包未到：R1锁829RC不追main，新source独立交接，source-only不冒充新包能力。
- vendor/model/native自动调用0；BUNKNOWN不可花，EpilotBLOCKED不reset/topup/refund/补样，不做价格/模型研究。
- 保留十二服务5180–5191/8796–8807与allstate/profile/tar/ledger/dirty，仅fresh独立出生完整资源可受信号。

## 整包完成条件

- 三个连续包真正交当前facts/模板基线、实际三kind两项目、迁移/同事支持，不将旧四成果改名十二gate。
- source早交后持续wholegoal，缺外部包/准入准确未达，旧atom/observer/普通确认已关范围保持。
- main/A/B/I/E原ownership不变，无新Driver/CAC/桌面壳/autoaccept/动态DAG/安装recipe/第二permissionledger。
