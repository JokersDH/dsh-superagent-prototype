# Agent A：原身份持久事实与同包恢复数据整包

继续 `/Users/hh/Desktop/joker/superagent-agent-a`，原分支 `codex/g2-workspaces-verification`。
只拥有 `packages/storage/`、`packages/workflows/`，包含唯一生产 SQL 和追加迁移所有权。
先读根 `START-HERE.zh-CN.md`、`product-spec/README.md`、[本轮 README](README.zh-CN.md)、[0058](../../docs/rfcs/WP-16/0058-optional-frozen-source-scope-diagnostics.md)、[0060](../../docs/rfcs/WP-16/0060-main-ordinary-distribution-source-integration.md) 与 [0061](../../docs/rfcs/WP-16/0061-wave-23-admission-and-end-to-end-packages.md)。

主线 `8c8fdefa12ff04d524eec8424efe3a90bc09a6fd` 已发布 launcher、portability 与构建的完整源码集成，可直接 fetch 并合并 `origin/main`，不等待下一次派工。
保留 A `d8750fe` 已通过的真实受控问答、`native_applied`、同进程 Store 重开与事实配方。它们不是独立 Node 进程读取或 B 的业务恢复证明。
本包目标是让一个新的协调器进程从原事实继续工作，并让相同真实数据通过两个快照版本在准确安装包中审阅。

建立或延续覆盖整个结果包的 goal，不设 token 预算。十阶段连续推进，提交检查点后继续独立阶段。
三个可运行里程碑：早期交分进程原身份读取与数据清单；中期交获准 B 接入后的原结果落库；最终交同包双版本数据流程和最终证据。
若 B 或安装包未到，中期只标该依赖 `NOT_REACHED`，继续 A6–A9，不把同进程重开重新包装成中期完成。

## A1 固定可复用的事实输入

- 合并当前主线，保留原分支、报告、快照、原生配置和账本，不用 reset 或复制旧 dist 替换源码。
- 以已有 bindings/current、commands、dispatch、observations、payloads、question/answer/delivery 和 recoverySource ports 建立事实地图。
- 分开记录 command 意图、传输写入、原生观测、应用结果与 unknown；独立合成目标的示例不得冒充真实业务投递。
- 验收：发布可运行的原 Work/question/answer 生产配方，列出精确 source、命令、原 ID、每类事实的实际来源和未测范围。
- 交接物：事实字段到现有 port 的映射表、原 ID 示例，以及 B/main 可以直接执行的 producer 命令。

## A2 独立 Node 进程读取

- 新增真正的 reader 子进程，由另一个 Node PID 打开原状态并经现有公开 ports 读取原 attempt、ticket、assignment、contract、epoch 和 session。
- 在同步 UoW 内取得相互关联的索引和引用；异步 payload 读取在事务外完成，必要时重新核对稳定身份，禁止跨 await 持 SQL 事务。
- writer 退出后读取和正在运行时的只读观察分别报告；逻辑读取一致不能声称物理 writer 已静止。
- 验收：记录不同 PID、原状态根及原 ID，跨进程读到一致实际数据；坏 ID、过期 current、缺 payload 各有独立有效正对照与有限拒绝。
- 交接物：独立 reader 入口、输入 schema、有限生命周期记录和真实跨进程比对结果。

## A3 真实数据清单与第一里程碑

- 为 producer 和 reader 输出有版本的数据清单，绑定实际源码 SHA、数据根、快照格式、原实体 ID、payload 摘要和观察范围。
- 字段从真实返回值和实际字节计算，重新读验摘要；不得通过手填 source、空列表、缺字段默认值或另一数据根补齐成功。
- 清单只是数据完整性证据，不是新签名权威、可执行许可、物理静止证明或新的恢复账本。
- 验收：正确清单通过，唯一替换 payload、原 ID 或数据根时准确拒绝；提交早期源码和可重跑命令后继续整包。
- 交接物：清单 schema、实际正向样例、单变量变异样例及核验命令，不含 credential 或可重用批准。

## A4 原始投递窗口与不确定性

- 在可控本地传输中分别覆盖未发送意图、写入后未观测、实际观测、实际结果和 unknown，保持原 command/target/attempt。
- 将测试注入点和真实业务事实分开记录；存在 command receipt 不得推断 native 已收到，ended 不得推断资源已停止。
- 崩溃窗口有独立正对照、deadline 和原 ID 读回，unknown 保留原记录，不换 command 或 attempt 补发获得“成功”。
- 验收：新 Node 进程能区分每个窗口，重复读取不增加投递次数、结果行或队列消费；缺失证据保持 unknown。
- 交接物：窗口到持久状态的矩阵，列实际 receiver/observation/结果次数及判断 unknown 的证据。

## A5 获准业务重接后的结果落库

- 只消费主线准入的 B 实际 business attach port，不凭 inspect/cancel、descriptor 或旧状态字符串宣布业务恢复。
- 使用原 A 登记端点、原 resource proof 和主线写前授权；结果落回原 Store、原 fact/answer/delivery，不建立第二 ledger 或执行生命周期。
- 检验重复事实、重连后迟到 ACK、旧 epoch、不同 question/session 和中断重入，只有实际返回结果能成为 `native_applied`。
- 验收：新协调器进程接原 Runner 后，原结果幂等落库且无重复发送；提交中期源码、精确调用契约和未达项，然后继续。
- 交接物：A 公开 consumer 调用样例、原实体关联和重复事实负例；B 端尚未准入时只交输入契约与依赖说明。

## A6 同一真实业务与上下文数据

- 将真实受控 Work、Broker 问题、回答、delivery、SDK 候选、确认回执和冻结上下文组织在同一 Store，避免拼接不同 fixture。
- producer 使用原公开应用和 Broker 路径，不手写 SQL 构造 delivered、native_applied 或候选验证结果。
- 权限问答显示数据与普通模型输入分离，已有批准不能转移到另一原生请求；历史正文始终绑定原冻结摘要。
- 验收：manifest 的原 ID 可经实际 HTTP/公开 reader 对回同一批数据，provider 请求数、队列和原回执都有明确前后值。
- 交接物：同 Store 单链 producer 与可供 C/D/E 复用的数据 manifest，禁止要求调用者手工修改内部表。

## A7 两个快照版本与第二根

- 同一数据分别生成默认 workflow v1 与显式 v2 快照，保留各自真实摘要配方；personal-evidence/bundle 是另一协议，不混用版本。
- 两份快照分别校验并恢复到全新的第二状态根，不复制原 credential、可执行授权、旧活动连接或未知 writer 结论。
- 经当前真实 personal 只读入口审阅候选、history、Work、delivery 和原文，窄选择与新增排除仍由原主线 Scope gate 决定。
- 验收：两格式都完成原数据读回，业务请求 422、held queue 未消费、provider 无新增；未获得原文时只给准确状态，不填空冒充完整。
- 交接物：两份准确快照 subject、各自校验结果、第二根读回记录和不会继承的授权说明。

## A8 接入 C 的唯一参数化驱动

- A 提供 producer、分进程 reader 和数据清单；C 提供唯一 consumer driver，避免再造第二套来源与状态判断。
- 与 D/E 使用明确 install root、producer SHA、快照格式、原 ID、新根、端口及准确入口调用同一流程。
- 安装包缺入口或版本时标准确能力缺口，不借 checkout 的 review/start/demo 补齐旧包；包内 consumer 字节由 D/E 独立绑定。
- 验收：source 流程能运行，包输入可参数化且无手工改脚本；source、package、normal、recovered 分开给结论。
- 交接物：驱动所需原 ID/格式/期望结果数据文件，以及 D/E 可直接代入安装根运行的完整命令。

## A9 一致性、成本与严格检查

- 对实际新增 reader 和清单做 strict/exactOptional、相关 build 与有意义的负例，已通过旧套件按来源引用，不重复凑测试数。
- 限制分页、行数、payload bytes 和子进程时长；不为填展示计数扫描所有正文，不把未知值置零。
- 有真实能力缺口时先给最小公开 port/RFC；迁移只追加且由 A 实施，不为满足旧 probe 添加空方法。
- 验收：相关消费者能严格编译；越界、缺表/版本、损坏字节和过期身份在读取或写入边界准确拒绝，测试资源有限退出。
- 交接物：新增风险的有限回归清单与成本记录，说明哪些旧规模证据直接复用、哪些实测行为首次覆盖。

## A10 最终源码与结果交接

- 第三个可运行源码里程碑交付跨进程原身份事实、B 实际消费范围和同包双格式数据路径；未达依赖不得在总数里算完成。
- 状态写 `packages/workflows/reports/wave23-status.json`，逐阶段列 source、command、exit、原 ID、数据清单、consumer/package subject 和结论。
- 新增运行字节由 D 冻结、E 独立验收；docs-only 更新不要求重冻，不凭 static PASS 或更多测试增加完成度。
- 显式 stage 自有路径，只 push 原 `origin` 分支，不推 upstream；发布后继续独立队列，goal 仅在整包实际完成后结束。
- 最终交接明确分别说明分进程读取、恢复落库、同包读取、native 和发布状态，不用一个 PASS 掩盖未达到的层级。

## 独立备选队列

- B 未准入：完成真实分进程 reader、原始投递窗口、数据清单和双格式同 Store producer；只阻 A5，不自造替代执行器。
- 新包未到：完成 source consumer 数据与准确入口参数交接；保存 installed `NOT_REACHED`，不回退源码替旧包。
- C driver 未硬化：交明确数据期望、独立正负清单和原身份结果，不把其 `status:ok` 当验收授权。
- 全程真实 vendor/model/native 调用 0；B 原 cap4 UNKNOWN 不可花，E 原 BLOCKED 试点不重置、不补样、不退款。
- 保留十二服务 5180–5191 / 8796–8807、所有状态、profile、tar、账本、旧 dirty 和历史报告；只清理独立证明本轮 probe 出生的精确资源。
- 不新增 Driver、CAC、桌面壳、自动接受或动态 Ticket DAG；主线负责 HTTP/UI/授权，E 负责独立断言，A 不越界修改。
