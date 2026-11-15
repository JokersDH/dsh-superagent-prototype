# Agent A：可信历史、持续普通流与同包恢复三包计划

日期：2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-a`，分支 `codex/g2-workspaces-verification`。
仅拥有 `packages/storage/`、`packages/workflows/`，生产 SQL 与追加迁移仍由 A 唯一实施。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0080](../../docs/rfcs/WP-16/0080-main-observation-export-and-runtime-checkpoint.md)、[0081](../../docs/rfcs/WP-16/0081-wave-31-reviewed-architecture.md)、[0082](../../docs/rfcs/WP-16/0082-wave-31-three-release-program.md)。
保留改动后同步 `origin/main`，实际 source/consumer 以 AGENTS 和主线已发布检查点为准。
固定起点 `40626989` 已关闭历史 review 被新 current epoch 抹掉的问题，canonical/shape/proof 三反例也已关，不重复派旧修。
main 本轮接 G 的公开观察导出及精确 B 七源/原 native guard consumer；这不等于原 Work 恢复已准入。
`829RC` 冻结字节、其 verdict 和新的 `R2` source/successor artifact 必须分开，禁止覆盖或重贴来源。
十位外部 Agent A–J 加 main 正常并行，A 不写 main/F UI、HTTP/shared contracts/root lock 或 E 断言。

用户一次下发以下三个连续完整交付包，不是十二个待逐条批准的小任务。
建立或延续整个三包 program 的 goal，无当天 deadline、token 预算或时长承诺。
每个 outcome 早交可运行 source checkpoint 后继续；一个包完成就进入下一个，不等用户再次派发。
外部依赖只阻相关能力，准确记未达并转独立队列；不要以 PARTIAL、helper 数量或报告 DONE 结束整包。
任何历史、proof、配置、观察导出都不授 current/accept、执行、物理静止或发布权。

## 交付包一：可信历史数据产品

结果是一个可被当前主线/C/F 实际浏览、核对来源和处理部分历史的数据子系统。
历史真实性与当前资格已分开；本包把它变成稳定公开消费能力，不再重复修同一个 epoch 反例。

### A1 唯一稳定历史与完成事实数据接口

实现范围：

- 收口 review/verification/acceptance、原 attempt/contract/revision、bindingState/currentLink 和原始来源的公开只读 API。
- 历史有效、当前关联、unclassified、unknown 与 source coverage 明确分开，原 ProductCompletion/current/accept 保持唯一 authority。
- 复用原表/ports，不新增 candidates 表、第二 ledger、批准 token 或执行 lifecycle；共享 schema 需求交 main。

实际 consumer：

- current main/C 用正式接口读原/新 attempt 并列事实，不能靠固定测试路径或私有 SQL 拼数据。
- main/F 浏览器组合只消费共享 port；A 给可严格编译的真实调用，不越权写页面/API。

验收正负：

- 真实原 review 与 epoch+1 后历史仍可读；foreign subject、非 canonical/坏 shape 仍准确拒绝或 unclassified。
- 旧消费者和当前 consumer 都能处理缺数据/未知版本，无事件、接受或模型增量。

source 交接：

- 交正式类型/入口、最小 shared contract 需求、准确 source 和真实 main/C 编译与调用结果。
- 立即发布可运行 checkpoint 供集成，继续 A2，不在接口文件完成时结束包一。

### A2 source 与 caller 双层 coverage 的历史枚举

实现范围：

- 为多 ticket/多 revision 历史提供有界枚举、稳定分页或 continuation 数据与明确 source/caller 截断。
- 每集合 returned/available/unknown、per-ticket/总上限准确；不能把 LIMIT50 的本地数组标成完整全历史。
- 原记录的时间/ID 排序和边界稳定，public cursor 签名/权限由 main 管理，A 不造第二授权游标。

实际 consumer：

- C/main 的实际历史 reader 组合上游 coverage 和本地 limit；缺页/不完整状态能向用户解释。
- 原 WorkIndex/Completion Facts 旧调用保持兼容，不静默改变空历史/未观测语义。

验收正负：

- 完整小历史、上游截断、caller 截断、跨页重读与记录插入分别可复现且不丢/重复原事实。
- 错 project/revision/cursor、未知 source、坏集合不能回退成完整零值。

source 交接：

- 交分页/coverage contract、成本与真实 consumer 记录，必要迁移只由 A 追加并说明原因。
- 发布 source 后继续原始 provenance，不等待整团队报告或 E 最终 verdict。

### A3 原事实 provenance、metadata 与证据关系

实现范围：

- 关联原 command receipt、Work/contract、attempt、verification/artifact、acceptance actor 与冻结 source metadata。
- 所有引用保留来源/摘要/观察范围；raw receipt 或 metadata 不升级为 canonical/current/accepted 结论。
- 按已有公开 ports 限量读 payload/artifact，正文与敏感材料由 main 原 scope/principal/body gate 决定。

实际 consumer：

- main/C 历史条目可导航到原 evidence/source/审阅数据，F 拿到真实状态与缺失原因。
- 只读观察/导出复用已有 WorkEvidence/Outcome/ReviewTiming，不新造统计事实或价格来源。

验收正负：

- 真实完成事实到原 receipt/metadata/摘要可对回，历史证据缺失/损坏/跨项目时准确显示边界。
- 不读取无关 credential/home，不为补展示数字扫描所有正文或将 unknown 填零。

source 交接：

- 交原 IDs/引用图、数据样例、有限成本与真实 consumer 命令，说明哪些内容不应公开。
- checkpoint 后继续 A4 的浏览消费，不以 provenance helper 代替历史产品。

### A4 real Work 历史浏览 consumer 与包一闭环

实现范围：

- 将 A1–A3 组成真实 Work 历史浏览数据流，覆盖原/新 revision、多个 attempt、完成/接受/未知记录。
- main/F 实际视图/HTTP 接线由其 owner 实施，A 交稳定数据并支持实际读取，不造平行历史页面。
- 具备非空真实数据、来源说明、分页/部分/错误，不只提供种表演示或空数组测试。

实际 consumer：

- current main/C 能从 Work 进入历史、查看原候选/verification/source，再返回当前事实而不移动 current 指针。
- 原应用 current/preflight/accept 与原 native guard 独立，浏览不会创建、接受或发送工作。

验收正负：

- 一条真实 multi-attempt Work 浏览链和一个多项目隔离链通过，旧历史保持、当前资格准确。
- source truncated/缺原 binding/迟到数据/错误项目有可操作结果，无读触发写入或重复测量。

source 交接：

- 发布包一完整 source、actual consumer、命令/exit 与准确范围，记录尚未到达的 UI/包层。
- 包一实际完成后直接进入包二，不要求用户重新下发普通流程任务。

## 交付包二：持续普通工作与源级恢复数据

结果是原 Work 的完整日常数据链：两个项目、真实模板/问题/检查/接受、决定撤销及修订、未知回执与重开。
不把普通 controlled 成功冒充 recovered native，也不以“没有 candidates 表”虚构阻断。

### A5 两项目模板与原 Work 问答检查完成

实现范围：

- 复用 main 当前 J server preview/原表单，显式 apply/edit/confirm 后走原 Application/Work/Broker/check/currentCandidate/manualaccept。
- 两项目使用真实原 IDs 和受控问答/检查，不手写终态或从模板建议自动注册脚本/准入 profile。
- preview/取消只读，真正创建/接受才是原命令；原 scope/criteria/profile 完整落库。

实际 consumer：

- main/F 普通日常流程与 C 历史 reader 消费同批事实，项目/对话/Work/原 frozen context 可追溯。
- A 只支持数据/ports，main 保留 UI/API/授权和原 native guard，J 仍是建议数据。

验收正负：

- 两项目各完成问题/回答、机器检查和明确接受，history/evidence/完成事实按真实 ID 隔离。
- foreign project、旧 config/facts、取消/readonly/缺能力不创建或接受，vendor/native 自动调用 0。

source 交接：

- 交真实普通流数据、原 command/receipt 和 main/C consumer，不把报告数量当完成。
- 早交可运行 source 后继续修订/撤销与 unknown 行为。

### A6 current revision、撤销/替代与原事实审计

实现范围：

- 支持原合同修订、当前候选变化、决定 revoke/supersession 与旧完成事实的准确并列读取。
- 历史依旧可审计但不复活为当前有效决定/提案/候选；current 资格按原应用判断。
- 不用数据投影改变执行指针，不新增确认/接受 authority 或状态平行账本。

实际 consumer：

- C/main 当前 source/context/evidence 审计可解释原记录为何历史、撤销、被替代或未知。
- main 的原决定/提案命令和 current/accept 仍执行实际写前检查，A 不造 API/额外批准。

验收正负：

- 正确新 revision/替代/撤销与原旧 receipt 重放不复活 predecessor，不重复接受/Outcome/计时。
- 旧合同/候选/问题/目标不能借历史可读重新变可执行，缺来源保持明确边界。

source 交接：

- 交真实实体修订、原 receipt、状态/metadata 样例及实际 consumer 的准确命令。
- 发布后继续未知回执与重开，不将历史 support 单测冒充整个普通包。

### A7 unknown receipt、原 ID 重开与持久 reader

实现范围：

- 原 command intent、written、observed/result、receipt 和 unknown 持久分层；网络未知沿原 ID/body 重试或 reconcile。
- 原数据重开由不同 Node PID 读取，不换 Work/attempt/request 消除未知，不清 marker/queue/ledger。
- main 明确新委托才使用新 ID；data-only result sink 与真正 B/I live 上游分开。

实际 consumer：

- main/C/H 原 reader 从同 Store 恢复历史与当前引用，不能自己补 empty ledger 或手动 accepted。
- qualified B/I 输入未准入时仅该层未达，普通数据/命令幂等能力继续。

验收正负：

- post-record lost response、重复 same-body、冲突 body、迟到结果与新进程重读有限可复现，无重复原 Work/接受。
- unknown 保留，foreign/旧 epoch 不落错 subject；正常退出和 crash 数据窗口结论准确。

source 交接：

- 交实际原 ID/receiver/receipt/reader 次数、命令/exit 与明确 live 未达项。
- checkpoint 后继续双版本恢复，不把 data-only 称原 Work recovered native。

### A8 源级 v1/v2 snapshot 恢复边界与包二闭环

实现范围：

- 将 A5–A7 同批原数据分别 create/verify 默认 v1 与显式 v2，正式 restore 到独立新根。
- 独立 expectation/content v2/inventory/root mapping 保持，不复制 credential、旧批准、活动连接或 writer 静止结论。
- 原问答/完成历史/撤销替代/unknown/source metadata 读回准确，源级能力与包内能力分开。

实际 consumer：

- C 单 driver 用正式 A API 消费两格式；main/C 原完成与审计 reader 支持恢复后的只读数据。
- 旧已获验 proof 保留为回归，不重新发明 candidate 表、FTS policy 或第二 proof authority。

验收正负：

- 两个实际源级恢复链原 IDs/集合/摘要一致，业务 readonly、held queue/provider 不增。
- wrong snapshot/root/版本、合法 target drift、缺/变 artifact 和 incomplete proof 独立拒绝且不伤旧状态。

source 交接：

- 发布包二完整普通流/回执/源级双格式 source、actual consumer 与原始范围证据。
- 继续包三准确 artifact/同事支持，不等待新一轮微任务派发。

## 交付包三：同一准确 artifact 的恢复使用与支持

结果是可交给同事使用的同包数据闭包：只读恢复、可信历史/搜索/证据、支持导出和高风险跨进程故障处理。
保留不可变 `829RC`；任何 `R2` successor 必须有新 source/tar/hash/mode 和独立 verdict。

### A9 当前准确包 readonly restore 与公共闭包

实现范围：

- 与 main/D/C 固定准确当前 artifact，将正式 history/data/proof 模块闭包纳入真实包，不要求另一个 Agent checkout。
- `829RC`、R2 source/successor、旧包和 E verdict 各自追溯，不重贴或覆盖冻结 bytes。
- 同一个包实际消费两份真实 restore 的原 Q/A/native_applied/完成/source 数据，原执行权限不迁移。

实际 consumer：

- 包内 main/C 正式 ports 能读取完整数据、coverage 和 readonly 状态，D/E 独立负责发行/required gate。
- B 精确 source/guard consumer 采用不等于原 Work 恢复完成，A 不合成 recovered 结果。

验收正负：

- 两格式同包实际读取/identity/STOPPED 或准确保留 unknown，正确模式参数与数据范围相符。
- 包缺闭包/错误 mode/subject/hash 准确失败，不借 checkout 补包或切 fixture 掩盖 ordinary 失败。

source 交接：

- 交准确 package tuple、数据闭包、实际 consumer/命令与 source/installed/native 分层。
- 早交稳定 source 给 D/E 后继续搜索/证据/支持，不等最终全产品 verdict。

### A10 历史搜索、证据读取与精确导出

实现范围：

- 在原只读域支持有界 Work/合同/attempt/完成历史搜索、原 evidence/artifact metadata 与来源关联。
- 支持材料/导出复用原 facts/coverage，明确项目、窗口、revision、未知和内容边界，不扫描全部正文补数字。
- main/G 的公开 display export 和 A 原始历史材料各自语义清楚，不反解析格式化数值或新建统计 ledger。

实际 consumer：

- main/F/C 同事可浏览历史、查看证据、取得明确 scope 的支持输入，H/E 消费原始材料而非新 authority。
- 公开 HTTP/UI/导出接线由 main，A 给稳定数据接口和实际包 consumer，不越 owner 写页面/route。

验收正负：

- 非空多项目/多 attempt 数据可定位原事实，过滤/分页/截断准确，不泄漏其他项目或 credential。
- 缺来源、部分数据、过大导出和旧版本不会产完整零值/虚假通过，不新增模型/执行。

source 交接：

- 交搜索/证据/导出正式类型、实际 consumer、成本与可搬运例子，保留原接受 gate。
- 发布 checkpoint 后继续高风险故障，不把一次文件下载当支持子系统完成。

### A11 高风险跨进程故障与现场保持

实现范围：

- 针对实际包数据消费者覆盖 crash/重开、当前身份变化、unknown result、读中 source/bytes 变化与容量边界。
- indexes 同步 UoW/bytes 事务外/前后复核继续使用，不跨 await 持事务，不无限轮询或删除未知现场。
- 信号只对独立证明本轮出生且完整 fresh PID/start/UID/fullargv/root/config/operation/resources 的精确资源。

实际 consumer：

- main/C/H/E 能根据同一原 ID 与材料区分已读、未达、未知、拒绝和已退出，不由数据健康推物理静止。
- 原 B/I live 恢复未准入时只测实际已准入范围，不能用新 normal Work/合成 ACK 代替。

验收正负：

- 每个故障有正常对照、有限命令/exit、原数据/receipt 读回，不重复发送或接受。
- unknown 保留 root/marker/material，用户十二实例和其他 Agent 进程不被信号或迁移。

source 交接：

- 交实际 fault 工具、原始观察、资源终态与风险说明，不声称短序列等于48h/native稳定。
- checkpoint 后继续文档/支持整合，已过风险不要重复跑全套充时长。

### A12 同事可操作数据发行与三包最终交接

实现范围：

- 形成 current package 读取/恢复/历史/搜索/证据/支持指南和正式 API，清楚定义完整、partial、unknown 与权限边界。
- 版本兼容和必要迁移只由 A 追加；root/contracts/deps 交 main，E 独占断言/checker。
- 完整证据绑定 source/package/data/consumer，不将旧 RC/source-only 或配置观察晋升 native/private/target/release。

实际 consumer：

- 独立同事通过现有主线入口实际使用同一 artifact 和数据工具，main/C/H/E 无需手工改表或复制 profile。
- 新运行字节冻结后再最终验，docs-only 不反复重冻，普通产品不等 blocked 研究。

验收正负：

- 三包实际 consumer 和相关 strict/build/有限正负成立，错误定位准确且原状态可保留。
- B/I live、厂商 native、私有 target、长期 soak/value 未达准确记未达，不用报告 DONE 填齐。

source 交接：

- 写 `packages/workflows/reports/wave31-status.json`，按三包/十二 outcomes 记录 source、consumer、命令/exit 与真实 scope。
- 显式 stage 自有路径推原 origin，不 upstream/reset/清历史；整个三包实际完成才结束 goal。

## 独立备选队列

- main/C wire 未到：先交稳定公开 port、非空真实输入/coverage，继续数据/源级恢复/故障，不造替代 API。
- B/I 原恢复未准入：live 层准确未达，历史/普通流/同包只读/支持继续，不新 candidate 表/ledger/grant。
- 新 R2 artifact 未到：保留不可变829RC及旧准确范围，准备新闭包/consumer，不覆写或重贴包证据。
- vendor/model/native 自动调用 0；B cap4 UNKNOWN 不可花，E 原 pilot BLOCKED 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807 与 all state/profile/tar/ledger/dirty，仅 fresh 独立出生完整资源可受信号。

## 整包完成条件

- 三个包各自有完整实现与真实消费结果，不把十二项拆成用户逐次批准的微阶段或相似测试 gate。
- source 发布后持续执行独立工作；缺外部准入不计 whole complete，但不撤销已过 canonical/history/proof/普通流范围。
- main 保留 root/API/UI/authority，A 唯一生产追加迁移，E 独占断言；无新 Driver/CAC/桌面壳/autoaccept/动态 DAG。
