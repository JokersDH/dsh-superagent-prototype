# Agent C：决定、上下文与普通工作的三个连续工程包

日期：2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-c`。
原分支 `codex/g3-assistant-context`，保留原脏lock、runs、报告与所有历史。
先读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读 [0089 主线实际配置消费者](../../docs/rfcs/WP-16/0089-main-model-configuration-consumer.md)、[0090 架构复审](../../docs/rfcs/WP-16/0090-wave-35-reviewed-architecture.md)、[0091 连续子系统程序](../../docs/rfcs/WP-16/0091-wave-35-continuous-subsystem-program.md)。
保留改动后同步 `origin/main`，固定实际source；只推owned路径到原origin分支。

## 一个 Whole Goal，三个连续工程包

建立或延续一个goal：让显式当前决定、安全上下文和草稿在原新工作确认及日常重开中真正可用。
三包各三个完整生产成果，共九个，继续原未闭合整链而非重启九个小修。
每成果有实现、actual consumer、必要正负与source交接，early/intermediate/final后继续三个包/联调/独立队列。
无同日、工时、持续时长或token承诺，不在CLI、helper或一组测试处结束whole goal。

- 固定起点 `0929145f`；旧strict/draft权限/expiry、完整已报Scope/provenance/deepfreeze向量已真关闭，不重派。
- 新问题是先截整个项目默认32再选ID，误把仍当前有效的被截决定报not_found。
- prepare/assert已有创建前source调用，但原create_work未绑定preparation，也未在原事务执行最终guard。
- 使用真实 `captureDecisionSnapshot`、`revalidateDecisionSnapshot`、`prepareDecisionSelection`、`assertDecisionSelectionCurrent`。
- 复用 `DecisionGovernance`、`decisionContextProvider`、`ContextComposer`、main `ProductContextPreview`，不造第二框架。
- main本轮已交原私有模型配置/API/原ModelPanel消费者；它不等于决定绑定已完成，也不是只欠data port。

## 工程包一：当前决定到原新工作确认

### 成果 C1：有界显式选择的完整 Capture 产品

实施范围：

- 明确selected IDs、max、source/caller coverage及当前有效记录的有限读取策略。
- 显式所选集合在预算内按可信当前记录核对，不先截项目窗口再把未读但有效ID误报missing/inactive。
- 复用原getEffective/listEffectiveWindow，重复/越界/错误项目和扫描不完整有严格不同结果。
- 输入时间/ID/limits有限，选择只收窄当前有效集合，不新增grant、自动规则或全库扫描。

实际 consumer：

- main兼容决定选择器和正式provider消费真实多决定项目，F拿可选/缺失/部分的正确DTO。

必要正负：

- 超过32条当前决定、少量显式选择、caller cap和合法当前源有真实对照。
- 不可读源、重复/foreign/未知ID、非法预算与scan_incomplete不混为完整空集或已撤销。

Source 交接：

- 早交正式capture/selection契约、actual caller与命令exit，发布后继续 C2，不只修一个not_found。

### 成果 C2：Canonical Snapshot 与当前治理接口

实施范围：

- 保持完整scope/version/content/sourceMessageId/textDigest/recordedAt/expiry对回可信记录和深不可变数据。
- 统一严格协议/Scope/时间/数组/未知字段输入，优先使用已有结构化schema，不在各consumer复制宽松校验。
- 当前有效、source stale、撤销/替代、过期、caller截断和历史可读区分，valid仍只是data-only。
- 复用原治理和composer有效性；不把snapshot/hash当native批准、全历史完整性或原Work权限。

实际 consumer：

- 原main上下文/决定读取与新选择consumer使用一致canonical projection，真实DTO可解释原出处与版本。

必要正负：

- 已关闭的嵌套mutation、扩scope、去排除、伪source/time/version向量保持拒绝，正常当前选择可用。
- 缺字段/坏协议、未知时间/Scope、inactive/source invalid和未完成扫描有正确有限结果。

Source 交接：

- 交生产类型/版本规则、source依赖及实际main兼容调用，继续 C3，不重写原provider或HTTP。

### 成果 C3：原 Work 创建时真正绑定决定确认

实施范围：

- 用户在main原表单预览所选决定版本，明确确认后将原引用固定到新Work/合同上下文。
- main掌共享schema/原命令/表单/事务，C提供可审preparation/assert和可信记录接口，不新ledger/批准token。
- 最终写入边界检查当前actor/项目/Scope/source/version，prepare后变化要求重预览，不靠调用者自觉先assert。
- 不把“assert一次后发无引用raw create、再contextSend”称已绑定；无选择时原普通委托继续可用。

实际 consumer：

- actual main原create_work链在创建前真正消费所选preparation，并能从原Work读取冻结版本/来源引用。

必要正负：

- 两项目合法选择到原Work/current上下文可追溯，取消/预览无业务写或自动模型请求。
- prepare后撤销/替代/源或配置变化、旧主体/Scope/version、unknown回执在原guard处拒绝或核对。

Source 交接：

- 交包一完整生产接口、真实原创建consumer、原IDs/bytes与必要main接线，直接进入包二。

## 工程包二：普通上下文、治理与草稿连续性

### 成果 C4：原上下文与来源的完整生命周期

实施范围：

- 让原preview→明确选择→prepare/assert→send→冻结来源→历史读取成为连续可用生产流。
- 项目/会话/Work/合同/配置/expiry/source变化在原边界重新核对，旧token不能再次授权发送。
- 预算/省略/unknown/partial/withheld与正文访问保持真实，不把原文可读推成执行许可。
- trusted用户决定与普通不可信来源内容分层，不新增LLM loop、自动学习或第二来源writer。

实际 consumer：

- main原HTTP/App及C正式caller消费同批非空原数据，F可呈现选择、冻结与失效关系。

必要正负：

- 合法来源、原ID/摘要/冻结bytes可核对；两个项目会话和work-scoped context不串。
- 外来source、过期选择、换合同/权限、缺正文和迟到结果不变完整成功或新批准。

Source 交接：

- 中期交稳定DTO/reader/guard契约、实际consumer和必要有限正负，继续 C5。

### 成果 C5：显式决定记录、替代与撤销体验

实施范围：

- 完整消费原record/supersede/revoke、来源有效性和当前适用集合，版本与原出处可审计。
- 仅显式用户确认成为决定；permission/auth回答、模型候选/testing/shadow规则零自动进入。
- 撤回阻止未来选择但不改写已冻结历史，影响运行中Work时交main原修订/停止流程。
- 原receipt replay与unknown核对不复活旧状态、不重复写决定或引入另一个current指针。

实际 consumer：

- 实际main会话/决定/工作上下文消费者沿原Store和原命令工作，不只session CLI读自己的样例。

必要正负：

- 记录→替代→撤销→原receipt重放及历史审计有真实连续对象，未来预览只含合法当前项。
- source变化、旧版本/主体、冲突或扫描不完整保持明确，旧历史不重新变当前批准。

Source 交接：

- 交治理实际用户链、原对象/版本/命令和main/F最小补线，持续 C6。

### 成果 C6：安全草稿、原回执与两项目普通重开

实施范围：

- 沿已安全的private文件创建/明确更新/有界读取，完成项目/会话/选择/来源版本与草稿的连续状态。
- TTL尚有效也核对当前source/config，旧草稿只是可再预览数据，不是confirm token或可迁移批准。
- 同commandId/body处理lost response、written/observed/unknown，错误中保留核对原ID，不默认换ID重发。
- 两项目普通关闭重开保留原来源/冻结bytes/决定状态；不新建会话DB、执行ledger或权限缓存。

实际 consumer：

- main/F与正式CLI使用相同DTO和错误语义恢复输入、重预览并经原确认继续。

必要正负：

- private创建/更新/有效/过期及原回执恢复可用，旧文件权限/symlink/invalid time回归保持。
- 跨项目、source/version变化、冲突body和旧token不造成重复业务；秘密不进持久草稿/日志。

Source 交接：

- 交包二完整source、两项目实际consumer/命令/范围后继续第三包，不在旧三修复处停工。

## 工程包三：默认 API、兼容与持续交付

### 成果 C7：Main/F 默认上下文与决定消费者

实施范围：

- 将前两包typed接口接到main原应用/公开API/原表单，支持F真实页面，不能以CLI可运行当默认产品完成。
- original Source/Scope/body gate、事务与guard保持，跨shared契约仅main冻结和生成。
- DTO只暴露必要当前/历史/缺失信息，Node crypto/文件和治理实现不进入浏览器。
- 支持旧API/缺模块/readonly的准确退化，普通对话/原手动委托不因可选新能力失败。

实际 consumer：

- 一个actual App普通用户链能选择决定/来源、确认新Work并重开审阅原引用，A/F共享真实原数据。

必要正负：

- 同一集成source实际默认消费者和合法请求通过，metadata/body访问分别核对。
- 缺版本/错schema/外来身份/旧模块/缺能力明确拒绝或不可用，不回退私有SQL或伪fixture。

Source 交接：

- 交正式exports/DTO/实际public caller与最小main接线，继续 C8，不复制RootHTTP/App。

### 成果 C8：有界兼容与失效故障工程

实施范围：

- 收口大量决定/来源、selected bounds、序列化/读取预算、时间与旧格式政策，不以增上限掩盖缺口。
- 对prepare到使用、source读中变化、旧身份响应、失效/缺失及重开冲突给可解释有限结果。
- 原UoW边界清楚，不跨await持事务；活source不是冻结全集，未知保持未知。
- 原native/B恢复和研究层未达不阻普通工程，也不能拿等价fixture或过去成果代替。

实际 consumer：

- 当前main/A/F正式消费者在同批原对象上处理故障和兼容，而非新coordinator/同名provider。

必要正负：

- 合法规模/旧caller/原始重开有正例，必要反例有限复现且不破坏原状态。
- source截断/未知、坏时间/字段、scope变化和冲突结果不伪造当前或完整空值。

Source 交接：

- 交可维护政策、必要source/dist依赖和原始事实，继续 C9，不重复全套或长soak填时间。

### 成果 C9：可操作的完整子系统交接

实施范围：

- 整理选择/准备/确认/发送/记录撤销/草稿/原来源重开的真实操作与排障路径。
- 原对象、source/版本/digest、命令exit、已main/候选与真实未达对应，文档不复制旧package主张。
- 选定集成版本后由D/E验准确安装，C不自授native/recovery/value/release。
- 有用接口早交后持续所有三包联调，不用报告DONE、接口数量或测试数替代默认真实消费。

实际 consumer：

- main/F/A/H能用正式接口定位原事实，E独立验收，不需要手改表或拷贝凭据/profile。

必要正负：

- 相关strict、实际普通整链、必要正负及可操作指南齐，原权限不放宽。
- 未装/未达真实native/同Work活动恢复/长期运行或收益保持准确，不混层补全。

Source 交接：

- 后期写 `packages/context/reports/wave35-status.json`，九成果source/consumer/原IDs/命令/已合/余项齐。

## 独立备选队列与完成条件

- main新schema/原表单未到：交稳定preparation/DTO和真实caller，继续治理/草稿/兼容/失效，不另起API。
- A/F未到：保留真实partial/unknown，继续owned生产能力；包一后继续包二/三，不逐项等派工。
- 九成果均有生产实现、actual consumer、必要正负与handoff，并进入main实际集成版本，才完成whole goal。
- owned仅context/proposals/knowledge/routing；main掌root/contracts/lock/HTTP/App/transport/授权，A唯一SQL迁移，E唯一产品断言。
- 自动真实vendor/model/native0，B cap4 UNKNOWN/E原blocked pilot不reset/topup/refund/补样或价格研究。
- 十二服务及state/profile/tar/ledger/dirty/runs全保留；仅完整独立birth/资源且逐次fresh可受信号，UNKNOWNretain。
- 无global discovery、借凭据、真实CLI回退、新Driver/CAC/桌面/自动接受/第二ledger或生命周期，不新建checkout/线程。
- CAC排除，安装是完整工程后续交付，不做临时ZIP冲刺；数据valid不是grant，未达不靠九成果数量加分。
