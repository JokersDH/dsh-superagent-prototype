# Agent A：完整原身份数据清单与真实双版本交付整包

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-a`，分支 `codex/g2-workspaces-verification`。
仅修改 `packages/storage/` 与 `packages/workflows/`；生产 SQL 和追加迁移仍由 A 唯一拥有。
先读根 `START-HERE.zh-CN.md`、`product-spec/README.md`、[本轮 README](README.zh-CN.md)、[0062](../../docs/rfcs/WP-16/0062-source-scope-diagnostics-ui.md) 与 [0063](../../docs/rfcs/WP-16/0063-wave-24-admission-and-product-closure.md)。
fetch 并合并最新 `origin/main`，按当前 `AGENTS.md` 使用主线真实来源诊断 UI、CLI help 和既有 launcher/portability 源码；不等待新派工才能消费已发布接口。
保留 A `1b2ef61` 不同 Node PID 读回原事实 1/1 的成果，不再重派同进程重开问题，也不将它外推为业务恢复或物理静止。

本包覆盖三个连续结果：可信原 subject 清单 → A 真实 producer/reader 接 C 唯一 driver → 获准 B 原结果落库及同包双快照恢复审阅。
建立或延续完整结果包 goal，不设 token 预算；早期、中期、最终三个可运行源码里程碑交后继续独立阶段。
跨 owner 输入未准入只阻对应结论，准确标 `NOT_REACHED`，不以替代 fixture、空字段或新账本制造完成。
所有清单与读取结果都是数据，不授重发、恢复启动、原生执行、人工接受或发布权限。

## A1 固定原 subject 与独立期望

- 收口新 manifest 的信任边界：期望 subject 来自真实 producer/既有可信调用，不从待验证 manifest 自己推导全部输入。
- 保留原 Work、Ticket、Assignment、attempt、contract revision/digest、epoch、session 及 question/answer/target 的关系。
- 在已有 ports 核对 question targets、answer delivery 与所选 attempt 的完整关联，不只分别检查 attempt→ticket 和 answer→question。
- 覆盖同 Store 两个真实 Work/Broker 流程，保留真实 `native_applied` 正对照，唯一换入另一个 question/answer/command 时拒绝。
- 验收：上轮跨 attempt 混入反例真正失败，当前原 subject 通过；输出准确原因，不修改主线授权或从显示状态反推批准。
- 交接物：可信期望输入 contract、公开关系核验配方、原 ID 和两 Work 反例命令。

## A2 必需集合与 coverage 闭包

- 清单绑定原命令、dispatch、问题目标、观测、payload 与 delivery 的必需集合；集合来自原 producer/事实关联的独立期望。
- 每个集合明确 complete、partial 或 unknown；缺必需项、重复项、foreign 项和错误关联不能归一化为空成功。
- 删除 commands/dispatch 后重算普通摘要仍必须被期望集合拒绝，不以“摘要一致”代替“原事实完整”。
- 显式子集用途可以保留，但其 scope/coverage 必须与完整原 subject 验证分开，不能解锁后续完整恢复结论。
- 验收：合法完整集合通过，删一项、全部删空、加 foreign 项和重复 ID 各独立拒绝；unknown 不转零或被补造记录覆盖。
- 交接物：各集合的来源、闭包规则、coverage 输出和有限正负矩阵，不引入第二 ledger 或确认权威。

## A3 UoW、一致性与第一里程碑

- 在同步 UoW 取得相互关联的索引和版本快照；异步 payload bytes 在事务外读取，禁止跨 await 持数据库事务。
- 读取前后用既有逻辑 source/current/version 事实复核；payload、合同、current、集合或 coverage 变化时拒绝或有限重读。
- 主动覆盖 async payload 读取期间发生的合法状态变化，禁止把早期 binding 与晚期 sourceFingerprint 拼成稳定清单。
- 区分逻辑快照一致、writer 运行、writer 已退出和物理资源静止；清单一致不等于具备物理停止证明。
- 验收：稳定数据跨进程通过，受控单变量变化导致准确拒绝，事务不跨 await；提交早期可运行源码后继续整包。
- 交接物：UoW 边界、复核字段、重试上限和真实 PID/状态记录，明确未测并发范围。

## A4 有界 reader 与数据完整性

- 对输入 ID、集合条数、观测、独立 payload 数、累计 bytes、分页、清单输出及子进程时长设置明确上限。
- 超过上限拒绝或输出明确 partial/unknown；禁止不受限地枚举全部 observations、读取全部正文或忽略不完整 source coverage。
- source SHA、格式、原数据根、payload 摘要从实际调用和字节核对；测试虚拟 SHA 不标成真实 producer 来源证明。
- 损坏/缺失 payload、相同 ref 不同摘要、未知版本、错误根、不可读 family 与坏输入都在真实边界处理。
- 验收：正常最小和接近上限输入通过，边界外有限拒绝，bytes/次数可观察；严格类型和对应 build 通过。
- 交接物：默认上限、实际读取成本和拒绝原因，不为填展示数字扫描全库。

## A5 单一真实 producer 与分进程 reader

- 将已通过的独立 Node reader 扩为可直接运行的 producer/reader 数据入口，供 B/main/C/D/E 消费，不要求手工改测试源码。
- 原公开应用与 Broker 路径生成 Work、问答和结果；SDK/context/候选与确认回执保持在同 Store，不手写业务终态 SQL。
- 分别记录原意图、written、实际 observed、结果与 unknown；合成传输窗口不能冒充实际原生发送。
- producer/reader 输入包含真实 source、格式、原 subject、数据根和独立期望；输出不包含 credential 或可移用批准。
- 验收：另一个 Node PID 从原 ID 读回同一清单，重复读取不增加发送、事实、delivery 或队列消费。
- 交接物：一个可参数化数据入口、独立 reader 命令、manifest/expectation schema 与实际样例。

## A6 真正接入 C 唯一 driver

- A 只提供 producer、独立 reader、数据 manifest 和期望；C 继续拥有唯一 consumer driver，不再并列另一套审阅判断。
- C 的真实流程必须读取 A 的实际输出，核对原 ID、集合 coverage、摘要和期望，不只是文档称“可接入”。
- 与 C 明确 source root 到恢复 root 的合法映射：搬迁来自真实 snapshot/restore 证据，不能手改 manifest.dataRoot 后自称来源一致。
- 旧快照 v1 与显式 v2 保持独立配方；personal-evidence/bundle 不与 workflow snapshot/evidence 混用版本。
- 验收：A 输出直接驱动 C 的真实 source 流程，唯一 foreign ID、删项或错误恢复根准确拒绝；提交中期源码后继续。
- 交接物：A→C 真实调用记录、同一批原 ID 的数据映射和未准入 package/B 范围。

## A7 获准 B 原身份结果落库

- 只消费 main 准入的 B 实际 business attach、原登记端点与当前写前授权，不凭新源码、inspect/cancel 或状态字符串宣布恢复。
- 新协调器接原 Runner 后，结果写回原 Store、原 fact/command/attempt/question/answer/delivery，保持唯一执行生命周期。
- 覆盖重复事实、迟到 ACK、旧有效 epoch、不同 session/target 和中断重入；实际未知结果保留 unknown，不换 ID 补发。
- 原 command receipt 存在不表示 native 已收到，sent 不表示 quiescence；只有真实返回结果可成为 `native_applied`。
- 验收：原 ID 上的结果幂等落库，重复重连不重复发送；依赖未准入只标该阶段 `NOT_REACHED`，其余阶段继续。
- 交接物：实际 A sink/Broker 调用契约、原结果关联、重复/foreign 拒绝与原账本保持证据。

## A8 两份真实独立快照与第二根

- 从同一批真实同 Store 数据分别生成默认 v1 与显式 v2 快照，实际校验后分别恢复到全新第二状态根。
- 两个输出各自记录 producer、格式、数据库/artifact 摘要与恢复行为，不仅复制库后改 marker 或重贴版本标签。
- 不复制旧 credential、活动连接、可执行批准或未知 writer 结论；只读历史状态与新的空执行目标是不同能力。
- 经 C 的实际入口读取候选、history、Work、问答、delivery、冻结原文；缩小 Scope 后正文按原 main gate 隐藏。
- 验收：两份独立恢复都能对回同一原数据 manifest，业务 422、provider 无增、旧队列不消费，快照 subject 分别准确。
- 交接物：两个格式各自 create/verify/restore/consumer 命令与完整字节/原身份链。

## A9 准确安装包消费与独立验收输入

- 与 D/C 使用明确安装根和实际包内入口，不借 checkout 的 reader、review、start 或 demo 补齐旧包能力。
- 给 E 原 producer、清单、恢复映射、原 ID、格式和期望结果；consumer 字节、tar/hash/build/schema/ABI/mode 由 D/E 独立绑定。
- 缺入口、缺新诊断或不支持格式时准确分层，保留旧包已获验范围，不把后续功能缺失当历史回归。
- 普通个人安装/只读审阅不等待 B/private/target/试点，但没有 B 实际结果不能宣称业务恢复。
- 验收：至少一个准确包可消费同数据流程或给出准确外部阻断；不使用 source-only 结果认证 installed。
- 交接物：D/E 可直接运行的数据交接包、所需文件清单及 source/package/normal/recovered 的分层结论。

## A10 最终源码与持续 goal

- 第三个可运行里程碑交原 subject 完整清单、A→C 真实消费、双格式独立恢复，以及已准入 B 原结果落库的实际范围。
- 状态写 `packages/workflows/reports/wave24-status.json`，逐阶段列 source、command、exit、原 ID、coverage、字节、实际 consumer 和未达项。
- 仅新增风险做严格类型、build、有限进程/数据回归；引用已过旧范围，不靠测试数量或静态 PASS 提高完成度。
- 迁移只追加、A 唯一拥有；不创建新 ledger、签名授权、第二生命周期或专门满足旧 probe 的空方法。
- 显式 stage 自有路径并推原 `origin` 分支，禁止 upstream/reset/清历史；检查点提交后继续独立队列。
- 只有整包已承诺结果实际完成才结束 goal；完整原数据、包内读取、业务恢复、native 和发布准入分别说明。

## 独立备选队列

- B 未准入：先完成 subject/coverage/UoW/成本、真实 producer/reader、A→C 消费及两独立快照恢复，不造替代 sender。
- C package 未齐：交真实 source 流程和准确包参数；package `NOT_REACHED` 保持，独立继续 reader/并发变化/清单负例。
- D/E 新字节未到：保留已有准确包范围，准备实际包内数据清单和恢复输入，不为 docs-only 更新要求重冻。
- 全程真实 vendor/model/native 调用 0；B 原 cap4 UNKNOWN 不可花，E 原 BLOCKED pilot 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807、全部 state/profile/tar/ledger、旧 dirty 和所有报告；只处理独立证明本轮 probe 出生的精确资源。
- 不新增 Driver、CAC、桌面壳、自动接受或动态 DAG；main 拥有 HTTP/UI/授权，C 拥有 consumer，E 拥有独立验收断言。
