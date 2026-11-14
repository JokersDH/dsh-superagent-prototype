# Agent C：真实恢复映射与当前产品包完整审阅整包

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-c`，分支 `codex/g3-assistant-context`。
仅拥有 context/proposals/knowledge/routing 四包，原 `pnpm-lock.yaml` 差异和所有历史 runs 保留。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0066](../../docs/rfcs/WP-16/0066-main-trial-workbench-integration.md)、[0067](../../docs/rfcs/WP-16/0067-wave-26-integrated-product-packages.md)。
fetch 并合并最新 `origin/main`，实际 source/接口以当前 AGENTS 为准；main 本轮接入 FTrialWorkspace 与四原动作，G 因四新问题不默认接入。
保留完整 PID/APIstart validator、同次 A manifest 调用和精确 0ede 包 v1/v2 双 restore 的实测成功，不再重派旧缺口。
新问题是路径 root-map 不等于真实 restore provenance：目标合法数据变化后仍可 verified，需要核实际 target 内容与声明的原 source/变换。

建立或延续整个结果包 goal，不设 token 预算。十六阶段持续实施，C4/C8/C12/C16 发布四个可运行完整结果后继续独立阶段。
主结果：真实 restore proof/root mapping → 正确同包双格式正负 → 含 FApp/readiness 的准确新包全链 → 有界故障/工具完整交付。
工具仅核验观察与数据，不新增 SQL、HTTP writer、执行许可、确认 authority、ledger 或生命周期。

## C1 固定已获验单 driver 基线

- 同步 main，保留 `a534ae2` 完整 identity 缺省拒绝和真实 A→package HTTP 单次数据链。
- 准确区分旧 0ede 包、source main 新 UI/readiness 和后继包，不混贴测试或 source 标签。
- 原 descriptor/cleanup/HTTP abort 正向继续保留，只扩大新增 provenance 与故障风险。
- 主线来源诊断 UI/TrialWorkspace 入口已发布后不能继续称缺失；C 不改 App/transport/根 CSS。
- 验收：明确本轮实际接口、consumer/package source 与新缺口，不重做已关旧修补。
- 交接物：稳定输入、状态/退出码、原数据与依赖表。

## C2 消费真实恢复内容 proof

- 与 A 约定原 snapshot identity、实际 restore 报告、原 subject/集合摘要和 target 内容核验结果。
- input 从真实 producer/restore 取得，不能从两条路径字符串或待核验 report 自己推导全部期望。
- 区分 workflow evidence digest、recoverySource fingerprint、DB/artifact bytes 和健康状态。
- C 不复制 A 读库/清单算法，不新建签名或授权权威；缺稳定 API 交 main/A 最小真实调用需求。
- 验收：同一次 driver 实际调用公开 content proof，缺/错/unknown 证据在 claiming verified 前拒绝。
- 交接物：typed consumer contract 和正式 proof 输入示例。

## C3 原根到目标的实际身份核验

- 核 target 实际 fingerprint/原实体集合与所声明 snapshot/root mapping，不仅比 realpath(from/to)。
- 目标新增合法用户消息、换 artifact、不同快照或相同 ID 的不同数据必须与原期望准确区分。
- 允许的元数据/根变化必须版本化、明确且能解释；不能泛化忽略所有时间、状态或报告字段。
- main 的当前只读选择仍由原 gate 决定，内容身份失败不等于存在产品授权绕过。
- 验收：完整正确恢复正对照通过，独立 target-only 合法数据 drift 不再 verified，原数据/实例保持。
- 交接物：实际 drift 反例、拒绝原因和准确只读/内容 scope。

## C4 第一里程碑：可信恢复映射

- 交一个真实 A manifest + snapshot/restore proof + target 核验 + HTTP consumer 的可运行结果。
- 复验当前已过完整 identity、原 IDs 和正确只读结果，不撤销旧准确包成功或重称孤立链。
- 审阅 selected data 与证明原恢复内容完整是不同声明；若仅前者必须在输出显式缩小 scope。
- proof API 未到先交 consumer 输入/独立期望和 source 正负，继续其余独立阶段。
- 验收：第一完整结果能准确区分正确/变更目标，发布 checkpoint 后继续 C5。
- 交接物：源码、准确包/数据输入、命令/exit 与未达层。

## C5 两个格式的准确 snapshot 输入

- 复用同一真实 Store 的原 Broker/SDK/候选/context 数据，分别取得默认 v1 和显式 v2 快照。
- 使用各自真实 families/配方/摘要，不重贴版本或以 DB 相同代替格式验证。
- 每个版本独立 producer/expectation/manifest 与 snapshot identity 可追溯。
- protocol 不同的 personal-evidence/bundle 另列，不能机械改名当版本兼容。
- 验收：两个正确格式独立通过，错配版本/摘要/缺数据准确拒绝。
- 交接物：两格式准确 source、bytes、原 ID 与 proof 输入。

## C6 两根实际恢复与新选择

- 每份快照分别经真实 restore 到新根，生成新明确读取选择，不 copy DB 后手写 marker。
- root mapping 与 target proof 来自真实操作，旧 credential/批准/活动连接和静止结论不继承。
- 同个准确包实际消费两个根，保留 original consumer 与数据字节的对应。
- provenance unknown 保留现场，不自动重新恢复、改 root 或补空记录制造成功。
- 验收：两独立 restore 都能核到原 subject，wrong root/artifact 与缺 proof 拒绝。
- 交接物：实际 create/verify/restore/selection/consumer 链。

## C7 同包数据和独立失效

- 同次 driver 从 A manifest 取得 Work/question/answer/delivery IDs，读取候选/history/原文并验证实际摘要。
- 合法窄 Scope/新增排除保持原 main gate，诊断只解释，不能展示被拒正文或取得批准。
- fresh 合法正对照后分别改变 signature/source/marker/artifact/root/Scope/有效期，原因不累积混淆。
- 原 context/confirm receipt 重放、权限问答显示与普通输入隔离继续保持。
- 验收：正确数据、窄读态和每个独立失效准确，业务 422、provider/queue 无增。
- 交接物：实际同包正负矩阵及原 ID/字节保持记录。

## C8 第二里程碑：双格式恢复正负闭环

- 发布完整同包双格式 restore/proof/manifest/HTTP 链，而非多份 PASS 拼接。
- 包含新增 legal target drift 拒绝、完整 identity 和准确 cleanup 结果。
- 原已测 0ede 成果保留；新 content proof 通过不外推业务重接/native/private/target。
- 外部后继包未到时交旧准确包可复跑结果和精确未达字段，不用 checkout 替包。
- 验收：第二完整结果可从单调用按真实 scope 复现，交后继续后继产品包。
- 交接物：准确 subject、命令和 E 可独立验证的原始观察。

## C9 当前 FApp/readiness 的准确包

- 消费 D 冻结且真实包含 main TrialWorkspace/App 四动作和 authenticated readiness 的准确新字节。
- 记录 source/tar/hash/build/schema/ABI/mode 与实际 CLI/consumer 文件，旧包不认证晚 UI。
- G 当前四新问题未关闭时不默认接其 summary，任何观察数据不变成质量或执行权。
- 新运行字节先冻结再测，docs-only 不要求反复 freeze；C 不编辑 D distribution 或 E 断言。
- 验收：包内能力确实存在且只读请求真实返回，缺能力正确未达，不借静态 marker 称交互完成。
- 交接物：新准确包输入、旧/新范围对照与 consumer hash。

## C10 新包完整用户数据链

- 在新包复跑同次 A manifest、两格式 restore content proof、原 ID HTTP 读取与只读拒绝。
- readiness configured/fixture/unknown/readonly 必须按配置事实理解，authorization 恒 none，不是 native grant。
- F 组件和四导航动作由 main/F 负责，C 给真实数据输入及复现，不越权改 UI。
- 模型/执行/旧队列不能因 UI 进入或 refresh/readiness 被隐式触发。
- 验收：新产品字节与实际数据链相符，缺集成准确定位 source/consumer，不否定旧准确包。
- 交接物：新包原数据/能力与 main/F 可以直接消费的真实输入。

## C11 错误、重开和资源归还

- 有限覆盖同选择 reuse、不同选择拒绝、窗口重开、入口早退、网络失败与 current source 变化。
- 每次 actual status/health 绑定完整 PID/start/API/root/config/operation/review，不能仅端口和路径认领资源。
- 仅停止 fresh 独立证明本轮出生的精确资源；合法 reused/keep 不停止，unknown 保留材料。
- owned stop 失败必须非 verified/非零，不能因缺 PID 初始化 false 而认证资源已消失。
- 验收：成功和拒绝路径准确、无悬挂自有资源，无用户/其他 Agent 进程动作。
- 交接物：实际生命周期、有限错误与终态记录。

## C12 第三里程碑：当前产品包交付

- 交包含实际 FApp/readiness 的准确包与原同包数据/恢复全链，source 与 installed verdict 保持分层。
- C 数据/工具观察不替代 F UI 或 E release 断言；G 未准入不阻其余普通产品能力。
- B/private/target/研究未到只阻相应结论，普通只读/安装/体验继续。
- 发布第三可运行结果后继续时限、工具 API、文档和独立队列。
- 验收：当前产品包的声明都对应实际 source/bytes/运行，晚功能无混贴。
- 交接物：准确新包、数据、consumer、真实 scope 与未测项。

## C13 全局 deadline 与有限故障

- prepare/identity/manifest/restore proof/start/HTTP/status/stop 全部受总预算和预留 cleanup 限制。
- 实际校准 silent peer、半 JSON、缓慢 producer、PID 等待、SIGTERM 无响应和未知终态，不只单测 remaining 参数。
- 输出、日志、manifest、response bytes 和分页有上限，不为补统计扫描全库正文。
- 预算耗尽准确失败/unknown，保留状态和材料，不能越界换进程身份或无期限轮询。
- 验收：承诺的全阶段时限有 elapsed/exit 证据，资源归还或保留结论可复核。
- 交接物：总限分配、实际故障矩阵和准确 cleanup proof。

## C14 完整公开工具接口

- 收口一个 consumer API，支持 source/package dialect、A 数据输入、真实 restore proof 和内容 scope。
- 参数/输出不依赖旧 wave 测试文件或本机私有路径，版本和 unknown/partial 语义准确。
- observed、verified-flow、reused、refused、NOT_REACHED、failed 与 exit 语义明确，caller 不猜绿灯含义。
- strict/exactOptional、对应 build 和实际 main/A/D/E consumer 编译通过，shared 变更交 main。
- 验收：独立调用者按文档运行同次完整流程，缺能力能准确处理，无 hidden source fallback。
- 交接物：正式类型/CLI、输出 schema、版本和兼容说明。

## C15 UI 输入与独立验收交接

- 更新真实四来源状态/七原因、partial/遮蔽数、readiness 和恢复失败样例，供 main/F 使用。
- 禁止 token/principal/raw path/readable count 或 quality/权限推断进入不必要展示。
- 给 E 真实 producer/snapshot/restore/proof/consumer 与准确包字节，不修改它的 required assertions。
- 长期撤权、并发 writer、native/业务恢复等未测范围准确保留，不用短序列称 48h soak。
- 验收：main/F 有真实输入，E 能独立复现范围，source/module/package 与后继 UI 不混证。
- 交接物：UI input、完整使用指南和原始证据索引。

## C16 第四里程碑与最终整包结果

- 状态写 `packages/context/reports/wave26-status.json`，逐阶段列 source、command/exit、原 ID、proof、actual consumer 和资源结果。
- 第四完整结果覆盖真实恢复映射、同包双格式正负、当前产品包、全局时限和工具 API。
- source/package/installed、normal/recovered/native、private/target/value 分层，不把工具 verified 升级为发布。
- 显式 stage 自有路径并 push 原 origin 分支，不 upstream/reset/清历史，保留 lock 差异和全部 runs。
- 验收：每项承诺实际可复跑，依赖未达不计完成；整包真实完成才结束 goal。
- 发布检查点后继续独立队列，不等待用户再派旧小修。

## 独立备选队列

- A proof API 未到：先交真实 consumer 输入/期望及 drift 复现，继续准确旧包正向、identity 和有界故障，不复制 SQL/清单算法。
- D 新包未到：保持旧 0ede 同包双格式成果，准备当前 F/readiness 精确输入，晚功能准确未达。
- main/F/G 接线未齐：给最小真实调用和复现，继续工具/文档/时限，不改他人拥有路径或默认接未准入 G。
- vendor/model/native 自动调用 0；B cap4 UNKNOWN 不可花，E BLOCKED pilot 不重置、不 topup/refund/补样。
- 保留十二服务 5180–5191 / 8796–8807、全部 state/profile/tar/ledger/dirty；只处理 fresh 独立证明本轮出生的精确资源。
- 不新 Driver/CAC/桌面壳/autoaccept/动态 DAG，不改 main HTTP/UI/contracts、A SQL 或 E 断言。
