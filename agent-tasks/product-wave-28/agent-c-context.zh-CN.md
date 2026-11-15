# Agent C：当前公共 proof consumer 与完整产品数据链

日期：2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-c`，原分支 `codex/g3-assistant-context`。
仅拥有 context/proposals/knowledge/routing 四包，原 `pnpm-lock.yaml` 差异和所有旧 runs 保留。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0071](../../docs/rfcs/WP-16/0071-wave-28-architecture-inputs.md)、[0072](../../docs/rfcs/WP-16/0072-wave-28-integrated-delivery-packages.md)。
同步最新 `origin/main`，实际 source/接口以 AGENTS/已发布检查点为准；十位外部 Agent A–J 加 main 正常并行。
保留 `f2c4af69` 已真闭的 event_log 豁免和 A 独立内容/清单消费，准确 ce64 两格式/readiness/STOPPED 已实测通过。
旧 inventory 缩小、普通 FTS 前缀、业务事件三反例不要重派，普通数据和只读源不授执行。
用户取消当天目标，正常门槛完成后续 actual consumer 能力，不以降范围或报告 DONE 结束。

建立或延续 whole-package goal，不设 token 预算。24 阶段，C4/C8/C12/C16/C20/C24 发布六个完整结果后继续。
main 保留 UI/HTTP/授权/根配置，A 保留数据 SQL/迁移，B/I 保留 runtime/channel，C 不造第二 pipeline/authority。

## C1 固定真实已过基线

- 记录当前 A API、C driver 和准确 ce64/旧包 source、hash、能力范围。
- 三旧反例和完整身份已过，复用其回归向量，不把原问题包装成新结果。
- 当前主线新 UI/统计/后继包与 ce64 按实际字节区分，不能互贴。
- 验收交接：清楚列当前 consumer/依赖与新增能力，不否定旧正确 scope。

## C2 当前公开 proof 接口兼容

- 从当前 main/A 正式接口消费 snapshot/content/artifact/root proof，不依赖固定用户工作树作为产品前提。
- 数据来源、独立 expectation、版本和 report-only/independent 语义继续准确。
- 不在 C 复制 SQL/清单算法、FTS omission 或事件 allow-list，不新建确认权威。
- 验收交接：真实当前 consumer 能严格编译并调用，缺模块/版本准确未达。

## C3 正式 consumer 输入与输出

- 收口 manifest/proof/target/package 显式输入，保留原主体/required collections/coverage 和独立 artifact 期望。
- 输出区分 selected read、独立内容、未知、观察和失败，不让 caller 猜 verified 的权限含义。
- 公共 contract 变化交 main 最小实际调用，不直接改根配置或 E 断言。
- 验收交接：独立 caller 可用 typed API/CLI，不手改 fixture 或填假 source。

## C4 第一完整结果：当前 proof consumer

- 交当前公开 API→单 driver→目标内容验证的完整可运行 consumer。
- 原 event/消息/artifact 负例按原 scope 作为回归，不能再做六个同类测试 gate。
- 内容一致不是 writer 静止、native 准入或目标启动许可。
- 验收交接：第一 runnable 结果能被 main/A/D 实际消费，发布后继续原数据准备。

## C5 复用原业务与完成数据

- 原 Work/Broker/SDK/候选/确认/context 数据来自同 Store，原 ID 与冻结字节准确。
- current candidate/verification/accept 复用现有 ProductCompletion records 与完成 gate。
- “没有 candidates 表”不是接口阻断，禁止新表、平行 ledger 或手写接受状态。
- 验收交接：给真实公共 reader/原 ID/完成事实映射供后续 consumer 复用。

## C6 默认 v1 真实输入

- 从同批原数据取得默认 workflow v1 snapshot/expectation/content v2/inventory。
- 原配方/摘要独立验证，snapshot v1 不等于 legacy content v1，不混用版本。
- 不携带 credential、旧批准、活动连接或静止结论，scope 仍由 main 选择。
- 验收交接：正式参数化 v1 输入和独立 reader 可准确复现。

## C7 显式 v2 与两根关系

- 显式 v2 使用真实独立 snapshot/restore 和目标 proof，不改标签或复用一次 copy 当两格式。
- 两个新根各自绑定原数据、准确 snapshot/content/artifact 和新读取选择。
- root mapping 来自真实操作，不由路径字符串或自改报告推导身份。
- 验收交接：两格式原 IDs 相同且配方/根各自准确，错格式/根有限失败。

## C8 第二完整结果：原数据 producer→consumer

- 交同一次 A 输入、双格式准备/恢复、当前 C driver 的原数据全链。
- 独立 reader/proof 与 HTTP consumer 实际相连，不只有并列模块报告。
- 源级成功准确标 source，包未到不以 checkout 补旧包能力。
- 验收交接：第二 runnable 结果可由另一个 consumer 参数化复跑，提交后继续当前包。

## C9 当前准确产品字节

- 与 D/main 固定实际包含当前 FApp/readiness/只读统计等所需能力的准确 package tuple。
- source/tar/hash/build/schema/ABI/mode 与 actual entry 文件都有准确来源。
- D/E 新 mode 问题只阻具体模式，不泛称全部包不可用；E 仍独立 installed/release verdict。
- 验收交接：新旧字节和能力差异清楚，无 source fallback 或 static marker 冒充交互。

## C10 同包两格式实际读取

- 在同一个准确包分别消费两个真实恢复根的 manifest/proof 和原 Q/A/delivery/Work/context。
- 读取 selected data 与独立内容闭包分别准确，允许仅 subject.dataRoot 的变换保持。
- 业务 422、held queue 不消费、provider 无增，不授 B/private/target/native。
- 验收交接：真实 package prepare/start/read/stop 两根都可追溯原数据。

## C11 当前只读产品输入

- 实际消费 readiness、来源诊断、需要时的 usage observation，均按配置/观察事实解释。
- configured/fixture/unknown/readonly 和 partial/window/layer/currency 保持，不推导质量、费用许可或 native ready。
- main/F 拥有 UI，C 提供真实数据和复现，不改 App/transport/global CSS 或从 SQL 拼统计。
- 验收交接：当前 HTTP/公开 DTO 与原数据一致，旧后端缺能力正确未知。

## C12 第三完整结果：当前同包双格式链

- 交当前准确包、原 manifest、独立内容、两格式恢复和只读产品输入完整路径。
- 旧 ce64 scope 保留，但晚 source 只由包含该字节的实际新包认证。
- E 的 required/installed 断言独立，C verified 不自动提升为 whole release。
- 验收交接：第三 runnable 完整结果可重跑且不混 subject，发布后继续原事实恢复组合。

## C13 B/I 原事实 consumer

- 仅消费 main 准入的实际 B/I callback；原 fact/receipt/payload/write-admission 身份来自原登记。
- 使用 A 原 Store/reader/result API，不建立第二 coordinator、发送状态或确认 authority。
- 类型/schema/lease generation 不是鉴权；旧批准/receipt 不变成新请求许可。
- 验收交接：实际 consumer 输入明确，未准入只阻该范围，其余阶段继续。

## C14 原结果与完成引用

- 关联原 command/attempt/session/epoch/question/answer/target 与实际持久结果。
- current candidate、verification 和接受事实从现有 ProductCompletion 读取，不找不存在的 candidates 表。
- unknown 保持未知，不换 ID 重发；数据 reader 不调用模型或自动接受。
- 验收交接：原结果/完成事实实际可追溯，foreign/迟到数据准确拒绝。

## C15 人工确认与真实边界

- 涉及确认时由 main 原 Proposal/WorkDraft/accept 流程处理，C 只供数据与结构化输入。
- 人工接受不能由模型评分、指标、模板建议或观察 green 代替。
- source/context 历史保持冻结摘要，旧 token 不可转用其他原生请求。
- 验收交接：正确原链与重放/旧版本拒绝范围清楚，不新建 authority。

## C16 第四完整结果：原事实恢复 consumer

- 交获准 B/I 原数据→A 持久结果→当前完成/审阅 consumer 的实际链。
- B/I 未达准确 partial，不用 data-only 或普通读取成功冒充 live native recovery。
- 普通安装/UI/数据能力与该依赖独立，独立结果继续交付。
- 验收交接：第四 runnable 结果有真实接口/ID/返回，发布后继续故障和兼容。

## C17 有界故障与操作时限

- prepare/identity/manifest/proof/start/HTTP/status/stop 有明确总预算与 cleanup 余量。
- 实际新 consumer 的 silent/partial/早退/中断/未知终态有独立正确对照，不盲跑长矩阵。
- 单操作有界不等于当天目标；不以同步 JS 可抢占或短序列长期稳定作过强承诺。
- 验收交接：elapsed/exit 与实际停止/保留材料准确，无虚假 verified。

## C18 身份、重开与陈旧回调

- 完整 PID/start/API/root/config/operation/review 继续核对，合法 reuse/keep 与新建资源区分。
- 原 lease/transport/auth 变化的迟到回调不得成为新身份的数据或批准。
- only fresh 独立出生资源可受信号，unknown 留现场，不按端口/共享路径认领。
- 验收交接：重开与错误路径有限结束，用户/其他 Agent 实例保持。

## C19 容量、模式和旧版本

- limits/bytes/集合/版本/未知模式准确处理，不为了报告统计全读正文或静默忽略数据。
- old backend optional absence 保留旧视图，源级/精确包/mode 的失败分别报告。
- D/E mode bug 给具体复现，不一概否定已有普通包或切 fixture 隐藏问题。
- 验收交接：正确老范围与新增能力兼容，异常有限拒绝，不将 unknown 填零。

## C20 第五完整结果：完整故障 consumer

- 将当前包数据、身份、时限、mode 与异常组成可操作的真实 consumer 结果。
- 不以多个独立 helper PASS 代替整条操作，也不扩大无关旧全量测试凑阶段数。
- 原始材料给 E 独立验证，C 不调整其期望或声明发布。
- 验收交接：第五 runnable 结果能精确定位各层失败，发布后继续正式交接。

## C21 稳定 CLI/API 与可搬运输入

- 一个公开 driver/consumer 支持显式 package/data/proof，不要求同事拥有 A/C 源码工作树。
- observed/verified/reused/refused/NOT_REACHED/failed 与 exit/partial 语义正式化。
- 复用 A 数据 API，不复制 SQL/FTS/事件政策，不为 probe 增空接口。
- 验收交接：实际 main/A/D/E caller strict/build 通过，跨新根参数化可跑。

## C22 跨模块真实兼容

- 与 main/F/G/H/I/J 按各已准入公开接口提供数据，schema 或样例不是执行权。
- J 配方、G 观察、H 原始运行材料各自保留 scope；不绕到 C 新建替代 pipeline。
- shared contract/root deps 由 main 管理，C 不写其他 owner 实现。
- 验收交接：真实消费者能编译/调用，缺接口给最小实际复现而非虚构阻断。

## C23 完整文档与独立验收输入

- 自有文档说明原数据准备、proof、两格式、准确包、故障和未知材料保留。
- 给 E source/artifact/consumer/proof/原 IDs 的准确关系，新字节冻结后再最终验。
- UI/模型/native/target/长期稳定未测范围准确，旧成功证据不覆盖或混贴。
- 验收交接：独立开发者可重跑已交能力，用户不需猜 hidden 目录/假 default。

## C24 第六完整结果与整包状态

- 写 `packages/context/reports/wave28-status.json`，24 阶段列 source、command/exit、原 ID/proof 与真实能力。
- 六结果为当前 proof consumer、数据链、当前包双格式、原事实恢复、故障边界、正式工具/交接。
- 显式 stage 自有路径并推原 origin，不 upstream/reset/清历史，保留 C lock 和 runs。
- 验收交接：整包真实完成才结束 goal，缺外部输入不计 whole complete，checkpoint 后继续队列。

## 独立备选队列

- main/A wire 未到：早交稳定 typed consumer 与原数据输入，继续当前包/故障/文档，不重派旧三修补。
- B/I 未准入：只阻 live 恢复，复用原完成/验证 ports，不造候选表/ledger/批准层。
- 新包或 mode 输入未到：保持准确 ce64 范围，准备真实新 tuple，具体失败不泛称全部不可用。
- vendor/model/native 自动调用 0；B cap4 UNKNOWN 不可花，E 原 pilot BLOCKED 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807 与全部 state/profile/tar/ledger/dirty，仅 fresh 独立出生资源可受信号。
- 不新 Driver/CAC/桌面壳/autoaccept/动态 DAG，不改 A SQL、main UI/HTTP/contracts 或 E 断言。
