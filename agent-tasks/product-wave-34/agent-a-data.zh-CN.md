# Agent A：可信历史与持久数据产品的两个连续工程包

日期：2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-a`。
原分支 `codex/g2-workspaces-verification`，保留全部 dirty、原数据、报告与历史。
先读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读 [0086 主线实际消费者](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)、[0087 架构复审](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)、[0088 两包工程](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。
保留改动后同步 `origin/main`，固定最新实际 source；不要按旧 main 缺口推断当前接口仍不存在。

## 一个 Whole Goal，两个连续工程包

建立或延续一个 goal：交付可在完整产品中持续浏览、核对原产物并重开恢复的可信数据子系统。
工程包一完成生产历史与原产物；工程包二完成非空恢复、规模故障和真正主线消费。
每包三个完整生产成果，共六个；不是六个微修补、测试组或等待再次批准的阶段。
早、中、晚发布可运行 source 后继续全部两个包和独立队列，不能在包一或检查点结束 goal。
无同日截止、工时、持续时长或 token 承诺；不以重复全套测试和长 soak 凑工作量。

- 固定起点 `6bbbea38`，正常120条 keyset 50+50+20、原历史/current 区分和真实 artifact bytes 已有正证。
- keyset 是活窗口：边界前新增需 fresh start，边界后新增可能进入续页，不能称冻结多页 snapshot。
- 新 P2 是 all-kind byte accounting 和首条超限无 progress；不是继续修已经关闭的 source50 标签问题。
- main `23d5a98e` 已交0086原生回调与 G 严格支持消费者；A/C 新不安全断言仍待修，不提前默认准入。
- 先读实际公开 port，早交修后历史 source 让 main 消费，不交另一组孤立报告代替接线。
- 仅拥有 `packages/storage/`、`packages/workflows/`；SQL/必要追加迁移仍由 A 唯一实施。

## 工程包一：生产历史、授权消费与原产物

### 成果 A1：所有历史集合都有界且可继续

实施范围：

- 完成既有 `WorkflowIndex.completionHistory`/`ReadIndexPort`，统一五类集合的记录、总 bytes 与 deadline 政策。
- budget 覆盖序列化 envelope、entry、unclassified/omission，不只在 verifications/reviews 分支计数。
- 首条过大必须明确 blocked/too_large 或提供可解释的受限继续策略，不能 hasMore=true 却无可用 cursor。
- 不静默丢事实绕预算；读取、JSON 解析与正文接受均有实际限制，不先全量读再声称有界。
- 稳定 ID 消歧和活 keyset 语义明确；source/caller 覆盖、物理候选数、真实 review 数与未知总数分开。

实际 consumer：

- 原 Store/WorkIndex 与正式 typed caller 消费所有集合，正常页能继续到原 source50 之后。
- main/C 拿到统一页状态、blocked 原因和进度语义，不通过本地 slice 补生产 continuation。

必要正负：

- 正常小页、多页、同时间 ID、重复读取、limit0 与页间插入均有实际对照，旧120条正证保持。
- 合法大 verification 首条、attempt metadata 超限、坏预算和超时明确拒绝或可恢复，无空 more 死路。

Source 交接：

- 早交生产入口/类型/预算和活窗口契约、actual caller、必要命令 exit，发布后继续 A2。

### 成果 A2：Principal、Scope 与 Cursor 绑定的实际消费者

实施范围：

- 交正式 main 兼容 reader/caller，将原 Work/项目/集合/过滤条件与 continuation 一起传递。
- 内部 base64 cursor 是数据位置，不是权限、签名或 expiry；公开绑定/签名由 main 原 HTTP 入口实现。
- main 先核当前 principal/项目/Scope，再使用 reader；给它可编译 port 与真实非空原数据。
- 提供严格可公开 row DTO，不把 raw runtime binding、host 路径、内部端口或资源清单直接转给网页。
- 兼容现有 evidence/history/current 接口，不新 ledger、candidate 表、批准 token 或 HTTP authority。

实际 consumer：

- main 原 Work/evidence 表面实际取多页，C/F 用同一公开数据，不要求另一 checkout 或私有 SQL。
- 若 main 接线尚未到，先交原正式 port 的可运行 caller；接线未达准确标记，不伪称已集成。

必要正负：

- 两项目、多合同和多 attempt 的合法读取稳定，原用户能从历史返回当前 Work。
- foreign project/Work/集合、旧 auth/Scope/过滤条件或坏 cursor 被拒，unknown 不降为完整空历史。

Source 交接：

- 中期交最小 source/typed consumer/DTO 和 main 自有 HTTP 需求，继续 A3，不另起 API 产品。

### 成果 A3：Canonical 历史、来源与原 Artifact 内容闭环

实施范围：

- 原 review 按 original attempt/binding/contract/candidate/verification 验证，历史可读与 current eligibility 分开。
- 原 canonical key、严格 shape、unclassified 原因及历史 receipt 保留，不因展示要求放宽。
- 关联原 artifactIds、verification、接受主体、冻结 source 和真实 bytes/digest/format，而非只核64hex。
- 内容经原授权 artifact/evidence reader 读取，使用有界数据与格式解析，不由 metadata 可见推出原文可见。
- 数据缺失、损坏或主体变化能定位原事实；既有 current/preflight/accept 仍唯一 authority。

实际 consumer：

- 同一原 Work 的历史页、证据/产物内容与当前关系由 main/C/F 实际消费，可追到原 IDs。
- 独立 reader 进程通过原 ArtifactStore 验 bytes/digest，原人工接受流程不被数据投影改变。

必要正负：

- 正常原产物内容/摘要/格式与 review/verification/receipt 一致，新 current 不抹掉旧合法历史。
- 缺/换正文、错项目、错合同、非 canonical/坏 shape 或 old receipt 不能伪造有效当前候选。

Source 交接：

- 发布包一完整生产 source、actual consumer 和内容证据后，直接进入工程包二，不等再次派工。

## 工程包二：恢复、规模故障与主线完整交接

### 成果 A4：非空 V1/V2 恢复保留原语义

实施范围：

- 复用既有 source-v1/default 与显式 v2 snapshot/verify/restore，不另建备份协议或恢复账本。
- 同批非空原 Work/问题/回答/检查/候选/接受/决定/来源/产物建立独立内容与 inventory 期望。
- 正式恢复到独立新根后核原 IDs、正文 bytes、coverage/current/history 和 source 映射。
- 恢复只读/held queue/provider/原 receipt 行为保持，不复制 credential、旧批准或 writer 静止结论。
- 安装/主机/target 准入由原 owner 闭合，source 恢复事实不升级为已安装或真实 native 恢复。

实际 consumer：

- main/C 原数据与原文 reader 消费两格式正式恢复数据；D 使用正式依赖，E 独立判断版本范围。
- 不靠空 DB/空 artifacts/新 normal Work 顶替非空原数据，也不要求临时 ZIP 冲刺。

必要正负：

- 两格式真实非空 restore/readback 的原实体、正文摘要与 held 状态一致，旧合法格式保持兼容。
- wrong source/root/manifest、缺或替换 artifact、target-only drift 与不完整 inventory 独立拒绝并保留现场。

Source 交接：

- 交真实非空恢复 consumer/原 IDs/bytes/命令 exit 和 source/安装边界，继续 A5。

### 成果 A5：数据规模、兼容与故障后的 Same-Work Readback

实施范围：

- 多项目/多合同/多 attempt/大量历史下仍受统一页/bytes/deadline 限制，不全库扫描或无界 COUNT 拼字段。
- 对追加、重开、读中 source 变化、超限、缺正文和未知回执给稳定合法状态，不伪造 exactly-once。
- 通过原 UoW/receipt/queue/索引和读前后核对保持同 Work/command/body，不能换 ID 消除 unknown。
- 源级普通重开、独立 reader 与实际主线运行消费者分层；live B 恢复未准入不补假结果。
- 必要索引/迁移凭真实成本理由追加，旧 schema/格式和调用者兼容，不为整包引入第二存储权威。

实际 consumer：

- 当前 main/C/H 正式消费者在同原 Work/receipt 上读回失败、已读、未知或拒绝，不靠手工改表。
- 与 B/I 相接只消费其已准入原事实，历史/普通数据不等待 private/blocked 研究。

必要正负：

- 大量合法数据、正常重开和有界故障有真实对照，已接受/旧历史/原 commandId 不重复或消失。
- 不完整页、超大 entry、旧主体、冲突 body、错误格式和资源 UNKNOWN 不被显示成完整/已退出。

Source 交接：

- 交规模/兼容/故障政策、实际 reader 和原始结果，必要检查有限执行后继续 A6，不重复旧全套充时长。

### 成果 A6：Main/F/C 可操作的生产数据交付

实施范围：

- 收口 production reader、typed ports/exports、source/dist 依赖、原文与历史 DTO 及操作/维护材料。
- storage/index 只取本轮 completion exports，勿混入 main 尚无依赖的 content-proof export。
- workflows/ports 只取相应 history type/method，保留 main 现有 recoverySource，勿重贴旧累计 hunk。
- 与 main/F/C 拉通实际默认消费者，报告哪些已合、仅 source、受控、安装和 native，不能只交 helper。
- 发行是完整工程并行子系统；选定集成版本后再由 D/E 验准确字节，不用临时包替代工程完成。

实际 consumer：

- 一个实际集成产品能连续浏览、查原产物、重开与读取恢复数据，F/C 不再猜 source/caller 完整性。
- E 可据原始对象和接口独立验收；A 不写其产品 oracle，不自授发行或 native 准入。

必要正负：

- 完整主线兼容 consumer、相关 strict/有限正负和指南齐；旧 caller/source 兼容范围明确。
- 缺导出依赖、错版本、未知能力或未装层不能借其他 checkout/旧包结果补齐。

Source 交接：

- 后期写 `packages/workflows/reports/wave34-status.json`，交两个包六成果及原始 source/对象/命令/余项。

## 独立备选队列与持续执行

- main wire 未到：交正式 port/DTO 和实际 caller，继续预算、内容、兼容、恢复，不另造 HTTP。
- C/F 尚未接：给稳定非空输入/类型，继续生产数据；共享 contract 交最小 RFC 给 main。
- B/private/研究受阻只阻对应层，普通历史、原产物、非空恢复和发行依赖继续。
- 包一 source 发布后直接做包二；第二包受外部依赖时执行 owned 独立队列，不能整 goal 提前 DONE。

## Whole Goal 完成条件与边界

- 六成果均有生产实现、actual consumer、必要正负和 source handoff，且被 main 集成版本实际消费。
- root/contracts/lock/HTTP/App/transport 属 main，A 唯一生产 SQL/必要 append-only migration，E 独占产品断言。
- 自动真实 vendor/model/native0；B cap4 UNKNOWN 不可花，E 原 blocked pilot 不 reset/topup/refund/补样。
- 保留十二用户服务及全部 state/profile/tar/ledger/dirty/runs；仅独立 birth/full 资源且每次 fresh 可受信号。
- 无 global discovery、借凭据、真实 CLI 回退、新 Driver/CAC/桌面/自动接受/第二 ledger 或生命周期。
- CAC排除，不新建 checkout/线程，不做 first-ZIP 冲刺；未达层准确保留，不按测试或成果数量改完成率。
