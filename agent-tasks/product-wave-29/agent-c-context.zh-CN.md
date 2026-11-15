# Agent C：完成事实、模板普通流与当前产品数据链

日期：2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-c`，分支 `codex/g3-assistant-context`。
仅拥有 context/proposals/knowledge/routing 四包，原 `pnpm-lock.yaml` 差异和全部旧 runs 保留。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0073](../../docs/rfcs/WP-16/0073-main-project-recipe-preview.md)、[0074](../../docs/rfcs/WP-16/0074-wave-29-architecture-and-reviewed-inputs.md)、[0075](../../docs/rfcs/WP-16/0075-wave-29-product-completion-packages.md)。
同步最新 `origin/main`，实际 source/接口以 AGENTS 和 main 检查点为准，十位外部 Agent A–J 加 main 正常并行。
准确 1cd 同 manifest 双格式和原 ProductCompletion restore/current 已过，旧 inventory/FTS/event 三反例已关，不重派。
main 已实际接 J 模板原表单，scopeChoice 按当前 atoms 相交且网页验证通过，不再审查该修复。
D 当前 1ba 含统计但没有 J，E 实际仍 ce64；source/包/独立 verdict 必须分层。

建立或延续 whole-package goal，无完成 deadline/token 预算。24 阶段，在 C4/C8/C12/C16/C20/C24 发布六完整 runnable 结果后继续。
C 不新增 SQL/迁移/确认 authority/ledger 或执行 lifecycle，main 保留 UI/HTTP/授权，E 保留独立断言。

## C1 固定当前公开数据范围

- 记录当前 A/C/main、准确 1cd/1ba/ce64 source 与各自已测能力。
- 原 ProductCompletion.current/metadata 与新 A raw/history facts 区分，旧 source positive 保持。
- 不把新增宽分类字段当已认证候选，也不因此否定原应用 guard 和准确包成功。
- 验收交接：实际接口、已关/新风险和依赖清楚，不以报告 DONE 承认 whole。

## C2 可信 Completion Facts 消费契约

- 与 A/main 对齐严格 review shape、canonical 原 key、完整 Work/contract/candidate/verification/attempt 关系。
- raw/unclassified/history 不能成为 current/accept，未知与历史 coverage 必须准确呈现。
- 不复制私有完成算法或新建候选表，复用原 ProductCompletion/verification 公开读取。
- 验收交接：实际 consumer 能严格识别正确/foreign/坏 receipt，主线接受 authority 不变。

## C3 原完成数据真实 consumer

- 使用真实 Product/Broker/check/人工接受的原数据，在恢复副本读 metadata/current 与严格 facts。
- 原 ID/verification/artifact/readyAt/eventCursor 和 contract 修订准确，不能手造 accepted 行补证。
- 新 A reader 只数据，原 current/preflight/accept 仍由应用决定，C 不发批准或自动接受。
- 验收交接：真实正确读取与误分类负例在同 scope 下成立，无模型/事件增量。

## C4 第一完整结果：可信完成数据链

- 交原 producer→Completion Facts/原权威读取→C 消费的公开稳定链。
- A 新 classifier 未修时只阻相应字段，原 ProductCompletion 正向继续交付。
- 旧三 proof 作为已过回归保留，不重复包装成第一结果。
- 验收交接：第一 runnable 数据链可被 main/A 使用，发布后继续当前包。

## C5 当前 proof 公共闭包

- 复用已过 A content v2/独立 artifact/restore API，收口正式可搬运输入而非固定另一个 checkout。
- report-only/independent、selected read/完整内容、snapshot v1/v2/content v2 分清。
- 不在 C 复制 SQL、表豁免或第二确认逻辑，缺接口给最小真实调用。
- 验收交接：当前 main/A/D/E consumer strict/build 可通过，缺闭包准确未达。

## C6 原同 Store 双格式输入

- 同批 Work/Q&A/native_applied/SDK/候选/context/完成数据产生默认 v1 与显式 v2。
- 各自真实 create/verify/restore 到不同新根，绑定原 expectation/inventory/content 和新读取选择。
- 不 copy 后手写 marker，不带旧 credential、活动连接或可移用执行批准。
- 验收交接：两格式准确 source/proof/原 ID 可追溯，错根/格式/集合有限拒绝。

## C7 准确当前包实际消费

- 固定 D 当前准确 artifact 的 source/tar/hash/build/schema/ABI/mode 和 actual entry。
- 单 driver 实际使用 manifest/proof 读取两根原数据，不能 source helper 给旧包补能力。
- 具体 D/E mode 失败按实际输入处理，不把一个模式 bug 泛化为所有包不行。
- 验收交接：正确包内链真实运行，旧 1cd scope 与新包分开。

## C8 第二完整结果：当前包双格式数据

- 交同一个准确包的两次真实恢复/读取/完成 facts 和独立停止，不拼接独立 PASS。
- readiness/统计按当前字节消费，J 未含时准确未达，不贴当前 source 模板声明。
- E ce64 verdict 不认证 1cd/1ba/后继，C 工具 verified 也不升级 release。
- 验收交接：第二 runnable 完整链可复跑，发布后继续模板普通流。

## C9 J 模板真实预览数据

- 消费 main 已有 preview API 和 J 公开数据，输入仅原 project/kind/path atoms/profile。
- root 来自登记 lookup，facts/config/catalog/字段摘要只是预填观察，不是批准 token。
- metadata 未知/readonly/缺 check/profile 按原需要输入/不支持处理，不自动注册或执行 scripts。
- 验收交接：真实预览字段与原项目/政策一致，无写入、模型或 root 泄漏。

## C10 原表单明确创建数据

- main 原 NewWorkForm 已接 preview→apply 全字段→创建前 repreview，C 给真实数据和最小复现。
- 用户修改 goal、scope/criteria/profile、取消与过期配置仍由原明确操作/guard 处理。
- scopeChoice 刷新相交已经修好，不重复审查或改 F/App 源码。
- 验收交接：模板真实输入可进入原 WorkDraft/Proposal/Application，未确认不创建任务。

## C11 普通非迁移用户链

- 以当前普通项目/对话数据跑模板、创建、问答、检查与完成读取，不拿 restore marker 代替日常流。
- 自动 vendor/model/native 仍 0，受控执行与 native 配置/厂商结果分层，不扩大支持。
- 原 source/content/receipt 与项目事实不因 UI green 或模板建议取得新权限。
- 验收交接：普通用户数据在既有流程中闭合，取消/错误/readonly 无额外副作用。

## C12 第三完整结果：模板到原完成消费

- 交实际 J/main 原表单用户流与 C/A 原完成事实读取的一条可追溯链。
- 包缺 J 时 source-only 明确，包含新字节后才可交 same-package 声明。
- F UI/E release 由其 owner 验证，C 不做替代静态页面或调整断言。
- 验收交接：第三 runnable 结果包含实际输入、原 IDs、字段与拒绝，发布后继续原恢复。

## C13 合格 B/I 原回调 consumer

- 仅使用 main 准入 B/I，producer/lease/旧回调身份由原登记与真实 channel 绑定。
- schema/type/generation 不是鉴权，旧 reply 或历史批准不能进入新请求。
- C 复用 A 原 fact/result/reader，不造平行 coordinator、发送账本或批准 authority。
- 验收交接：真实输入契约可编译，未准入只阻本层，其他产品数据工作继续。

## C14 原 ID 与真实结果

- 对回 command/attempt/session/epoch/question/answer/target 和实际原生返回/持久事实。
- 重放幂等、foreign/迟到/未知分开，不换 ID 补发或把 ACK 当 native_applied。
- 数据 reader 不执行模型或接受候选，unknown 与原 ledger 保持。
- 验收交接：实际原结果可以追溯，data-only 与 live recovery scope 清楚。

## C15 原候选/检查/接受消费

- current candidate、verification、artifact 和接受事实复用 ProductCompletion 原 records/ports。
- 不新增 candidates 表或手写终态，不把 raw Completion Facts 自动当当前权限。
- 人工接受须原应用明确操作；context/source 旧 token 不转到另一 native 请求。
- 验收交接：正确/旧版本/错误候选拒绝范围有真实调用，无第二完成 gate。

## C16 第四完整结果：原恢复数据 consumer

- 交获准 B/I→A 原结果→C 原完成/审阅数据的真实恢复链。
- B/I 未到准确 partial，不用普通只读或 data-only 成功冒充恢复已完成。
- 普通模板/包/UI/数据路线与该依赖独立，source 早交后继续。
- 验收交接：第四 runnable 结果原身份与次数明确，发布后继续来源 UI 数据组合。

## C17 冻结来源与原文边界

- 原 message/binding/receipt/frozen bytes 与完成/问答/模板数据准确关联。
- main 原 principal/Scope/body gate 唯一决定读出，诊断只解释，不替代确认或放行。
- 当前 live source、权限显示和另一个项目数据不能替换原普通上下文。
- 验收交接：缺失/未核验/范围变化准确，未知不补空或零成完整。

## C18 只读观察与分层

- 对 readiness/usage/ReviewTiming 保留项目、窗口、layer/currency、partial/unknown 与真实来源。
- UI 可见活动仍是部分代理，不称工时/质量/效率收益，configuration-only/none 不授 native。
- 新完成事实不能把 raw receipt 转成 accepted/native metric；G/H/I/J 数据按实际准入消费。
- 验收交接：公开 DTO 与原数据一致，错误/截断和旧后端不误报完整。

## C19 main/F/A 实际数据组合

- 给 main/F 当前真实样例、原 IDs/状态和最小调用，不越权改 App/transport/global CSS 或 A SQL。
- 来源 UI、模板原表单、完成 reader 与统计各自边界清楚，不能用一层 PASS 认证全部。
- D/E 模式问题和 E ce64 结果按准确 tuple 保留，不盖掉新/旧成功范围。
- 验收交接：真实 consumer 可编译/调用，错误能定位来源和能力层。

## C20 第五完整结果：来源 UI 数据闭环

- 交普通模板/原工作/完成事实/冻结来源/观察数据在现有 UI 下的准确组合输入。
- 不替 main/F 浏览器交互或 E required verdict，只声明 C 实际数据消费范围。
- 新包/接口未到准确未达，独立文档/工具/故障继续，不等下一轮微任务。
- 验收交接：第五 runnable 结果来源、consumer、scope 和权限含义可复核。

## C21 有界故障和身份切换

- 实际新 consumer 的 prepare/manifest/proof/start/HTTP/status/stop 有期限、容量与 cleanup 余量。
- key/config/transport/auth/lease 变化的迟到数据不能成为新项目/会话观察或批准。
- reuse/keep/自有/unknown 区分，每次信号 fresh 全身份；不认领用户/其他 Agent 资源。
- 验收交接：相关错误/取消/重开有限退出，无虚假 verified 或未知材料删除。

## C22 正式工具 API 与兼容

- 一个公开 consumer 支持显式 source/package/data/proof/完成 facts，不依赖固定另一个 checkout。
- observed/verified/reused/refused/NOT_REACHED/failed、coverage/exit 与版本准确，caller 不猜绿灯。
- strict/exactOptional/build 和当前真实 caller 通过，shared/根配置调整交 main。
- 验收交接：独立开发者可参数化调用，无私有 SQL、第二算法或隐藏 fallback。

## C23 文档与独立支持材料

- 自有文档说明真实模板/普通流/恢复/proof/完成 facts、错误与未知状态支持范围。
- 给 E/H source/artifact/consumer/原 IDs/模式的准确材料，运行字节冻结后再最终验。
- 不盲跑长矩阵或把短观察称长期 native 稳定，保留原12实例/全部历史和预算。
- 验收交接：同事可复现实际能力，E/H 保留自己的独立断言/checker。

## C24 第六完整结果与最终交接

- 写 `packages/context/reports/wave29-status.json`，24 阶段列 source、command/exit、原 facts/proof 与真实能力。
- 六结果为可信完成 consumer、当前包双格式、模板普通流、原恢复、来源数据、故障/API/文档支持。
- 显式 stage 自有路径推原 origin，不 upstream/reset/清历史，保留原 lock 和 runs。
- 验收交接：整包实际完成才结束 goal，缺外部输入不计 whole complete，checkpoint 后继续独立队列。

## 独立备选队列

- A classifier/key contract 未齐：继续原 ProductCompletion 正向与新严格消费输入，不把宽 Record 视作原权威。
- B/I 未准入：只阻恢复，继续模板普通流/来源/同包/工具，不造候选表或 ledger。
- 新包未到：保留准确 1cd；1ba 含统计不含 J、E ce64 的范围不能混，具体失败不泛化。
- vendor/model/native 自动调用 0；B cap4 UNKNOWN 不可花，E 原 pilot BLOCKED 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807 与全部 state/profile/tar/ledger/dirty，仅 fresh 独立出生资源可受信号。
- 不新 Driver/CAC/桌面壳/autoaccept/动态 DAG，不改其他 owner 源码、main root 或 E 断言。
