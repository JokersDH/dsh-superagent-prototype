# Agent A：独立内容闭包与完整恢复数据工具

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-a`，分支 `codex/g2-workspaces-verification`。
仅拥有 `packages/storage/`、`packages/workflows/`，生产 SQL 与追加迁移由 A 唯一实施。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0068](../../docs/rfcs/WP-16/0068-coordinator-channel-and-project-recipe-inputs.md)、[0069](../../docs/rfcs/WP-16/0069-wave-27-ten-agent-continuation.md)。
fetch 并合并最新 `origin/main`；实际 source/接口以 AGENTS 和 main 检查点为准，外部 A–J 十人加 main 并行，不扩大自己的路径所有权。
保留 `06390ae` 已过 Node、strict、原主体/UoW/bounds、普通消息 drift 拒绝和源级双格式结果，不再重派旧失败。
用户取消当天完成目标，按正常节奏和正常门槛完成本整包，不以降范围或报告 DONE 替代真实结果。

建立或延续 whole-package goal，不设 token 预算。20 阶段，在 A4/A8/A12/A16/A20 后发布五个完整可运行结果，提交后继续。
本包收口 artifact 独立清单、真实 FTS 判别、内容 proof、一包双格式、合格 B 原结果及稳定工具。
数据/报告/指纹均不授执行、恢复启动、物理静止、人类接受或发布权；缺依赖准确未达并继续独立队列。

## A1 固定已获验事实与新增缺口

- 同步当前 main，记录 A 模块与消费者 SHA，保留旧 snapshot、报告、账本和所有状态。
- 原 Node/strict 已关，完整主体、required sets、不同 Node reader 和 UoW/bounds 按原 scope 复用。
- 当前缺口是独立钉住 contentDigest 后 report.artifacts 删空仍可过，以及 FTS 任意前缀漏持久表。
- 不把新数据工具问题描述为主线权限绕过，也不因此否定准确 a826 双格式正向。
- 验收：本轮工作只针对新增完整性闭包和真实组合，原成功与未知层准确保留。
- 交接物：基线/依赖/新增风险清单与实际公开 API。

## A2 artifact 必需集合独立闭包

- 从独立原 snapshot/数据库内容身份确定必需 artifact 集合，不以可改 report 自选清单为唯一来源。
- 每个 id/digest/bytes、完整集合和数量相符；空集合只能在独立原 subject 确实无 artifact 时成立。
- 缺项、重复、foreign、report.snapshot.artifacts 数量矛盾和 metadata 不一致必须拒绝。
- 不因 digest 由调用者重新计算或报告格式合法而降低完整性要求。
- 验收：真实完整正向通过；删除真实文件后清空或删一项 report 清单仍准确失败。
- 交接物：typed inventory 来源、闭包规则与实际正负命令。

## A3 目标 artifact 字节与路径核验

- 对必需集合重新检查 target 实际 bytes/digest，不能只确认文件存在或 SQLite integrity。
- 使用既有安全路径/文件读取模式，限制每文件/累计 bytes，拒绝越根、非普通文件和来源替换。
- 独立原数据库中的 artifact metadata、source inventory 与报告输出保持一致，不建立第二内容权威。
- 身份证据不足时报告 incomplete/unknown，不用 missing→空集放行。
- 验收：等长替换、缺文件、错误 bytes、foreign path 与正确完整样例分别可测。
- 交接物：可重用核验 API、精确失败原因和有界读取记录。

## A4 第一完整结果：artifact 内容闭包

- 将独立 inventory、目标字节、报告一致性合成一个实际 restore/reverify 结果。
- 复验原删除文件会拒绝的成功控制，新增清 report inventory 不能绕过独立 content 期望。
- 明确 report-only 与独立内容证明，不能把独立 metadata 字段相同当全部内容已证明。
- 不新增签名、批准、ledger 或执行生命周期，当前数据工具不成为恢复启动许可。
- 验收：发布第一可运行源码和完整正负，交后继续 FTS/内容/API，不在小修后停工。
- 交接物：稳定 inventory/content port 和 main/C 可直接消费的例子。

## A5 用真实 schema 判别 FTS 派生表

- 只排除真实 FTS virtual/shadow 派生表，使用 SQLite 结构化 schema 元数据或准确已知关系。
- 不再以 startsWith conversation_search 跳过未知持久表，不猜名称后缀就认派生数据。
- 新增 conversation_search_private_audit 这类普通表及行必须进入 proof 或明确 incomplete。
- 外部项目/工具无新增 SQL 权；迁移仍由 A 追加，schema 不因测试变更静默降级。
- 验收：真实 FTS 派生不产生虚假内容 drift，前缀普通表变化可被检测。
- 交接物：准确判别逻辑、真实 schema 正对照与独立前缀负例。

## A6 proof 协议与遗漏项明确

- 将实际 omission set、协议版本、成本限制和 coverage 绑定到内容摘要含义。
- 未知表、未知 schema、不可读/不完整集合不得标 complete；不能把 runtime 表豁免扩展到其他业务表。
- 与旧 proof 的兼容/不兼容明确，不把语义变化重贴成同一已验协议。
- root-local 观察也不是 writer quiescence，既有物理资源 barrier 不由数据层代替。
- 验收：旧支持输入可解释迁移，新遗漏/不完整准确失败，未知不填零。
- 交接物：版本 contract、遗漏项说明与实际摘要向量。

## A7 同步内容快照与异步字节边界

- 相关索引在同步 UoW 内读取，artifact/payload bytes 在事务外，保留前后 source/subject 复核。
- 内容表、集合、artifact 或 current 发生变化时拒绝或有限重读，不拼接不同观察时点。
- 不跨 await 持 SQL 事务，不为展示/统计扫描所有正文或无限遍历目录。
- 将数据库结构健康、业务内容身份、源范围与物理静止分别输出。
- 验收：稳定合法输入通过，受控读取窗口变化有限失败，成本与退出可观察。
- 交接物：UoW/读取/复核边界与有意义故障矩阵。

## A8 第二完整结果：可信 target proof

- 以修复后的 artifact/FTS/protocol/UoW 组成完整原 snapshot→target 内容 proof。
- 普通合法消息、业务事件、未知持久表和 artifact 变化均按实际 scope 处理，不能广泛忽略 writer/event 表。
- 允许的 operational/root 变换要有精确身份与观察，不产生第二确认权威。
- 早交公开 API 给 C 使用，外部 consumer 未到不阻独立数据工作。
- 验收：第二可运行结果有独立期望、完整 positive 与单变量 negative，提交后继续同包链。
- 交接物：正式 target content/report 一致性接口和真实输入。

## A9 原始同 Store producer 与清单

- 保留真实 Application/Broker/SDK 数据生产路径，Work、问题、回答、native_applied、候选与 context 同 Store。
- expectation 从原 producer 独立取得，manifest 不自选删空 required commands/dispatch/observations。
- 新 Node reader 通过公开 ports 读回原 tuple/集合/bytes，不手查私有列制造终态。
- 权限显示、旧回答和 source receipt 不成为可移用批准或原生发送证据。
- 验收：原 ID 真实可追溯，重复读验不增发送、delivery、fact 或 queue 消费。
- 交接物：可参数化 producer/expectation/manifest/reader 输入。

## A10 两格式独立 snapshot 与 restore

- 同批原数据分别生成默认 v1 和显式 v2，使用各自真实 families/配方和完整校验。
- 各自 restore 到独立新根，绑定 snapshot/content/inventory/root mapping，不 copy 后手写 marker。
- 两格式与 personal-evidence/bundle 协议分别记录，不能靠 DB 相等代替不同配方验证。
- credential、旧连接和执行授权不复制；旧 held queue 与 unknown 屏障保持。
- 验收：两个正确 restore 独立通过，错格式/根/集合/字节各拒绝。
- 交接物：双格式准确 source/bytes/restore/proof 结果。

## A11 C 单 driver 的真实数据消费

- C 已有同次 manifest→package HTTP 链，不重称孤立测试；在此链上实际接新独立内容 proof。
- 通过正式 API 核原 subject、完整 inventory、精确变换与目标内容，C 不复制 A 数据算法。
- 两根各自原 ID、coverage、冻结字节和 proof 与 actual consumer 相符。
- 回调和 proof 只作数据，main 保留命令/批准 authority，E 保留独立验收。
- 验收：同一次 driver 拒绝所有新增完整性负例，正确数据与合法读取保持。
- 交接物：A→C 实际调用、typed consumer 与准确未达层。

## A12 第三完整结果：同包双格式正负

- 与 C/D 固定同一精确包，分别消费两个真实恢复根及其内容 proof。
- 包内读取原 Q/A/native_applied、Work、候选、history/原文，业务 422、provider/queue 不增。
- artifact 删清单、普通前缀持久表、非法事件/消息 drift 均有独立完整对照。
- 旧 a826 范围保留，新 F 硬化/source 只有包含该字节的包才可声明覆盖。
- 验收：发布第三可运行完整链，证据不混 subject，交后继续原 B 结果与工具。
- 交接物：准确 package/data/consumer 的双格式命令和结果。

## A13 合格 B 原结果输入

- 仅消费 main 准入的 B/I 实际 callback/attach，保留原登记、完整 tuple 和 fresh before-write 约束。
- A 提供原 Store fact/result sink，B 仍唯一 runtime/lifecycle/dispatch，I 不引入第二 ledger。
- 没有实际上游结果时保留数据-only，inspect/cancel 或发送 ACK 不称 native_applied。
- 缺 B 准入只阻相关步骤，继续内容 proof/同包/API 与独立故障工作。
- 验收：真实调用前提明确，foreign/过期 tuple 拒绝，不依赖私有 SQL 或新批准。
- 交接物：稳定 sink 调用示例和原请求/返回关系。

## A14 原 ID 落库与未知结果

- 实际观察结果写回原 fact/command/attempt/question/answer/delivery，不换 ID 重发。
- 同结果重放幂等，迟到 ACK/旧 epoch/不同请求不能应用到当前 subject。
- unknown 保持 indeterminate，只有真实返回结果可推进；receipt 存在不是对端已收证明。
- 不清账本、补样、退款或创建新任务消除未知状态。
- 验收：原结果一次落库，重复不增发送/应用，正确与拒绝/unknown 各独立可测。
- 交接物：实际次数、原持久事实和幂等回执。

## A15 独立进程与故障读回

- 有限覆盖意图、written、observed、结果与未知窗口，新 Node 读回原 subject。
- 正常退出、SIGKILL 数据恢复和物理停止分别记录，不用同进程重开替换跨进程结果。
- 故障有合法对照、deadline、原 PID/ID 与资源保持，不无限等待或清 marker。
- 原 UoW/成本测试按已验范围复用，只有新增风险扩大验证。
- 验收：原数据保留且不重发，unknown 可审计，所有自有资源有限退出。
- 交接物：故障矩阵、实际命令与数据读回记录。

## A16 第四完整结果：原结果与故障包

- 交获准 B 的实际原结果/故障链；未准入 transport 不得被 data-only 单测代替。
- 数据层独立成果仍可发布，依赖未达准确记状态，不阻整个团队普通产品路线。
- 关联同包数据证据与原业务身份，但不将读取完整性升级为执行或自动接受许可。
- 检查点提交后继续 API、文档和下游交付，不等再次派工。
- 验收：第四可运行结果实际范围清晰，原 ID/次数/unknown 可复核。
- 交接物：consumer、原结果与可重跑 fault 输入。

## A17 完整公共数据 API

- 收口 expectation/manifest/content/inventory/restore/reverify/result 的稳定入口和版本说明。
- 调用者能区分 report-only、独立内容、健康、范围和 incomplete evidence，不猜 ok 的权限含义。
- 不依赖旧 wave 测试目录或固定路径，不为 probe 新增空方法。
- 共享 contract 变化先交 main 最小真实调用；必要迁移只由 A 追加。
- 验收：main/C/D/E 实际 consumer strict/build 通过，独立调用者可按文档使用。
- 交接物：正式类型、CLI/API 样例、兼容和错误 contract。

## A18 成本、异常与兼容

- 限制 tables/rows/manifest/artifact/累计 bytes、分页与子进程时长，在越界前准确拒绝或 incomplete。
- 新增未知表、派生表变化、重复 inventory、损坏元数据及 legacy proof 有明确处理。
- 不将未读数据置零，不为统计而全读正文或复制 credential/profile。
- 原 v1/v2 和支持平台按真实既有能力，不擅自扩大执行兼容范围。
- 验收：有界正常/临界/越界与严格类型通过，所有失败有限且无虚假完整报告。
- 交接物：实际成本与版本矩阵，未知范围明确。

## A19 独立包验收与文档

- 给 D/E 准确 producer/snapshot/restore/content/artifact/consumer 关系和命令，不修改其源码或断言。
- 新运行字节先冻结再 E 最终验，docs-only 不要求重新打包。
- 原十二实例与所有历史 tar/数据保持，普通安装/UI 不等 B/private/target/研究。
- 不将 source-only 结果贴到不同 artifact 或把新 data proof 当 whole native/release。
- 验收：独立人员可复现准确 scope，晚 source 与旧包的边界清楚。
- 交接物：完整工具文档、证据索引与未达依赖。

## A20 第五完整结果与最终交接

- 写 `packages/workflows/reports/wave27-status.json`，逐阶段记录 source、command/exit、原 ID、bytes/coverage 和能力范围。
- 五个结果覆盖独立 artifact/FTS/content、AC 同包双格式、合格 B 原结果、稳定 API/文档/故障。
- 只按真实完成结束 goal，缺外部输入不计 whole complete，也不抹去已过范围。
- 显式 stage 自有路径，推原 origin 分支，不 upstream/reset/清历史。
- 验收：所有承诺有可运行入口与实际证据，不以报告 DONE、轮次或测试数代替。
- 发布后继续独立备选队列，完整结果未齐不提前停工。

## 独立备选队列

- C 未齐：先交独立 content/inventory/FTS API 和真实正负，继续 reader/双格式 restore，不再造 consumer。
- B/I 未准入：原结果只标依赖未达，继续同包数据与工具；不造新发送或空 ledger。
- 新包未到：保留准确旧包，准备当前 source 输入，晚能力不得由 checkout 替包。
- vendor/model/native 自动调用 0；B cap4 UNKNOWN 不可花，E BLOCKED pilot 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807 与全部 state/profile/tar/ledger/dirty；每次信号只对 fresh 独立证明本轮出生的精确资源。
- 不新 Driver/CAC/桌面壳/autoaccept/动态 DAG；main 保留授权/HTTP/UI/contracts，A–J 不互改拥有路径。
