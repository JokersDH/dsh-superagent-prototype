# Agent C：显式项目决定进入新工作上下文的完整治理

日期：2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-c`。
原分支 `codex/g3-assistant-context`；保留原 `pnpm-lock.yaml` 差异、runs、报告与历史。
先读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读 [0083 已交主线](../../docs/rfcs/WP-16/0083-main-registered-port-and-workbench-consumers.md)、[0084 架构复审](../../docs/rfcs/WP-16/0084-wave-33-reviewed-architecture.md)、[0085 完整工程](../../docs/rfcs/WP-16/0085-wave-33-whole-product-program.md)。
保留改动后同步 `origin/main`，固定实际 source；只推 owned 路径到原 origin 分支。

## 整块 Goal 与当前基线

建立或延续一个 goal：交付安全的决定/来源治理、用于新工作的当前决定快照及失效重开完整消费者。
以下三项是连续的真实产品成果，发布早、中、晚 source 后持续联调，不停在 CLI 或一次修补。
无同日截止、工时或 token 承诺；外部依赖只阻对应项，其他独立工程继续。

- 固定起点 `4d096ac2`；unknown coverage 旧 P2 已真实关闭，保持 source/caller/unknown 语义。
- session CLI 确实消费原 HTTP 和原回执，不重做已有 context preview/来源/提案/决定 API。
- 新阻断仍需关闭：context strict TS7016、draft symlink/0644 覆写、invalid expiry 被判 usable。
- main `fc38bf65` 已交0083原端口和 F 工作台消费者，不能继续报告它们只有 helper。
- 本轮核心是显式用户决定如何影响后续新工作，而非自动学习、后台规则推广或新的模型循环。

## 成果一：完整生产治理与安全持久草稿

实施范围：

- 修 `history-coverage.mjs` 的真实类型接口，使原 strict 命令通过，不加 ts-ignore 或降低检查。
- 草稿写入有明确创建/更新政策，NOFOLLOW、普通文件/owner/私有权限和安全替换边界齐全。
- 不跟随 symlink 覆写目标，不把已有0644当0600，不借 mode 参数掩盖既有权限。
- 草稿读取先做有界文件和权限校验，协议/字段/时间合法性明确，invalid/unknown expiry 不可 usable。
- 保留原 request/commandId、来源摘要和项目身份；网络未知提供原 ID 核对，不自动换 ID 重发业务。
- 整理原 record/supersede/revoke、来源失效、历史与当前有效决定的正式治理接口。
- 仅显式确认且当前有效的决定可以被后续上下文选择；模型候选、撤销或推断规则不自动生效。
- `scan_incomplete`、source/caller 限额、缺资料和冲突准确传播，不合成为完整空集合。
- 历史正文及旧 receipt 可审计不代表再次发送、批准或当前执行资格。

实际 consumer：

- 当前 session CLI 和正式 `DecisionGovernance`/context 数据消费者使用同一生产治理语义。
- main 原上下文、提案、决定命令仍是可信入口；C 不复制 HTTP、批准 token 或业务 writer。
- 安全草稿只是可再预览的数据，不能替代原 server-side prepare/send/confirm 检查。

必要正负：

- 正常0600草稿、明确合法更新、当前/过期时间、原回执重放与撤销/替代均有真实对照。
- symlink、已有公开文件、foreign owner、非普通/过大文件、无效时间和协议字段独立拒绝。
- 旧 unknown coverage、source50 截断、caller 小窗口与真实 HTTP 普通 session 场景保持。
- 原严格类型命令及必要相关回归通过，输出无凭据、token、raw prompt 或无关主机路径。

Source 交接：

- 早交治理/草稿/coverage 正式类型和修复 source、真实 consumer、命令 exit 及兼容说明。
- 清楚列已入 main 与仅候选工具，不把 CLI 正常运行当默认 App 已集成或已安装。
- 发布修复后继续成果二，不因三个旧阻断关闭就结束整块 goal。

## 成果二：新工作可消费的当前决定快照

实施范围：

- 复用 DecisionContextProvider/ContextBuilder 职责，不创建第二套同名框架或决定权限层。
- 当前实际入口是 `decisionContextProvider`、`ContextComposer` 与 main `ProductContextPreview`。
- 优先沿 `packages/knowledge/src/context-provider.ts` 和现有 composer ports 做最小兼容扩展。
- 将显式项目决定投影为有界、可验证的当前 scope/version 快照，供 main 的新工作上下文使用。
- 快照带原 decisionId/version、项目/适用 scope、原来源身份/摘要、有效性和捕获时间/协议身份。
- 保留当前有效性来源和 caller/source coverage；不能把一个 hash 当权限或完整性授权。
- 显式选择、预览与创建之间重核 source、version、Scope、expiry、撤销/替代及当前配置。
- 复用原 provider 的有效性扫描和 composer 前后复核，未完成扫描拒绝或明确不可用。
- 新工作冻结的是当时确认的来源/version，不在 active Work 上悄悄重写上下文或合同。
- main 掌原表单确认、委托 schema、Work/contract/criteria、最终写前 guard 和公开 wire。
- C 交稳定 typed snapshot/consumer，跨 shared contract 的需求交 main，不自行扩原命令 payload。
- 决定内容始终是受限来源数据，不扩大工具/文件/网络 scope，不把自然语言变执行批准。

实际 consumer：

- main 兼容消费者使用原真实项目、原表单/确认和原 Work 创建路径读取所选决定快照。
- 同一新 Work 可追溯使用的决定 ID/version/来源摘要，F/A/E 能读取其真实冻结引用。
- 保留现有主对话 context/提案/决定消费；不让终端 CLI 成为唯一可用入口。
- 先交可编译真实调用及最小主线接线需求，main 持续组合，不等整枝全部完成才消费。

必要正负：

- 两项目各有显式有效决定，新工作使用正确 scope/version；无选择时原普通委托仍可用。
- 创建前决定更新、source 变化、撤销、supersede、过期和错项目使旧预览失效或要求重预览。
- history/candidate/testing/shadow 规则零自动进入；缺/未知 version 或扫描不完整不能伪装当前。
- 真实原 Work/冻结上下文引用可读，原批准、机器 FAIL 与人工接受行为不被投影改变。

Source 交接：

- 中期交 provider/composer 最小依赖闭包、snapshot 类型、真实 main 兼容 consumer 和原对象证据。
- 写明 main 自有表单/HTTP/schema 的最小需求，不能复制一个新 NewWorkForm 或创建 pipeline。
- source 发布后继续失效/重开，不以一份 snapshot JSON 或纯选择函数当完整成果。

## 成果三：失效、普通重开与原来源完整体验

实施范围：

- 让来源预览、显式提案确认/拒绝、记录/替代/撤销决定、新工作上下文和历史审计连续可用。
- 复用原 IDs、冻结 bytes 与原 receipt，跨关闭重开能查看当时来源及其现在为何失效。
- 决定撤回阻止未来新选择，不重写已冻结历史；运行中工作影响交 main 原修订/停止流程。
- 草稿重开后重新检验当前项目/配置/source/version，旧 request 或过期数据不等确认 token。
- 两项目/多会话、readonly、旧后端、源缺失、unknown response 和迟到结果有一致可恢复语义。
- 新历史 continuation 由 A 提供，C 保留上游 source/caller coverage，不复制 SQL 或新 ledger。
- F 获得纯 DTO/状态/回调约定，main 保留实际 App/transport/root/global CSS 和权限副作用。
- 普通主线工程不等 B/private/blocked pilot；相应 native/recovered 层未达准确保留。

实际 consumer：

- 一个实际 main 兼容普通 session/work 流从决定选择走到新 Work 上下文，再重开审阅原来源。
- 原项目/决定/Work/contract/version/sourceDigest 对应同一批数据，不把孤立 PASS 拼成整链。
- E 的独立产品断言另行核对，C 提供原始材料，不自授 installed/release/native 准入。

必要正负：

- 正常选择/确认/原 ID 重开、两项目隔离、冻结正文与历史版本一致，必要 source bytes 可核对。
- 原 receipt 重放不复活已撤销/替代决定，不重复发模型任务或接受候选。
- 非当前/缺版本/越 scope/失效 source/坏文件和 unknown 明确拒绝或保留，不能降为完整空历史。
- 相关 strict/受控实际 consumer 与指南齐全，真实 vendor/native/长期运行和收益未测不补通过。

Source 交接：

- 后期交完整 API/consumer/版本与失效规则、原 IDs/摘要/命令 exit、可操作普通使用指南。
- 状态写 `packages/context/reports/wave33-status.json`，保留失败及 main/source/安装/native 的准确层级。
- 继续同一 goal 的联调/兼容/文档，不以 report complete 代替实际默认产品消费者。

## 独立备选队列

- main schema/原表单 wire 未到：早交 typed snapshot、真实决定/来源输入，继续治理/失效/兼容。
- A continuation 未到：保留真实 truncated/unknown，继续上下文/决定/草稿，不造替代 SQL。
- F 页面未接：提供稳定 DTO 和原状态例，继续原 main HTTP/数据消费者，不建第二 UI。
- 研究或 B/private 受阻只阻对应层，不停止普通新工作上下文工程，也不伪造 native 结果。

## Whole Goal 完成条件与边界

- 三成果均有生产实现、actual consumer、必要正负与 source 交接，并被 main 集成版本真实消费。
- owned 仅 `packages/context/`、`packages/proposals/`、`packages/knowledge/`、`packages/routing/`。
- main 拥有 shared/root/contracts/lock/HTTP/App/transport/授权；A 唯一生产 SQL/迁移，E 独占产品断言。
- 自动真实 vendor/model/native0，旧 B cap4 UNKNOWN/E blocked pilot 不 reset/topup/refund/补样或价格研究。
- 保留十二服务与全部 state/profile/tar/ledger/dirty/runs；仅独立 birth/full 资源且每次 fresh 可受信号。
- 无全局发现、借凭据、真实 CLI 回退、新 Driver/CAC/桌面/自动接受/第二 ledger 或生命周期。
- 当前是完整工程持续集成，CAC排除，不做临时包装冲刺，不新建 checkout 或派工线程。
