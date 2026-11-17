# Agent A：可信历史与持久数据的完整子系统

日期：2026-11-17。继续 `/Users/hh/Desktop/joker/superagent-agent-a`。
原分支 `codex/g2-workspaces-verification`，保留全部 dirty、数据、报告和历史。
先读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读 [0092 主线完成历史消费者](../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)、[0093 架构复审](../../docs/rfcs/WP-16/0093-wave-36-reviewed-architecture.md)、[0094 子系统闭环](../../docs/rfcs/WP-16/0094-wave-36-whole-subsystem-closures.md)。
保留改动后同步 `origin/main`，固定实际 source；只推 owned 路径到原 origin 分支。

## Whole-Subsystem Goal 与历史延续

建立或延续一个 goal：让原工作历史、原产物、非空恢复和日常查询在实际产品中持续可用。
本轮是四个更大的端到端产品闭环，不是把九阶段加到十二，不按测试/按钮/接口数量计算成果。
旧 A1–A3 合入闭环一，A4–A5 合入二，A6–A7 合入三，A8–A9 合入四；原验收矩阵不清零。
每闭环完成生产实现→默认实际 consumer→必要正负→同版本/维护交接。
源码早交后连续推进四闭环、联调及独立队列，不在小 fix 或 source 检查点停工。
无同日截止、工时、持续时长或 token 承诺，不反复全套或长 soak 凑执行时间。

- 固定起点 `eac2c9d8`，exact final envelope 旧1字节问题已真关闭，保留4MiB/+1的正反控例。
- 正常120条 keyset、原 historical/current 分离、实际 artifact bytes与不同PID原ID读回保留。
- 主线本轮用 A exact source 接独立 work-completion-history 严格三kind metadata/签名cursor和原WorkEvidencePanel。
- 以0092实际源码为准，不继续写等另一个DTO，不复制新HTTP/reader，不将F旧事件timeline改名充当完成历史。
- 仅拥有 `packages/storage/`、`packages/workflows/`；A唯一生产SQL/必要append-only迁移。

## 产品闭环一：原工作历史到可信原产物

生产实现：

- 将正式 `completionHistory`、原 WorkIndex/evidence/artifact 组成一个可连续读的生产数据产品。
- 保持所有kind的精确最终JSON、行/字节/来源接受预算，blocked/page_budget/omitted语义明确。
- 读取/解析前的成本与deadline有实际边界，不能只用最终响应4MiB推断内存或硬时间SLA。
- source/caller/物理扫描候选数/真实review数/unknown分开；活keyset不是冻结多页snapshot。
- 原canonical key、original attempt/binding/contract/candidate/verification和receipt关系保持。
- 历史有效、currentLink与当前可接受资格分开，原Completion/current/preflight/accept继续唯一权威。
- 正文经原授权reader读真实bytes/digest/format；metadata可见不能推出artifact正文可见。
- 历史verification不得被强贴当前contract，原版本未知时明确未知或从原link查证。

默认实际 consumer：

- main原WorkEvidence表面实际调用新history port和已准入公开DTO，用户能多页浏览并回原Work。
- main核principal/current project/Scope并签名外部cursor，A给正式数据与可编译caller。
- 初始三kind metadata先做实；reviews/attempts扩展须严格公开投影，不能透传raw binding/resources/argv。
- C/F用同批原对象，旧事件timeline/context历史保留，不把协议重贴为同一件能力。

必要正负：

- 两项目多合同/attempt、正常多页、同时间ID、重复与页间追加均有实际对照。
- exact bytes临界、过大首条、缺正文/坏摘要、坏canonical/shape、foreign和旧cursor明确处理。
- 正常metadata/原文各自守Scope，当前指针变化不抹旧历史也不复活接受资格。
- 读/续页/下载不增加业务事件、队列消费、接受、模型或native调用。

同版本/维护交接：

- 早交正式reader/类型/公开投影需求、原IDs/内容证据与命令exit，供main持续审入。
- source、实际HTTP/App、安装/native层分列；接线尚未达只能标该层，不能拿helper报告替代。
- 本闭环source后继续二、三、四，不重新派一个“下一页修复”goal。

## 产品闭环二：非空两格式快照到当前授权恢复读取

生产实现：

- 复用默认v1/显式v2 snapshot/verify/restore，形成非空原业务和原产物的完整恢复闭包。
- 原Work/Q&A/check/候选/接受/决定/source/artifact有独立内容和完整inventory期望。
- 恢复后核同一批IDs、bytes、source/caller覆盖、历史/current及原回执，不以空表/空artifact充证明。
- 新根只读与当前principal/Scope/review绑定由原main路径完成，不复制credential、旧grant或writer静止结论。
- held queue/provider/receipt保留，读取不自动激活writer、重发答案或创建替代Work。
- 旧格式和新模块兼容政策明确，wrong root/source/版本及target-only drift保留原事实。

默认实际 consumer：

- main/C正式data/body/history消费者读取两格式恢复数据，使用当前授权而非源机器旧权限。
- D的完整迁移/发行子系统消费正式A依赖，E独立核准确cohort，不另造安装器或临时ZIP。
- 从恢复历史能返回原Work/原证据并解释哪些仅历史可读，哪些当前操作仍禁止。

必要正负：

- 两格式、两个原项目、非空原产物和原receipt在合法新根读回一致。
- manifest/inventory不完整、换/缺正文、错误source/root、target drift和未授权原文独立拒绝。
- readonly、held queue和provider无隐式增量，旧接受/模型/运行批准不迁移。
- source恢复/普通重开不冒称安装实例重启或原native活动故障接管。

同版本/维护交接：

- 交正式restore/reader/内容proof闭包、真实原始数据、两格式命令exit及边界。
- 同版本producer/consumer可复现，D/E未到只保留该层HELD，其他闭环继续。
- 不因文档/测试更新反复refreeze，不借另一包/checkout补缺的包内能力。

## 产品闭环三：多项目日常查询到同原对象故障读回

生产实现：

- 把项目/会话/Work目录、有限搜索/过滤、时间线、历史和artifact引用接成日常数据路径。
- 同名不同ID、归档/缺失、多个合同/attempt和current关系准确，分页不串项目或漏掉原对象。
- 使用原Store/FTS/索引，不以派生表绕内容proof，不全库扫描或增加查询/统计ledger。
- 规模下统一source/caller/bytes/时间预算，来源缺失/截断/unknown有可操作状态。
- 普通Store/进程重开和原command/body核对沿原UoW/receipt/queue，不换ID消除未知。
- written/observed/recorded/indeterminate分开，冲突、重复和迟到不重复Outcome/接受/计时。
- B/I活动恢复只消费已准入原事实；历史可读不证明writer退出、quiescence或原槽归还。

默认实际 consumer：

- actual main/F/C从原目录定位非空Work、浏览证据/历史并回原会话，使用同一正式数据闭包。
- main/C/H从同一原Work/receipt读回已知/未知/拒绝，E可按原对象独立定位。
- 正式caller不依赖另一Agent的node_modules、私有SQL或固定测试路径。

必要正负：

- 合法大数据、旧caller、两项目隔离、普通重开及原ID核对有有限对照。
- 读中source变化、旧主体/合同/过滤、坏格式、大entry、unknown和缺正文不变完整零值。
- 查询/索引错误不移动current指针、不消费held queue，不绕产品拒绝强清理。
- 短受控序列与真实native/长期稳定分层，所有未知现场保留。

同版本/维护交接：

- 交生产query/reader/故障政策、实际consumer与成本记录；必要索引/迁移有真实理由。
- 原schema/旧格式兼容和当前不可用策略明确，异常能按操作手册定位而非手改表。
- 收到main反馈继续同一子系统goal，不以一组规模测试绿灯结束。

## 产品闭环四：正式模块到同版本默认产品与维护交接

生产实现：

- 收口生产ports/exports/source/dist、构建顺序、原文与历史DTO、恢复/query依赖和兼容版本。
- storage/index只取需要的completion exports，不混入main没有依赖的content-proof export。
- workflows/ports保持main既有recoverySource结构，不整贴旧累计hunk覆盖当前接口。
- 新公共wire/HTTP/权限由main冻结，原current/accept/receipt生命周期不变，E保持独立oracle。
- 同事操作材料覆盖原对象查询、历史/内容、恢复review、partial/unknown、故障保留和可维护更新。
- 发行属于完整工程，选择集成版本后再由D/E准确闭合，不用临时封装或测试数代理工程完成。

默认实际 consumer：

- main/F/C实际版本使用本子系统数据，D的同cohort模块无需source checkout补包。
- 一个普通产品连续完成查询、历史续页、原bytes审阅、重开与授权恢复读取。
- E独立核必要对象/结果，A不自授installed/native/recovery/value/release资格。

必要正负：

- 默认consumer、必要strict/有限正负、旧API/格式及正式依赖闭包成立。
- 缺export/依赖、错包/版本、未知能力和未安装层准确拒绝/HELD，不切fixture补齐。
- 各层范围能按同一source/producer/consumer/对象复现，不混多个cohort结果。

同版本/维护交接：

- 状态写 `packages/workflows/reports/wave36-status.json`，按四闭环记录source/consumer/原IDs/bytes/命令/已合/余项。
- 旧九验收点留作历史矩阵并映射本闭环，保留原FAIL/修后结果，不重置或按新数量抬分。
- 四闭环均实际被main消费且必要正负/维护材料齐，才完成whole-subsystem goal；未达层不伪装完成。

## 独立队列与永久边界

- main/F/C公共输入未到：早交typed port、真实非空例和最小RFC，继续owned内容/恢复/兼容/故障。
- 依赖只阻相应层，四闭环与独立队列连续，不无限轮询或反复长soak。
- owned仅storage/workflows；main掌shared/root/contracts/lock/HTTP/App/transport，A唯一必要生产迁移，E唯一产品断言。
- 自动真实vendor/model/native0；B cap4 UNKNOWN和E原blocked pilot不reset/topup/refund/补样或价格研究。
- 十二服务及state/profile/tar/ledger/dirty/runs全保留，完整独立birth/全资源且逐次fresh才可受信号，UNKNOWNretain。
- 无global discovery、借凭据、真实CLI回退、新Driver/CAC/桌面/自动接受/第二ledger或生命周期，不新建checkout/线程。
- CAC排除，不做first-ZIP冲刺；source/controlled/installed/native/recovered/value分层，旧九矩阵不清零。
