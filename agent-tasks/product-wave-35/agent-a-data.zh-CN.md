# Agent A：可信数据产品的三个连续工程包

日期：2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-a`。
原分支 `codex/g2-workspaces-verification`，保留全部 dirty、数据、报告和历史。
先读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读 [0089 主线实际配置消费者](../../docs/rfcs/WP-16/0089-main-model-configuration-consumer.md)、[0090 架构复审](../../docs/rfcs/WP-16/0090-wave-35-reviewed-architecture.md)、[0091 连续子系统程序](../../docs/rfcs/WP-16/0091-wave-35-continuous-subsystem-program.md)。
保留改动后同步 `origin/main`，固定真实 source；只推 owned 路径到原 origin 分支。

## 一个 Whole Goal，三个连续工程包

建立或延续一个 goal：让原工作历史、产物、重开恢复和日常查询成为真正被 main 使用的数据产品。
三个连续包各三个完整生产成果，共九个，覆盖原未闭合工程，不重置已测范围或模型预算。
每成果同时交实现、actual consumer、必要正负与 source handoff，不把九个修补或测试组当九块产品。
early/intermediate/final 可运行 source 后继续所有三个包、联调及独立队列，不逐项等派工。
无同日截止、工时、持续时长或 token 承诺，不用反复全套或长 soak 填执行时间。

- 固定起点 `49082c5b`；正常120条分页、真实原产物 bytes/不同 PID 读取与原 ID 重开已有正证。
- 旧巨大首条和 all-kind 例子现在明确 blocked，不重派已关闭的同一修复。
- 新残余是完整最终 envelope 仍可超1字节；更完整的读取前预算/deadline与真正主线 consumer仍需交付。
- main 已交0089原私有配置→认证POST→typed transport→原ModelPanel，不是只欠一个 data port。
- 本轮数据工程独立推进，不等模型试点、活动 native 恢复或临时安装冲刺。

## 工程包一：生产历史与实际授权消费

### 成果 A1：精确有界的完整历史 Reader

实施范围：

- 完成 `completionHistory` 所有 kind 的总记录、读取/解析成本、最终编码 bytes 和 deadline 语义。
- 精确计入 status/reason/returned/hasMore/cursor/coverage/envelope，保留显式 blocked/page_budget。
- 大条目在接受前受限，不全量物化后才声称有界；同步接受预算不冒称可抢占 JS 的硬 SLA。
- 保持活 keyset、ID消歧、source/caller/已知数/未知数，不把物理 verification 候选计成真实 review。

实际 consumer：

- 原 Store/WorkIndex/ReadIndexPort 与 main 兼容 caller 消费正常、部分和 blocked 页，能继续 source50之后。

必要正负：

- 小页、多页、同时间、limit0、重复和插入对照保持；最终编码临界值及各 kind都真正守界。
- 超大首条、预算不足、坏 limits/游标和 deadline 明确拒绝或可恢复，不返回普通空 more 死路。

Source 交接：

- 早交生产 reader/类型/预算政策、实际调用与命令 exit，修复只是完整成果的一部分，继续 A2。

### 成果 A2：原 Work 的真实公开历史消费者

实施范围：

- 交 main 原 Work/evidence 可直接消费的 typed port、严格公开 row DTO 和非空两项目数据。
- principal/current project/Scope 先由 main 判定，外部 cursor 由原 HTTP 签名并绑定筛选/身份。
- 不公开 raw attempt binding、主机路径、内部端口或资源清单，不从内部 base64 推导权限。
- 保留旧 evidence/history/current 调用，接口不足交最小契约，不另起 HTTP/ledger/candidate authority。

实际 consumer：

- actual main 取多页，C/F浏览同批原 Work/contract/attempt/来源数据，返回当前原对象而非新应用。

必要正负：

- 两项目合法页/下一页/原引用真实可用，current与历史语义可核对。
- foreign主体/旧Scope/auth/过滤条件/游标、无进度和超界响应拒绝，不降为完整空历史。

Source 交接：

- 交正式入口/exports/consumer/原 IDs及 main 自有补线，发布后继续 A3，不停在 helper。

### 成果 A3：Canonical 历史与原产物内容产品

实施范围：

- 串联 original binding、contract/candidate/verification、canonical receipt、actor与 artifactIds。
- 真实 bytes/digest/format 和冻结来源经原授权 reader读回，不只比对 metadata 的64hex。
- 历史有效、currentLink、当前接受资格、unclassified/missing/unknown各自明确，原Completion仍唯一。
- 交可公开证据引用、内容读取和差异定位数据，不因 metadata可见就放行正文。

实际 consumer：

- main/C/F 从同一原 Work 浏览历史、核原 artifact/验证/接受关系并回当前视图。

必要正负：

- 原正文/格式/摘要与原 review/receipt一致，新 current不抹旧合法历史。
- 缺/换 bytes、错项目/合同、坏shape/noncanonical与旧 receipt不复活当前批准。

Source 交接：

- 交包一完整生产 source、内容事实与实际消费者，直接进入包二，不等用户再下发。

## 工程包二：非空恢复与 Same-Work 连续性

### 成果 A4：两格式非空语义恢复

实施范围：

- 复用默认 v1/显式 v2 的正式 snapshot/verify/restore，不另造协议或恢复账本。
- 原 Work/Q&A/check/候选/接受/决定/source/artifact具独立内容和完整 inventory期望。
- 在独立新根读同批 IDs/bytes/coverage/history/current，原执行批准和 credentials不迁移。
- readonly/held queue/provider/receipt保持，source恢复不升级为 installed或 native活动接管。

实际 consumer：

- main/C原数据/正文 reader消费两格式非空结果，D/E按真实完整工程版本独立核对。

必要正负：

- 两格式正常原实体、内容和持久状态一致，旧合法格式兼容。
- wrong root/source/版本、target-only drift、缺/换 artifact和不完整 inventory拒绝并保留现场。

Source 交接：

- 交正式非空 restore consumer、原 IDs/bytes/命令/限制，继续 A5，不以空库恢复充成果。

### 成果 A5：原 ID 重开与回执核对

实施范围：

- 普通 Store/进程重开后读回原 Work/合同/receipt/产物及持有队列，不换 ID掩盖未知。
- written/observed/indeterminate/recorded按原事实区分，同 commandId/body冲突和重放保持幂等。
- active故障恢复只消费 B/I已准入原事实，不用新 normal Work或合成 ACK替代。
- 数据可读不证明 writer静止，读取不消费队列、重发答案或重新接受候选。

实际 consumer：

- main/C/H的原只读消费者按同 Work/command读取非空材料，E可独立定位原对象。

必要正负：

- 正常重开、原receipt重放、两个原项目隔离和原bytes有有限对照。
- 旧合同/主体、冲突body、迟到事实和unknown仍准确，Outcome/接受/计时不重复。

Source 交接：

- 交正式原 ID读回 API与实际消费者、错误政策和命令 exit，持续 A6。

### 成果 A6：规模、兼容与数据故障产品

实施范围：

- 多项目/合同/attempt/大历史下统一源/调用者/bytes/时间预算，不无界扫描或展开嵌套对象。
- 覆盖读中变化、容量、缺内容、异常重开和旧schema/格式，使 partial/unknown有可操作结果。
- 用原 UoW/索引/读前后核对，必要迁移凭真实理由 append-only，不增加第二 writer。
- 避免跨 await持事务，不为回归绕产品拒绝清理或把短序列称长期稳定。

实际 consumer：

- 当前 main正式 reader在非空规模场景继续可用，C/F拿一致的可解释错误与覆盖状态。

必要正负：

- 合法大数据、旧 caller和普通重开保持；异常有真实正向对照与有限退出。
- 超界、缺正文、坏格式/版本、旧cursor、UNKNOWN保留，原用户数据和服务不受影响。

Source 交接：

- 交包二生产实现/consumer/兼容与故障材料，继续第三包，不重复旧全套凑时长。

## 工程包三：日常查询与默认产品交付

### 成果 A7：项目、会话与工作查询闭包

实施范围：

- 完成原项目/会话/Work目录、有限搜索和时间线到真实历史/证据引用的数据路径。
- 分页/过滤/归档/缺失与 current关系准确，同名项目与不同ID不串。
- 复用原 Store/FTS/索引，不以派生搜索表绕内容校验或新建统计/权限 ledger。
- 主线当前 Scope限制先于结果和正文访问，支持资料只取得脱敏必要字段。

实际 consumer：

- main/F/C能从原目录定位工作、浏览来源和产物并回原会话，不依赖私有 SQL。

必要正负：

- 两项目非空查找、筛选/分页/历史返回与真实总数或未知说明可用。
- foreign/旧配置、派生索引未完成、坏引用/内容、越界扫描不假称完整成功。

Source 交接：

- 交稳定 query/DTO/reader和实际调用、成本及指南，继续 A8，不只交查询样例。

### 成果 A8：可维护的正式模块闭包

实施范围：

- 收口生产 ports/exports/source/dist、类型和构建顺序，旧消费者与错误/未知语义有明确版本策略。
- storage/index只选本轮必要 completion exports，不混 main没有依赖的 content-proof export。
- workflows/ports保留 main既有 recoverySource结构，避免旧累计 hunk覆盖当前主线。
- D使用完整必要依赖，E独立断言；package/source/proof原协议不因文档或脚本相似而混同。

实际 consumer：

- fresh正式 main/C caller无需另一个Agent checkout或node_modules就能编译和读真实数据。

必要正负：

- 严格类型、必要有限回归及旧 API兼容通过，源码闭包可运行。
- 缺export/依赖、错误schema或旧模块明确不可用，不切fixture或借旧包补齐。

Source 交接：

- 交最小可审生产diff、依赖/命令exit/实际source，继续 A9的默认产品整合。

### 成果 A9：Main/F/C 日常数据交付与操作闭环

实施范围：

- 让三个包的生产能力进入 main实际集成版本，默认历史/证据/查询/恢复reader有真实消费者。
- 操作材料覆盖原对象定位、部分/未知、故障保留与内容核对，不要求手改表或复制profile。
- source/controlled/installed/native/recovery/value分层，发行按选定集成版本由 D/E闭合。
- ordinary数据不等blocked研究或private/native接管，也不能因此宣称完整原恢复已交。

实际 consumer：

- 一个实际产品连续完成原项目查询、历史多页、原bytes审阅、普通重开和非空恢复读取。

必要正负：

- 完整接口/实际主线/必要正负和可操作指南齐，未到的安装/原生活动层诚实列未达。
- 无读触发业务、无元数据授权、无模型/任务/接受增量，不按测试数替代产品完成。

Source 交接：

- 后期写 `packages/workflows/reports/wave35-status.json`，九成果 source/对象/consumer/命令/已合/余项齐。

## 独立备选队列与完成条件

- RootHTTP/F/C未到：交正式 port、非空样例和最小RFC，继续生产边界/内容/兼容/恢复，不另造HTTP。
- 包一source后继续包二/三；外部依赖只阻对应项，owned独立队列继续，不无限轮询。
- 九成果各有生产实现、actual consumer、必要正负和handoff，并进入 main实际版本，才完成 whole goal。
- owned仅storage/workflows；main掌shared/root/contracts/lock/HTTP/App/transport，A唯一必要生产迁移，E唯一产品断言。
- 自动真实vendor/model/native0，B cap4 UNKNOWN/E原blocked pilot不reset/topup/refund/补样或价格研究。
- 十二服务及state/profile/tar/ledger/dirty/runs全保留；完整独立birth/全资源且每次fresh才可受信号，UNKNOWNretain。
- 无global discovery、借凭据、真实CLI回退、新Driver/CAC/桌面/自动接受/第二ledger或生命周期；不新建checkout/线程。
- CAC排除，包装是完整工程后续交付，不做临时ZIP冲刺；原未达链保留，不以九成果数量改完成率。
