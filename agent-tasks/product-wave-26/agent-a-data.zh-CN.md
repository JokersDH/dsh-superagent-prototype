# Agent A：真实恢复内容身份与完整数据交付整包

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-a`，分支 `codex/g2-workspaces-verification`。
仅拥有 `packages/storage/`、`packages/workflows/`，生产 SQL 与追加迁移仍由 A 唯一实施。
先读 `START-HERE.zh-CN.md`、`product-spec/README.md`、[本轮 README](README.zh-CN.md)、[0066](../../docs/rfcs/WP-16/0066-main-trial-workbench-integration.md)、[0067](../../docs/rfcs/WP-16/0067-wave-26-integrated-product-packages.md)。
fetch 并合并最新 `origin/main`，source/接口以实际 `AGENTS.md` 为准；八位外部 Agent A–H 与 main 并行，不越界修改 consumer/HTTP/UI。
保留原主体/独立 required sets/UoW/成本控制和不同 Node reader 的旧获验范围，不重派旧修补。
当前 `219a61d` 生产 build 已过，但 Node 新 dual 测试及 strict 有明确错误；新 restore reverify 尚未证明内容身份，不能用 SQLite integrity 代替数据一致。

建立或延续整个结果包 goal，不设 token 预算。十六阶段连续实施，在 A4/A8/A12/A16 后发布四个可运行完整结果，再继续独立阶段。
主结果：支持工具链与真实 restore identity → 单 driver 同包双格式正负闭环 → 原 B 结果/故障持久化 → 完整数据工具 API。
所有清单、root mapping 和 restore 报告都是数据，不授发送、恢复启动、原生执行、人工接受或发布权。

## A1 关闭实际 Node 与 strict 阻断

- 删除新 dual 测试的重复 `existsSync` import，修复 `assert.throws` 与当前 Node 类型声明不兼容的调用。
- 运行仓库实际声明的 Node24/strict 入口，不能仅引用 `npx tsx` 或只含生产 src 的 build 通过。
- 原 input guard 和 original-result 数据测试已过，修复只影响实际失败点，不重写无关旧 fixture。
- 分开记录生产 build、测试加载、strict 与运行行为，不能用一个数字覆盖不同范围。
- 验收：新 dual 测试可被支持的 Node 加载，workflows strict 通过，已有数据正向保持。
- 交接物：最小源码修复、准确命令/exit 与原独立证据的对应。

## A2 正式定义恢复内容 subject

- 明确 initial restore 与 subsequent reverify 要证明哪些 source snapshot、数据库、实体、artifact 和 logical 数据。
- 独立 expected snapshot identity 由原 producer/调用方给出，不从待核验报告自己推导全部期望。
- 区分 workflow evidence digest、原 recoverySource fingerprint、数据库字节摘要与当前健康，不混用同名 digest。
- root 变化、credential 文件和必要运行元数据变换只允许明确版本化、可解释的范围，不泛化忽略未知变化。
- 验收：完整 identity/coverage contract 可被 C/main 消费，缺证据准确 partial/unknown，不生成新 authority。
- 交接物：实际类型、摘要定义、允许变换及反例输入。

## A3 实现内容绑定的 restore reverify

- 复核原 snapshot 配方、原实体/集合摘要和 target 实际内容，而不只检查 integrity、foreign keys 与 schema。
- 目标逻辑数据变更、artifact 缺失/替换、报告 subject 错误或 root mapping 改写必须准确拒绝。
- 保持同步索引 UoW 与异步 bytes 分离，使用已获验前后复核，不跨 await 持数据库事务。
- 健康检查可以独立提供，但其 `ok` 不能被调用者误当原快照身份验证完成。
- 验收：原真实恢复正对照通过；唯一新增合法用户消息导致数据变化时 reverify 明确失败。
- 交接物：可运行公开核验 API、真实变更负例及所依赖的独立期望。

## A4 第一里程碑：恢复数据身份闭合

- 将支持工具链、真实 create/verify/restore 和内容 reverify 整成一个可运行结果。
- 覆盖 unchanged、合法但不同内容、损坏字节、wrong root/format 和未知数据，保持准确 scope。
- 不借指纹相同证明物理 writer 静止，不从 source receipt、旧回答或恢复报告授执行权。
- 发布最小稳定入口供 C 立刻接入，不等待整个包或 E 最终 verdict。
- 验收：第一完整结果可独立复跑，准确新 source/命令/exit 可查；提交后继续 A5。
- 交接物：恢复内容核验 checkpoint、调用样例与未达项。

## A5 稳定 producer 与独立 expectation

- 复用真实 Application/Broker/SDK 同 Store producer，保留原 Work/attempt/question/answer/candidate/context 身份。
- 生产输入与 reader 可参数化，不依赖旧 wave 文件名、固定本机目录或手写 SQL 终态。
- independently expected required collections 与原 source 由真实 producer 提供，不允许 manifest 自选删空。
- credential、可移用批准、旧活动连接和物理静止结论都不进入可搬运数据输入。
- 验收：另一个 Node PID 读到原数据，重复读取不增发送/事实/delivery/队列消费。
- 交接物：正式入口、输入 schema、真实数据清单与 reader 命令。

## A6 与 C 唯一 driver 绑定真实恢复

- 当前 C 已实际调用 A manifest，不能继续称只有分开的三条链；在此基础上新增真实恢复 proof 消费。
- 同一次 driver 输入包含原 expectation、manifest、snapshot identity、实际 restore 记录和目标核验结果。
- 原数据根→目标根的关系由上述实际数据证明，不仅比较 operator 提供的两条路径。
- C 只消费公开 API，A 不改 C 源码或在 workflows 再造第二 consumer。
- 验收：实际 A→C 调用拒绝 target-only drift，原正确同包数据链保持成功。
- 交接物：最小稳定数据 port、真实调用记录和 root/content 关联。

## A7 两格式独立真实恢复

- 同一批数据分别创建默认 v1 与显式 v2 快照，使用各自实际 families/配方/摘要。
- 两份快照分别 verify 并经实际 restore 到不同新根，不 copy 后手写 marker 或重贴版本。
- 给每个目标独立期望、root mapping、content proof 和新明确读取选择。
- 已有 C 精确 0ede 包双格式正向范围保留，不将新增身份验证说成从零补该流程。
- 验收：两根各自内容核验成立，错快照/错根/变更内容分别拒绝，旧原数据和队列保持。
- 交接物：两个格式的准确 producer/snapshot/restore/target subject。

## A8 第二里程碑：同包双格式正负闭环

- 与 C/D 固定准确包，单 driver 实际消费两份恢复的完整数据身份并执行只读审阅。
- 对回候选/history/Work/问答/delivery/原文，原 ID、coverage 和冻结摘要都来自同批数据。
- 新增 target-only 合法数据变化反例，不能让 selected IDs 相同掩盖所声明恢复内容不一致。
- ordinary 读取仍业务 422、provider 无增、held queue 不消费，不能解锁 B/private/target。
- 验收：第二完整结果包含两个正确包内流程和独立 drift 拒绝，发布源码后继续。
- 交接物：同包两格式实际命令、字节、核验结果及准确缺能力层。

## A9 原结果 sink 的可信输入边界

- 保留已过 original-result 数据 sink，但明确它只接受实际上游已经观察到的结果，不代替 B transport。
- 对原 command/attempt/session/epoch/question/answer/target 与当前 Store 的关联继续使用现有公开 ports。
- 过期、foreign、不同 body/请求、缺结果与 unknown 的语义准确，不能因 receipt 存在推断 native 已收到。
- 需要修改共享调用契约时交 main 最小 RFC，不新建 ledger、批准权威或执行 lifecycle。
- 验收：数据 API 与真实准入 consumer 严格编译，缺上游证据准确拒绝或标未达。
- 交接物：可信输入前提、原 ID 关系和实际 consumer 示例。

## A10 获准 B 的实际结果持久化

- 仅在 main 准入 B 实际 attach 后，接原 Runner/原 Store 的真实结果，不用 inspect/cancel 代替恢复。
- 原 fact/answer/delivery 一次落库，重复结果与重连重放不增发送或应用次数。
- unknown 保持 indeterminate，只有实际返回结果可推进 `native_applied`，不得换 ID 补发。
- B 未准入只阻该步骤，继续恢复内容、C 组合、API 与独立故障工作。
- 验收：原身份结果正确落库，foreign/旧结果拒绝，重复幂等，实际 native 未测仍单列。
- 交接物：真实调用与次数、原持久事实、精确未达范围。

## A11 故障与独立读回

- 有限覆盖原意图、written、observed、结果和 unknown，正常退出/SIGKILL 数据读回范围准确分开。
- 新 Node PID 从原清单和 expected subject 读回，不通过重建空账本、清 marker 或改 attempt 恢复成功。
- 每个故障窗口有独立合法正对照、deadline、原 PID/ID 与最终数据观察。
- 物理 writer proof 仍属于原资源 barrier，不由数据一致或 ended 状态推导。
- 验收：故障后原结果可追溯、不重发，unknown 原样持久，测试资源有限归还。
- 交接物：有界故障矩阵、reader 命令与原数据保持记录。

## A12 第三里程碑：原结果与数据故障交付

- 交已获准 B 原结果落库和数据故障闭环；未准入 transport 不能被数据单测冒充。
- 同包只读流程与业务结果分别保留证据，但原身份关系和清单可以准确关联。
- 发布第三可运行结果后继续工具/API/交接，不在单个 sink 正向通过后结束 goal。
- 外部依赖缺失明确阻断对应项，独立已完结果如实发布，不无限等待。
- 验收：结果、重放、未知和故障读回可以按实际范围复现，无隐式新发送。
- 交接物：可用源码、真实 consumer、精确状态与下游输入。

## A13 完整数据工具与 API

- 收口 expectation/manifest/restore/reverify/original-result 的稳定公开 API 和版本语义。
- 旧 v1/v2 摘要与迁移兼容保留，不为新工具改写历史 recipes 或旧迁移。
- 独立 caller 能区分 health、content identity、source scope 和 incomplete evidence，不猜 `ok` 的权限含义。
- 必要生产迁移只能由 A 追加，不能新增仅满足旧 probe 的空方法。
- 验收：main/C/D/E 的真实消费者严格编译，另一个入口按文档即可使用，不手查私有列。
- 交接物：类型、命令、输出 schema、版本说明和实际示例。

## A14 成本与异常输入

- 对新 restore proof 与 reader 限制 manifest/database/artifact/累计 bytes、条数、路径和生命周期。
- 错格式、坏摘要、重复集合、缺 family、相同长度变更与不完整 source 均有有限拒绝。
- 不为补展示数字全读正文，unknown 不填零，统计不成为 native 或质量证明。
- 原已获验 UoW/成本测试引用即可，仅新风险增加实测，不机械扩大旧套件。
- 验收：严格类型、对应 build、边界及有限成本证据通过，错误不留下可误读的完成报告。
- 交接物：成本范围、实际计数和失败材料保持策略。

## A15 独立验收与准确包输入

- 给 D/E producer、snapshot、restore、content proof、原 ID、consumer 和精确 package subject。
- 新 FApp/readiness 字节只有在实际准确包中才可声明覆盖，旧 0ede 成果按原范围保留。
- 新运行字节先冻结再 E 最终验，docs-only 不要求重冻；A 不修改 E 断言或 D lifecycle。
- 普通只读/安装不等待 B/private/target/试点，数据证明也不升级为恢复启动授权。
- 验收：独立消费者可复现实际范围，无 source-only 补旧包能力或 subject 混贴。
- 交接物：操作指南、完整证据索引和真实未达层。

## A16 第四里程碑与完整结果

- 状态写 `packages/workflows/reports/wave26-status.json`，逐阶段列 source、命令/exit、原 ID、摘要、proof 和能力范围。
- 第四完整结果包括支持工具链、真实恢复内容身份、C 同包双格式正负、数据 API 与实际获准 B 范围。
- source/package/installed、normal/recovered/native、private/target/value 分层，不按轮次或测试数提高完成度。
- 显式 stage 自有路径并 push 原 origin 分支，不 upstream/reset/清历史，保留所有数据和报告。
- 验收：承诺结果有实际入口，缺依赖不计完成；整个结果包实际完成才结束 goal。
- 发布检查点后继续独立队列，不要求用户重派旧小修才推进。

## 独立备选队列

- C 未齐：先交稳定 content proof API 和独立正负输入，继续两格式 restore/reader/工具，不另造 consumer。
- B 未准入：继续数据/恢复/C 组合和故障，不伪造上游结果或增加 sender。
- 新包未到：保留准确旧包成果，准备真实新字节输入；later FApp/readiness 标未达，不回退源码补包。
- 全程真实 vendor/model/native 调用 0；B 原 cap4 UNKNOWN 不可花，E 原 BLOCKED pilot 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807、全部 state/profile/tar/ledger 与 dirty；只处理独立证明本轮出生且 fresh 身份完整的精确资源。
- 不新 Driver/CAC/桌面壳/自动接受/动态 DAG；main 保留 contracts/HTTP/UI/授权，C 单一 consumer，E 独立断言。
