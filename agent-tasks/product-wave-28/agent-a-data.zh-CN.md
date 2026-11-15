# Agent A：当前版本数据消费者与原事实完整交付

日期：2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-a`，原分支 `codex/g2-workspaces-verification`。
仅拥有 `packages/storage/`、`packages/workflows/`；生产 SQL 和追加迁移仍由 A 唯一实施。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0071](../../docs/rfcs/WP-16/0071-wave-28-architecture-inputs.md)、[0072](../../docs/rfcs/WP-16/0072-wave-28-integrated-delivery-packages.md)。
同步最新 `origin/main`，实际 source/接口以 AGENTS 和 main 已发布检查点为准；十位外部 Agent A–J 加 main 正常并行。
保留 `aeeced18` 已获验内容：独立 artifact inventory、精确 FTS/content v2、事件/消息 drift 拒绝和实际 AC 双格式消费者。
旧三反例已由独立完整正负复验关闭，不再列为本轮待修；源级 strict 与准确 ce64 包的成功都保留原 scope。
用户取消当天完成目标，正常节奏/正常门槛推进，不通过降范围或报告 DONE 提前结束。

建立或延续整个结果包 goal，不设 token 预算。24 阶段，A4/A8/A12/A16/A20/A24 后发布六个完整可运行结果，交后继续。
主线保留授权/HTTP/UI/contracts；数据完整性、报告和只读源不授执行、物理静止或发布权。

## A1 固定当前已准入数据基线

- 合并当前 main 并记录实际源码、公开 ports 与已导入/待导入的最小数据闭包。
- 复用独立 inventory/content v2/UoW/bounds 与真实旧正向，不重开旧 prefix 或 event allow-list 修补。
- source、ce64 包、当前主线与 live B/I 结果各自记录，不能互贴或泛称所有包不可用。
- 验收交接：发布当前 source/consumer/依赖清单，新增工作对应真实消费者能力。

## A2 收口正式 proof 数据 API

- 用稳定类型表达 expectation、manifest、snapshot、restore/content/artifact proof 与 report-only/independent。
- 明确 workflow snapshot v1/v2 与 content v2 的不同版本含义，旧 content v1 只按历史 recipe 兼容。
- 接口不依赖旧 wave 测试路径、固定用户目录或新权限 token，不产生第二 ledger。
- 验收交接：独立 caller 可严格编译并准确处理 complete/unknown/unsupported。

## A3 接当前主线真实 consumer

- 给 main/C 早交可运行源码闭包，按当前 Store/实际消费点编译，而不只构建 A 自己的 src。
- storage/workflows 的必要 exports 和消费类型准确，根 lock/公共 contract 由 main 处理。
- 无必要迁移就不新增 schema；确需能力缺口给最小原调用复现，不增 probe-only 空方法。
- 验收交接：实际 main consumer 能调用并有限读验，接口 checkpoint 不等待整包完成。

## A4 第一完整结果：当前 proof 消费闭包

- 交当前主线可用的独立内容/完整集合/恢复验证 API 与真实 consumer。
- 正确数据与现有 drift/缺失拒绝按原 scope 复用，只对新接线风险做有限验证。
- 不能把类型/报告/指纹当启动许可、原生批准或物理 writer proof。
- 验收交接：第一 runnable 结果可独立复现，发布 source 后继续 producer/readers。

## A5 复用原业务与完成事实

- 原 producer 经 Application/Broker/SDK 路径产生同 Store Work、问答、delivery、候选与冻结上下文。
- 候选/current/accept 使用现有 ProductCompletion records、verification 和原完成 gate。
- 已确认“不存在 candidates 表”不是阻断，不新增候选表、平行状态或手写 accepted 终态。
- 验收交接：给真实原 ID、公开读取与 current/accept 调用例，B/I/main 可直接消费。

## A6 参数化 producer 与独立 reader

- 从真实 producer 提供独立 expectation/required collections，manifest 不自选删空必需集合。
- 新 Node PID 经原 ports 读取同一 subject，payload bytes 在事务外，保持前后复核和成本限制。
- 原 command intent、written、observed、result 与 unknown 分层，不从 receipt 存在推断收到。
- 验收交接：正式参数入口可跨新根运行，重复读取无新发送/事实/delivery/queue 消费。

## A7 两格式原数据准备

- 同批原数据分别 create/verify 默认 v1 与显式 v2，保留各自真实配方和 artifact。
- 每份 snapshot 独立绑定原 subject/content/inventory，不改标签或用 DB 相等代替版本验证。
- 不导出 credential、旧可执行批准、活动连接或未知 writer 结论。
- 验收交接：两格式准确数据输入及 reader 可交 C/D/E，缺能力准确未达。

## A8 第二完整结果：可复用 producer/readers

- 交稳定原事实生产、独立读回、双版本 snapshot 与真实数据清单的一条完整路径。
- 文档/例子能让真实 consumer 取得原 ID，不要求手查私有列或修改 fixture 才能运行。
- 原 public stores/queues/ledger 继续唯一，不把数据包变成第二执行 lifecycle。
- 验收交接：第二 runnable 结果有实际调用，提交后继续当前准确包。

## A9 当前准确 artifact 输入

- 与 main/D 固定实际包含当前 UI/只读统计/所需运行字节的准确 package subject。
- 记录 source/tar/hash/build/schema/ABI/mode 与数据/proof consumer 的对应，不重贴旧 ce64 结果。
- D/E 新模式问题按具体 mode/source 处理，不能泛称所有普通包不可用。
- 验收交接：准确包参数与已知限制明确，外部未到继续独立数据工作。

## A10 同包两根真实恢复

- 两份 snapshot 分别经正式 API restore 到独立新根，生成准确 content/inventory/root 关系。
- 让 C 单 driver 在同一个准确包消费两根，避免同次 copy 或 source helper 补旧包能力。
- 新明确读取选择不继承执行批准；旧 held queue 和 unknown 资源屏障保持。
- 验收交接：两个实际 restore/consumer 可追溯原数据，正确与独立失效准确分开。

## A11 包内原问答与冻结证据

- 包内读取原 Work/Q&A/native_applied/候选/history/原文，ID/集合/摘要来自同次 A 输入。
- 权限显示不进入普通模型上下文，当前 live source 不替代历史 frozen body。
- readonly 业务拒绝、provider 无增、旧队列不消费，configured/fixture 不升级为 native 准入。
- 验收交接：真实 HTTP 返回与原清单相符，普通只读与未来业务恢复分层。

## A12 第三完整结果：当前包双格式数据链

- 交同 manifest、当前准确包、两格式独立恢复和原问答/证据读取全链。
- 旧三完整性反例保留为回归，不把它们重复包装成本轮六个结果。
- E 保留独立 required/installed 结论，A/C 数据成功不代替包发布或 native。
- 验收交接：第三 runnable 结果准确可复跑，发布后继续真实恢复结果持久化。

## A13 合格 B/I 回调输入

- 只消费 main 准入的真实 B/I 通道，身份从原登记/current facts 来，不从 readiness 或 JSON 自报获得权。
- 原 A sink、immutable payload、question/answer/delivery 与主线 fresh guard 继续唯一。
- 无实际 attach 时不把 data-only sink、inspect/cancel 或 fixture ACK 称 live recovered result。
- 验收交接：给真实 consumer 类型/原 tuple/返回语义，缺依赖只阻对应步骤。

## A14 原结果与幂等落库

- 实际返回结果写原 fact/command/attempt/question/answer/target，重复/迟到结果不得串用。
- 原已观察结果重放幂等，unknown 保持 indeterminate，不换 ID 发送或重建空账本。
- native_applied 只由实际返回请求产生，历史批准和 send 标记不能替代。
- 验收交接：原 ID 一次应用、重复次数不增，foreign/过期/未知各准确持久。

## A15 原完成与接受读回

- 复用 ProductCompletion/verification 的真实 current candidate、check 结果和人工接受记录。
- 跟踪结果、artifact、verification、acceptance 与原 Work 合同，不创建 candidates 表或平行 authority。
- 人工接受须原应用明确操作，数据 reader 不自动 accept/merge/deploy。
- 验收交接：独立新进程读到原完成事实，旧版本/错误候选不能被恢复重接放行。

## A16 第四完整结果：原事实恢复交付

- 交获准 B/I 的原结果持久、原完成/verification 与 reader 组成的真实恢复数据链。
- B/I 未准入时准确 partial/未达，已完成普通数据/同包结果继续发布。
- 数据一致不是物理静止或执行新目标授权，不增加第二 ledger/批准层。
- 验收交接：第四 runnable 结果原身份可追溯，交后继续故障与边界。

## A17 有限故障与独立读回

- 覆盖新 consumer 的正常退出、SIGKILL 数据窗口、结果未达和 reader 中断，原 ID/未知保留。
- 每个故障有合法正对照、有限时长和实际数据终态，不用同进程重开替代跨进程。
- 只处理 fresh 独立证明本轮出生的精确资源，unknown 留状态/marker/material。
- 验收交接：故障后无重发、无数据删除，正确/未知/拒绝可审计。

## A18 版本、成本和异常输入

- 保持 schema/recipe 兼容，限制表/行/manifest/累计 artifact bytes 和子进程生命周期。
- 新接线的缺 family、unknown version、损坏/替换、过大或不完整数据有限失败。
- 不为展示指标扫描全库，不将 unknown 置零；旧规模证据可按准确来源引用。
- 验收交接：相关 strict/build 与有意义边界通过，正确老范围不被无关改动破坏。

## A19 模式与状态保持

- 将 fixture、normal personal、recovery readonly 和新目标权限的真实区别写入消费结果。
- D/E mode 问题只阻对应路径，不能借切 fixture 掩盖 ordinary/personal 失败。
- 原十二实例、native profiles、tar、队列、未知 writer 和账本全部保留。
- 验收交接：正确模式不误报准入，失败不会触发旧实例迁移/停止或清空状态。

## A20 第五完整结果：可操作故障边界

- 交当前 consumer 的跨进程、版本、成本、mode 与异常操作组成完整工具结果。
- B/private/target/研究未到不阻普通只读源；短序列不宣称长期稳定或厂商兼容。
- 原始材料供 E 独立核验，A 不修改其断言来使结果通过。
- 验收交接：第五 runnable 结果有明确命令/exit/资源结论，发布后继续最终交接。

## A21 稳定公共 API 与可搬运示例

- 清理实际 consumer 对固定 A/C 工作树或旧 wave 文件的必要依赖，改用稳定公开模块输入。
- main/C/D/E 能按正式类型调用，不增加新的 SQL writer、空方法或权限 token。
- 公共 contract/根 deps/lock 仍由 main 集成，迁移仅必要时由 A 追加。
- 验收交接：当前实际 consumer 严格编译，跨显式新根可复跑并准确报未知。

## A22 文档与维护输入

- 在自有 workflows 文档说明 producer/reader/proof/restore/result、错误和支持范围。
- 给 main/F/D/E 可直接使用的真实数据/命令，不把架构愿景或未达 B 能力写成当前功能。
- 保留 content v1 历史兼容说明，明确当前内容闭包使用 v2，snapshot 格式另列。
- 验收交接：独立调用者可理解每个 ok/partial/unknown 的实际 scope。

## A23 独立 package 验收交付

- 给 E 准确 source/snapshot/restore/proof/原 IDs/consumer/package tuple 与原始观察。
- 新运行字节冻结后再最终验，docs-only 不要求重冻，source-only 不认证不同包。
- 不以报告数量、阶段计数或局部 source 通过推导 whole native/release。
- 验收交接：E/main 可复现准确范围，旧成功材料和未达项不被覆盖。

## A24 第六完整结果与整包状态

- 写 `packages/workflows/reports/wave28-status.json`，24 阶段列 source、命令/exit、原事实、proof/bytes 与真实能力。
- 六结果为当前 proof consumer、producer/readers、当前包双格式、原恢复结果、故障工具、公共 API/交接。
- 显式 stage 自有路径并 push 原 origin，不 upstream/reset/清历史；整包实际完成才结束 goal。
- 验收交接：每项承诺可实际运行，缺外部输入不计 whole complete，checkpoint 后继续独立队列。

## 独立备选队列

- C/main wire 未到：先交稳定数据 API/真实输入、reader/双格式/故障，不重复旧三反例当新任务。
- B/I 未准入：继续原完成事实和 data-only reader，live 结果准确未达，不造新候选表/ledger。
- 新包或 mode 输入未到：保留准确旧范围，准备新 consumer tuple，具体阻断不泛化成所有包不可用。
- vendor/model/native 自动调用 0；B cap4 UNKNOWN 不可花，E 原 pilot BLOCKED 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807 与全部 state/profile/tar/ledger/dirty；仅 fresh 独立出生资源可受信号。
- 不新 Driver/CAC/桌面壳/autoaccept/动态 DAG，main 保留 authority/HTTP/UI，E 保留独立断言。
