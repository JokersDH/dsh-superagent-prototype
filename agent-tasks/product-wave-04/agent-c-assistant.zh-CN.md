# Agent C：有来源的助理能力与原子提案决定

主线后续已消费A/C并做实际SQLite联调，补充修复见 [C接线补充](c-integration-followup.zh-CN.md)。三项原准入已通过；当前先闭合真实存储决定重放及决定同步commit入口，不重复旧整包。

沿用 C 目录/分支，拥有 context/proposals/knowledge。旧 `2441281` 已集成模块，53 项包内测试保留范围，生产能力未开启。先读本轮 README、0016 和 shared assistant-state。目标是交 main 能直接接线的真实存储消费者，减少只在内存 fixture 里完成的模块。

## C1 修复三个准入失败

主线命令 `node tools/bootstrap/review-wave04-admission.mjs`（先 build proposals/knowledge）当前三项 FAIL：

1. 来源 missing 后 isEffective/listEffective 仍返回决定。检查来源存在、trusted_user provenance、原 project/conversation/textDigest 等当前性；missing/stale 保留审计投影但不进入有效上下文。不能用“列表只查状态”绕开有效性。
2. confirmed 提案重放在 actor 检查前直接返回 intent。无论 pending/confirmed 都先核对调用者、原来源、当前 grant/合同/有效期/作用域。未授权 actor 不能取得业务 intent；主线命令同 ID replay 可以返回其先前回执，不代表新的确认可绕过授权。
3. create 保存调用者的 grant.scope 引用，原调用者随后可修改已审阅范围。输入/输出保持独立不可变快照；深层数组、get/list 返回对象同样不能改内部记录。

补足针对每个失败的回归和原始反例，交早期检查点，继续 C2–C5。

## C2 对齐 A 的持久同步状态

采用 `AssistantStatePort`、`PersistedDecision/Proposal`（contracts 唯一来源），包内 adapter 把 A 同步 port 映射到领域规则；不建 SQL、第二 DB 或任意 JSON 事实表。A 提交前可用同 port 的内存 fixture，主线不会把 fixture 开启为生产。

明确 prepare/commit 分工：async prepare 只做有界读/解析与来源快照，不写决定/提案确认或触发效果；sync commit 在 main 外层 UnitOfWork 内重新检查 actor、来源 digest、grant、scope、合同、状态版本及资源条件，调用 A port 写记录。main 同事务写确定性命令/回执/事件/队列。任何失败不留下“已确认但未执行”或“执行成功但提案仍可重做”。

提案状态变化版本递增并 CAS；确认后 effectCommandId 只能来自同事务的 main，不能从模型提供。命令重放不重复执行；确认过、过期、撤销、被替代状态不产生第二效果。revision 提案缺完整新合同输入时返回明确待用户补充，不从 rationale 猜出可执行授权。

## C3 持久上下文消费者与授权预览

用 A 工作/检查/交付/来源索引实现 ContextReadPort adapter；来源、内容摘要、baseline 和当前性可重验。默认元数据，不隐式全仓上传；源码/文档仅在 main 发出绑定 conversation/project/文件或范围/预算/用途/到期的确认后读取。executor grant 不等于对话 provider 上传许可。

给主线 preview/confirm 所需的摘要、选中文件列表、字节/token估计、遗漏理由、源变化状态；provider 失败仍保留上下文授权与输入身份，不自动扩大预算。项目/合同变化、权限/来源消失、token上限、注入/秘密/路径逃逸负例继续严格执行。

决定有效性读必须以当前来源为准，不仅初次record时检查。普通目标修订和环境补救不自动升级长期规则；自动学习/推广关闭。

## C4 完整零模型纵向

真实临时 SQLite A adapter → 来源消息 → 授权上下文 → 现有 provider 的结构化 mock 输出 → pending 持久提案 → 显式确认/拒绝 → 同事务命令回执 → 决定记录 → 重启读取 → 撤销/源失效后不再生效。

模拟 crash/commit failure、重复确认、同 ID 改载荷、另 actor、另会话/项目、旧合同/授权到期、supersession、state reload。provider 只能产生 shared ReasonerProposal，普通 Markdown/JSON-looking prose 不能执行。模型/网络调用 0。

## C5 主线接线说明和持续交付

输出可复制的 adapter/prepare/commit 消费例、导出签名、公共缺口 RFC 和源码/命令结果，main 负责 HTTP/provider/UI，不直接改这些目录。A port 到达后复验同一消费者，不以旧in-memory报告作真实持久通过。

声明哪些属于包内、真实持久、产品HTTP已接通和未测；无需等主线页面完成才交源码。全阶段完成或只剩不能独立消除的外部依赖后交接。
