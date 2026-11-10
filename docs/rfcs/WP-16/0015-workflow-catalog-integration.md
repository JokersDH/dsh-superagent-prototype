# 主线：会话目录接线与 A–E 候选复核

日期：2026-11-10；基线 `3319a43`。本批消费 A/C 的已提交源码，保留五个外部 Agent 的工作目录与未提交修改。包内通过、主线产品接通、独立原生准入分别记录，不以一张 final 报告宣布整轮完成。

## 已接通的产品能力

网页侧栏现在读取持久会话目录，支持有界搜索、分页、新建、CAS 重命名、归档/取消归档、历史切换与刷新后找回。当前会话名进入对话标题；首次用户消息可为占位“新对话”命名，之后显式名称不会被覆盖。草稿按会话保留在当前页面内存，切换对话不串草稿；不将草稿或凭据写入浏览器持久存储。

归档只改变目录可见性，不停止工作、不删除消息。有活跃 core Ticket、未确认结束的 writer 或开放问题的会话即使归档也保留在默认目录，并显示待办提示；目录提示不能当作原生权限、问题有效性或完成证据。

主线发现 A 的 v7 纯聊天回填会出现 catalog.projectId=null，且一个对话实际可能含多个项目。组合层通过公开消息分页检查全部来源项目，兼容旧记录，并在返回标题、搜索命中或允许改名/归档前核对全部项目均在当前配置中。空配置永不退成全局可见。检查每请求最多 10,000 条消息，并缓存至多 512 个会话的 sequence/membership；超额明确拒绝，不猜可见性。

内部目录发现可能经过未授权项目，但公共分页 cursor 使用 AES-256-GCM，不透出被过滤条目的 ID/时间，且绑定项目授权集合、搜索、项目筛选及归档条件；更换查询或授权后不能重用旧 cursor。分页过滤后可能出现不足一页或空页，hasMore/nextCursor 仍指向下一批候选，不静默丢掉后续页。

## 公共接口

新增 companion resource `conversation-catalog/1`，不改变冻结 Runner/data wire。定义在 `packages/contracts/src/conversations.ts`，生成 schema/manifest 在同包 generated 下。

| 入口 | 输入/输出 | 规则 |
| --- | --- | --- |
| GET `/v1/conversations` | ConversationCatalogQuery → ConversationCatalog | projectId/query/includeArchived/limit/cursor；limit≤50；未知字段拒绝；认证读取 |
| GET `/v1/conversations/:id` | ConversationSummary | 检查全部来源项目；未知/越权统一拒绝；无任意 query |
| POST `/v1/conversations/commands` | ConversationCommand → CommandReceipt | create_conversation / rename_conversation / archive_conversation；actor 由认证入口生成 |
| product.read.conversations / conversation | 上述读取 DTO | 使用 ApplicationConversations 和存储公开 port，不创建 SQL writer |
| product.operations.conversation | command + TrustedActor | 同一外层事务写目录、事件和幂等回执；CAS 冲突与同 ID 改载荷明确拒绝 |

HTTP 创建输入示例：

```json
{"kind":"create_conversation","commandId":"unique-command-id","conversationId":"unique-conversation-id","projectId":"configured-project-id","title":"新对话"}
```

重命名携带当前 summary.titleRevision 对应的 expectedTitleRevision；归档携带 archiveRevision 对应的 expectedArchiveRevision。业务拒绝是持久 rejected receipt；认证、非法字段、非法 query、冲突复用等沿用 AppError。旧后端缺少 companion resource 时 UI 隐藏目录，保留既有对话与工作能力。

## 候选和实测范围

| Agent | 本次复核的已提交候选 | 主线结论 |
| --- | --- | --- |
| A | c3e007b / 9174c61 / c74f2c6 | 已集成 storage/workflows；75 项 storage、9 项 workflows 通过；会话产品纵向已接通。项目设置与决定/快照仍按后续组合准入 |
| B | 42667e7（B3） | 看到 B1–B3 提交；旧 execution-status 仍混有历史批次信息，本批不据此宣称原生控制/恢复通过；未改或合入 B 正在推进的 Runtime 源码 |
| C | c3046c9 / 4dbfc5f / 82d6a36 / 2441281 | 源码已集成供消费；29+10+14 包内测试通过；独立来源有效性 probe FAIL，生产上下文/决定仍不接线 |
| D | 84d407f（D3） | D1–D3 有提交，D4/D5 尚在继续；发行/迁移未准入。A 的 readArtifactRegistry / WorkflowSnapshots 已随本批进入 main，可替代临时 SQL |
| E | 835d663（E1）及其工作区后续未提交验收 | 看到产品/浏览器/有界稳定性运行证据，但源码仍 dirty，本批不把未提交验收纳入发布权威；不改 E 的用例 |

根锁已由主线生成 context/proposals/knowledge/workflows 四个 importer，未新增外部版本或改其它 Agent 锁文件。verification 的旧“当前 schema 必须是 7”断言改为“至少 7 且等于注册表末尾”，旧迁移校验仍保留；23 项验证模块测试通过。

## C 的明确准入失败与后续接口

执行 `node tools/bootstrap/review-assistant-domain.mjs` 可得到独立最小复现：记录一个合法、明确、同项目决定 → 将来源消息标记 missing → isEffective 仍为 true，listEffective 仍返回 1 条。期望审计记录保留，但有效上下文采用 false/0。该 probe 以非零退出；证据在 `reports/releases/conversation-catalog/assistant-domain-admission.json`。这不是 native 或模型测试，调用模型 0 次。

C 下一步先修复有效决定对来源存在性/项目/可信 provenance 的检查，保留 missing 的审计投影，并补复现回归。随后与 A 对齐 DecisionStorePort：A 当前 ledger 保存 frozen UserDecision/createdAt/digest，C 还需要 sourceMessageId/actorRef/recordedAt 等元数据。不要把这些信息偷偷丢进 content、推成 inferred preference 或建第二 DB。

C 的 async governance 与主线同步 SQLite 命令外层事务也需一个可消费的 prepare/commit 约定：先做有界只读准备，再在主线事务内重验来源/授权版本并经 A 的同步 port 写决定和回执。禁止在 UnitOfWork callback 中 await，或先写决定再补命令回执。主线继续负责命令、HTTP、provider 和 UI 组合。

A 后续可提供索引化的会话项目成员/活跃工作提示 port，替代本批保守的有界扫描；优化必须保留纯聊天历史、混合项目、空授权和分页边界。项目设置只作用于新授权，不能修改在途合同。

## 验证与限制

本批应用 16、认证 HTTP 15、受控产品 19、契约 194、前端 15、验证模块 23 项，以及 A/C 模块上述范围通过；产品/前端 typecheck 与显式 HTTP build 通过。四项新浏览器闭环覆盖目录/草稿、搜索/重命名重开、归档与待办、新建持久化与手机导航。初次浏览器工具在异步新建 API 返回前读取 URL，已修正为等待实际导航，没有修改产品断言。截图属于新目录功能状态核对，没有重做既有视觉方向。

命令：`pnpm check:conversation-catalog`，加 `--no-capture` 可复验而不覆盖截图。全部使用隔离 state/临时端口，模型调用 0；现有 5180/5181 用户服务保持运行，后端新能力在下次正常重启后生效。不是完整 G2/G3、内部发行或 CAC 通过。
