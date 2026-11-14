# Agent A：清单驱动的同包数据与原结果恢复整包

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-a`，原分支 `codex/g2-workspaces-verification`。
仅拥有 `packages/storage/`、`packages/workflows/`，包括唯一生产 SQL 和追加迁移所有权。
先读 `START-HERE.zh-CN.md`、`product-spec/README.md`、[本轮 README](README.zh-CN.md)、[0064](../../docs/rfcs/WP-16/0064-trial-readiness-and-parallel-inputs.md) 和 [0065](../../docs/rfcs/WP-16/0065-wave-25-eight-agent-delivery.md)。
fetch 并合并最新 `origin/main`，实际 source/接口以当前 `AGENTS.md` 为准。八位外部 Agent A–H 与 main 并行，不能扩大自己的路径所有权。
保留 A `e60e130` 完整 subject、独立 required sets、同步 UoW、payload 前后复核、成本与不同 Node reader 的 2/2 成果，不再重派旧修补。
C 已实际调用 A 模块和 reader，但清单、恢复和 HTTP consumer 仍是分开的流程；本包把它们接成同一次真实操作。

建立或延续整个结果包 goal，不设 token 预算。十六阶段持续执行，不在一个小修或源码发布后结束。
在 A4/A8/A12/A16 发布四个可运行完整结果里程碑，交后继续独立阶段；缺依赖准确分层，不把检查点当等待点。
主结果：真实 producer/expectation/manifest 输入 → 两格式同包独立恢复 → 获准 B 原结果持久化/故障 → 完整可复用数据 API。
所有 manifest、readiness 和 observation 都是数据，不授发送、恢复启动、执行、人工接受或发布权。

## A1 固定已获验数据基线

- 同步当前 main，记录实际 A source 与依赖版本，保留原分支、账本、报告、快照和所有状态。
- 沿用已过原 subject/required sets/UoW/成本 contract，不为新 consumer 改回 manifest 自选集合或空成功。
- 明确真实 controlled producer、原生 observed、source review、installed consumer 与 recovered result 的不同范围。
- 列出 C、B、D/E 实际可调用输入，依赖缺失只阻对应阶段，不反复排旧兼容测试。
- 验收：形成版本固定的数据入口清单，已有 2/2 按原 scope 保留，新增工作定位到实际消费缺口。
- 交接物：当前 source、公开 API、原 ID 与依赖状态表，供 C/main 直接引用。

## A2 定义一次操作的数据输入

- 供 C 同一次 driver 调用取得真实 producer、独立 expectation 和 manifest，而不是让调用者手填 subject。
- 输入明确 source、原 Store、目标格式、原 Work/attempt/question/answer 和可信 required collections。
- 恢复根映射来自真实 snapshot/restore 事实，原数据根不能靠改字段后重算摘要替换。
- 数据输入不含 credential、可移用批准、进程控制权或新恢复 grant。
- 验收：消费端能从一个输入关联到同一批原事实；坏 ID、错 source/格式和 incomplete coverage 准确拒绝。
- 交接物：稳定类型、公开参数化入口和真实样例，确需 shared contract 时交 main 最小 RFC。

## A3 提供可运行 producer 与独立 reader

- producer 经现有 Application/Broker/SDK 路径产生真实 Work、问答、delivery、候选和冻结上下文。
- 独立 Node reader 读取同一原 subject，并验证由 producer 独立提供的 expectation，不从清单反推必需输入。
- 结果中的 source、PID、原 ID、payload 摘要与计数来自实际字节和返回值，不手写业务终态 SQL。
- 合成 written/unknown 窗口可保留，但必须与真实原生命令观测分开标注。
- 验收：不同 Node PID 读到真实同 Store 数据，重复读取无新发送、事实、delivery 或队列消费。
- 交接物：可以直接运行的数据生产/读验命令和干净数据 manifest。

## A4 第一里程碑：真实输入已接 C

- 与 C 在其唯一 driver 上实际传入 A producer/expectation/manifest，不能只增加另一个独立验证测试。
- 同一调用记录数据准备、原身份核验、consumer 所用 ID 和最终结果之间的关联。
- 先完成 source 或私有准确 consumer 的最小完整链，包未到时不得填 installed PASS。
- 独立修改原 ID、必需集合或摘要，consumer 必须在读取错数据前准确拒绝。
- 验收：一个真实输入驱动一条实际 HTTP 审阅链，提交早期源码、参数和准确未达范围后继续。
- 交接物：A→C 实际运行记录，main 能直接复用，无第二 driver 或 ledger。

## A5 默认 v1 的真实快照出口

- 从同批原数据生成默认 workflow v1，沿真实配方 create/verify，不重贴 v2 标签或改摘要。
- 快照包含该格式支持的实际 families、artifact 与原 subject；unsupported/unknown 明确说明。
- 固定 snapshot 字节、格式、producer source 和原 manifest 的对应，不把当前 live source 替代冻结数据。
- 生产数据与执行批准分开，不能因快照包含旧回答就允许重发或继续旧执行。
- 验收：v1 独立校验通过，缺 family/坏字节/错 ID 有有限拒绝；原状态不被迁移或清空。
- 交接物：准确 v1 subject、字节摘要、创建与验证命令。

## A6 显式 v2 的真实快照出口

- 从相同原数据显式生成 v2，使用该版本完整配方和真实 manifest，不拿 v1 输出改版本号。
- 与 v1 的共同身份和不同 families 都准确保留，不能用数据库相等代替版本验证。
- 两份输出各自独立保存 source/格式/摘要/校验结果，不覆盖历史快照。
- 所需版本能力由真实 package 支持情况决定，不把晚功能缺失归为旧包回归。
- 验收：v2 单独 create/verify 通过，非法版本和缺失数据拒绝；两格式可追溯同批原数据。
- 交接物：准确 v2 subject、与 v1 的对应关系及可运行命令。

## A7 两个新根的真实恢复映射

- 两份快照分别经真实 bundle/restore 到不同新根，不仅复制数据库后手写 marker。
- 恢复记录绑定原 snapshot、目标根、artifact 和逻辑 source；不复制 credential 或可执行授权。
- 为 C 提供可信原根→恢复根映射，验证所读原 ID/摘要仍为该次恢复的原数据。
- logical source 一致不表示物理 writer 已停止；旧 held queue 和未知资源屏障保持。
- 验收：两个 restore 都独立运行，错根/换包/错 artifact 的映射准确拒绝，所有旧状态保留。
- 交接物：两个新根的实际恢复记录与数据读回输入。

## A8 第二里程碑：同包双格式数据链

- 与 C/D 固定一个准确安装包，在该包实际入口分别审阅两个恢复根。
- 同一次 driver 的 manifest 输入关联每个 consumer 返回的候选/history/Work/问答/delivery/原文。
- 核对原 ID、coverage、冻结摘要与 actual consumer，不以 source-only 测试给旧包补能力。
- 业务仍 422、provider 无新增、旧队列不消费；package 缺能力准确分层。
- 验收：两格式分别完成同包实际读取，发布中期源码与完整命令后继续，不等待全产品最终 verdict。
- 交接物：同包双格式、数据与 consumer 字节的准确关联，供 E 独立验证。

## A9 获准 B 接入的持久结果输入

- 只使用 main 已准入的实际 B business attach，保留原登记端点、完整身份和 fresh 写前授权。
- 明确收到的原 command/attempt/session/epoch/question/answer/target 与 A 当前原 subject。
- 接入缺失或未准入时只标对应 `NOT_REACHED`，不造新 sender、receipt-only coordinator 或临时账本。
- A 只负责原持久事实与公开 sink，B 负责 transport/runtime，main 保持授权与应用编排。
- 验收：最小真实 port 可严格编译并能向原 Store 写回正确实际结果，foreign tuple 拒绝。
- 交接物：真实接口调用和角色边界，不能把 inspect/cancel 改名为业务恢复。

## A10 原结果落库与幂等

- 原 Runner 返回结果落回同一 fact/command/attempt/question/answer/delivery，不换 ID 追求成功。
- 同事实重复、重连后迟到 ACK、旧有效 epoch 和不同 session/target 不能造成重复应用。
- `native_applied` 只能由实际返回请求产生；command receipt 存在和 sent 不是收到或静止证明。
- unknown 原样持久化，不能置零、退款、补样或重新生成请求身份。
- 验收：实际正确结果一次落库，重放不增发送/应用次数；错身份与旧结果拒绝且原数据不丢。
- 交接物：原 ID、实际次数、幂等回执和状态变化证据。

## A11 持久窗口与故障读回

- 有限覆盖原意图、written、observed、实际结果和 unknown 窗口，进程故障后由新 Node 读回。
- 同步索引与异步字节继续按已获验 UoW/前后复核规则，不跨 await 持事务。
- 崩溃、缺 artifact、source 变化和 current 变化必须有合法正对照，不能累计坏状态归因多个原因。
- 明确数据恢复、业务重接、物理静止三种不同结果，不由一个 fingerprint 认证全部。
- 验收：每个窗口读回原状态且不重发；无证据时保留 unknown，有限退出并保留诊断材料。
- 交接物：有界故障矩阵、真实 PID、原命令及读回命令。

## A12 第三里程碑：恢复结果可追溯

- 将获准 B 的原结果与同次 A/C 数据流程关联，能从原发送意图追到持久结果和实际 consumer。
- B 依赖未齐可发布已完成的数据故障与清单完整结果，明确恢复业务仍未达，不占用下轮再做旧修补。
- 对同 subject 下的重连重放和不同 subject 混入分别给完整正负证据。
- 不增加执行 lifecycle、动态 DAG、自动接受或任何新预算。
- 验收：发布第三可运行源码，实际完成项能独立复跑；交后继续 API/交接与独立队列。
- 交接物：真实恢复结果或精确依赖阻断，不使用空表/空集合制造 PASS。

## A13 完整可复用数据 API

- 收口 producer/expectation/manifest/reader/恢复映射 API，让消费者不依赖旧 wave 测试文件或固定本机路径。
- 保留已有版本配方与 public ports，明确 schema version、参数、默认值、失败和 unknown 语义。
- 需要真实缺失字段才提最小公开接口，不专为 probe 新增空方法，不引入第二 ledger。
- 新 API 可由 C、main、D/E 的真实消费者严格编译；迁移仅必要时由 A 追加。
- 验收：另一个模块按文档即可调用，不手查内部列，不需改 fixture 才能运行。
- 交接物：正式入口、类型、版本/兼容约束和可运行调用例。

## A14 成本与可迁移输入

- 对真实新增 API 继续限制行数、payload count/bytes、输出大小、分页和子进程生命周期。
- 覆盖普通/临近上限/越界输入，引用已过旧规模证据，不机械扩大全库扫描。
- 源码路径、安装根、状态根、producer 身份和消费入口可参数化，不包含本机私有 key/profile。
- 不为展示或统计全读正文，unknown 不填零；G/F 的观察性输入不能成为执行授权。
- 验收：有界成本、搬迁参数和未知状态准确，严格类型/对应 build 通过。
- 交接物：成本预算、实际计数和跨根运行方法。

## A15 独立验收与文档交付

- 给 E 准确 producer、snapshot、restore、manifest、原 ID、consumer 与 package subject，不能把 source 结果贴到另一包。
- D/E 负责实际 tar/hash/build/schema/ABI/mode 和执行字节绑定；A 不修改 E 断言或 D lifecycle。
- 新运行字节需要冻结后再最终验，docs-only 不要求反复重冻。
- ordinary 只读流程不等待 private/target/试点，未获准业务恢复也不能借此宣布 native 完成。
- 验收：独立消费者能复现已交范围，缺依赖与旧范围保留清楚。
- 交接物：用户数据链指南和完整证据索引，不输出 credential 或可移用批准。

## A16 第四里程碑与最终整包结果

- 状态写 `packages/workflows/reports/wave25-status.json`，逐阶段列 source、command、exit、原 ID、coverage、字节和能力范围。
- 第四可运行结果覆盖稳定数据 API、实际 A→C 组合、两格式同包与已准入 B 的原结果范围。
- source、package、installed、normal、recovered、native、private/target 与 value 分层，不靠轮次/测试数量提高完成度。
- 显式 stage 自有路径并 push 原 `origin` 分支，不推 upstream、不 reset 或清历史。
- 验收：所有承诺结果有实际入口和证据；未达依赖不计完成，goal 仅在整包实际完成后结束。
- 发布后继续独立备选队列，不在检查点停工等待新的小修派发。

## 独立备选队列

- C 未齐：先完成稳定 producer/reader/期望/恢复映射和真实双快照，交精确输入供其接唯一 driver。
- B 未准入：继续清单/数据故障/API/同包读取，不造替代执行器或放松主线授权。
- D/E 新包未到：保留准确旧包范围，完成 source 与实际恢复输入；installed 标未达，不回退旧包缺能力。
- 全程真实 vendor/model/native 调用 0；B 原 cap4 UNKNOWN 不可花，E 原 BLOCKED pilot 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807、全部 state/profile/tar/ledger、旧 dirty 与历史报告；只处理独立证明本轮出生的精确资源。
- A–H 不互改拥有路径；main 保留 contracts/HTTP/UI/授权/根配置，C 单一 consumer，E 独立断言。
