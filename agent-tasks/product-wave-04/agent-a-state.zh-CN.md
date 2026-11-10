# Agent A：来源持久化、提案事务与工作流索引

沿用 A 目录/分支，拥有 storage/workflows 和唯一生产迁移。先读本轮 README、0016 与主线现有 `packages/contracts/src/assistant-state.ts`。审计输入 `c74f2c6` 已集成；不重复移植旧包。目标是让 C/main 在同一数据库、同一命令事务内完成助理操作，并缩小会话扫描成本。

## A1 AssistantStatePort 稳定持久检查点

实现主线定义的 `AssistantStatePort`、`PersistedDecisionSchema`、`PersistedProposalSchema`，导出 `createWorkflowPorts(store).assistant`（旧导出兼容）。所有方法同步、加入现有 UnitOfWork，不开第二 writer。缺字段向 main 提 RFC，不复制另一份公共形状。

只追加 v11+ 迁移，不改 v1–v10。旧 UserDecision 版本保留；没有来源元数据的旧行明确 legacy/missing，不伪造 sourceMessageId/actor/已确认状态，不自动进入有效记忆。可用附加元数据表与原 ledger 组合，不能制造第二个独立决定权威。

`put(record,expectedVersion)`：0 创建 version1；之后严格 CAS +1；相同版本完整 body 重放幂等，来源/actor/digest/合同/内容变更冲突。决定正文/范围/来源只可用新 ID 替代；撤销保留来源并追加版本。提案确认只引用主线同事务命令 ID，不执行命令。

验收：真实 SQLite 的创建/重放/改载荷/旧版本/跨项目/撤销/替代索引/重开；持久 record 与命令回执/事件/队列同事务，在任一点注入失败全部回滚。交首个源码检查点后继续 A2–A5。

## A2 索引化会话成员与待办

提供项目成员读取/作用域目录 port，能覆盖 v7 纯聊天、一个对话多个项目、无项目消息、work 无消息，以及新消息改变成员。空授权列表永不读全部；内部 all-discovery 若需要必须独立命名，不能复用空数组当全局许可。

目录分页/搜索/归档不能漏掉后续候选；明确区分候选页和可见页。活跃/历史 core/绑定信息作为保守 attention，不把开放问题表的一行当原生当前性证明。提供主线可消费的成员摘要和更新版本，避免每页扫描一万条消息。保持现有公共会话 HTTP DTO 由 main 投影，不改 console。

验收：v7→新版本真实迁移、混合项目、授权缩小、改名后搜索、归档带活跃/已停止/旧问题、并发消息/CAS/分页、长中文与有界查询。保存固定 seed 与可复现性能测量；不要求任意硬件相同毫秒数。

## A3 C 的上下文读索引消费者

通过 workflows 公开 port 给出元数据/当前 work/合同/验证/交付/决定来源和内容身份；C 负责映射 ContextReadPort，不让它直查 SQL。metadata 缺失返回 missing；已注册 artifact 不自动属于某 work，只有可信候选/验证关联才返回。

提供 source message 的同步只读元数据（role/provenance/project/conversation/sequence/textDigest），用于 main/C 事务重验。读 API 不授予源码上传、项目执行或 native 权限。过大内容给分页/引用，不把所有历史灌入模型。

## A4 一致快照与资源读取

让 D 消费公开 readArtifactRegistry/WorkflowSnapshots 与只读 state/instance facts，移除其临时私有 SQL 的需求。当前 writer/lock/queue facts 用于拒绝未知状态；普通行/PID 不生成可信停止证明。快照读取所复制 DB 的引用清单，再逐字节校验产物。

增加至少一个带完成交付/patch/引用产物、一个带 queued/parked/question 的快照消费者；缺文件/坏摘要/写入中一致性/IO 失败要明确 blocked。恢复/回滚策略在 D/main，不在存储初始化自动重放业务。

## A5 交完整消费者与迁移证明

C port 到达后以主线公开 AssistantStatePort 跑记录→提案确认→后续有效读取→撤销→重开纵向；未到先用同形 fixture。保存 v10 旧决定/在途合同升级证据；新项目设置不改老合同/检查/环境身份。

交 package tests/build/typecheck、旧 storage/application/verification 回归范围、v10→新版本、失败回滚和第二 Node 进程消费者。保持自己的旧证据和 root lock 临时差异，只有 main 提交权威锁。全包只用临时 state，模型预算 0。
