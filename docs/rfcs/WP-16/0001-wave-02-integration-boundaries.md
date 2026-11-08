# 第二轮集成边界与接口约定

日期：2026-11-08。状态：**本轮实施约定，接口代码待对应 owner 提交**。它不改变 contracts v1/hash，也不把下列方法/HTTP 视为已实现。任务入口见 [整包排程](../../../agent-tasks/wave-02/README.zh-CN.md)。

## 1. 数据与身份来源

| 权威 | Owner | 使用方式 |
| --- | --- | --- |
| wire schema/生成类型 | 主 Agent | 现有 contracts v1 为唯一来源；新增 wire 语义必须经主线版本化 |
| Ticket/Assignment/candidate | 主 Agent/core | 所有执行转换与完成 gate 仍在 core |
| 产品 SQLite/迁移 | A | 所有产品 repo 同连接、同步事务；主/B 通过 port 调用 |
| Runner/native/journal | B | per-attempt 独立宿主，关键事实走可信 FactSink；不写产品 DB |
| trusted actor/问题语义/应用路由 | 主 Agent | HTTP 认证后产生 actor；worker/浏览器/model 不能自行声明 human |
| UI | A | 消费投影与可用动作，只提交结构化 UserCommand |

一条用户命令应能在同一事务接受 core/产品记录、receipt/event/effect。所有文件/网络 I/O 在外层事务之外。queue 中的 payload 必须是 JSON，不直接写裸引用。

## 2. A 需要提供的产品 Repository

在 storage 内增加与现有 `domain` 并列的产品记录集合，例如 `store.product`。下表的方法名是本轮默认接口；如果已有更合适的本地命名，检查点提供一次薄适配和导出表即可，不为命名停工。

| 集合 | 最小操作 | 数据与约束 |
| --- | --- | --- |
| works | insert/get/listByProject | frozen WorkRecord；稳定 ID/project/conversation；同 ID 不同正文冲突 |
| contracts | append/getByRef/history | frozen ContractRevision；完整 ref、不改旧版本；append 不自动改变 authority |
| links | attach/listByWork | frozen TicketLink；合同/Ticket 已知，幂等和主链接唯一性；不创建 Ticket 生命周期 |
| messages | append/getById/page | frozen ConversationMessage/ConversationPage；append 在事务内分配持久 sequence；相同消息重放保留原顺序；before 为排他分页 |
| questions | insert/get/listOpen/replaceExpected | frozen UserQuestion；CAS 至少校验 version 和 validity；Broker 负责问答/过期/target 语义 |
| dispatchControls | get/compareAndSet | `{paused, revision}`；只是人工派工开关，不是 Work phase |

这些是内部 repository 操作，不是新的 wire 类型。复用 shared runtime schema 验证最终记录；允许 append 输入采用 `Omit<ConversationMessage, 'sequence'>` 等派生内部类型。列表有界、查询顺序明确、完整正文幂等/冲突明确。新增表只为这些已明确消费者的记录服务，不先建通用实体引擎或重复 Project 系统。

existing `authority` 是当前授权来源，不用 contracts.maxRevision 隐式授予权限。existing `answers`/deliveries、commands、events、queue、payloads、bindings/observations 继续复用。修正实际状态单调/唯一约束，不能因为已有类名就假定业务约束已经齐全。

A 检查点须包括：导出 TypeScript API、每个方法事务/冲突/排序语义、真实 SQLite 原子失败用例、迁移升级/重开例子。主/B 有新增数据需求集中列入自己的 RFC，不私建表。

## 3. UI 与应用 Transport

已冻结边界：`ApplicationService.dispatch(UserCommand, TrustedActor)`、`inspect(InspectQuery)`、`changes(after)`；实际定义在 `packages/contracts/src/ports.ts`。Actor 参数属于后端，浏览器的本地 adapter 只提供 `dispatch(UserCommand)`。

首批 HTTP 使用产品规格已有路径：

| 路径 | 请求/响应的唯一来源 |
| --- | --- |
| POST /v1/commands | UserCommand -> CommandReceipt；同 ID 同正文重试返回原回执 |
| GET /v1/snapshot | InspectQuery -> Snapshot；同一读取视图的 cursor |
| GET /v1/conversations/:id/messages | ConversationPage；before/limit 与 schema 对齐 |
| GET /v1/events?after=SEQ | SSE Change，id 为持久 seq，支持 Last-Event-ID；过期返回 cursor_expired |
| GET /v1/artifacts/:id | 允许引用的产物内容/流；不是任意本机路径下载 |

错误以实际 AppError 的 `code/message/retry/evidenceRef` 表达，拒绝命令使用 rejected CommandReceipt。HTTP status/SSE 过期 envelope 和认证方式在主线 transport 检查点一次提交，A 先按相同 schema 的 adapter 完成 UI，无需等待活后端。未实现的知识/学习/运维入口不假装可用。

Profile/Catalog 生产浏览接口尚未存在于 Snapshot；主 Agent 统一发布派生 schema/路由后接入。A 可先完成 AgentProfile/ProbeReport fixture 组件，B 实现对应模块 port。不得在三处分叉新增一个 Snapshot.profiles 字段。

## 4. B 的 Runner 与主线桥接

复用 `AgentDriverV1`、AttemptSpec/AttemptIO、FactSink、RunnerHost/RunningAttempt 和恢复端口。B 的早期检查点必须把下面交互变成可运行接口，而不只是一份提案：

| 交互 | B 负责 | 主线负责 |
| --- | --- | --- |
| bootstrap/launch | 独立进程入口、严格配置/ready、资源归属、一次 begin 规则 | 可信 Profile/spec/policy/lease 选择，产品索引和授权 |
| payload 与关键事实 | 本地有界持久 payload/Journal、稳定 refs/IDs、等待平台 ACK、断线保留 | 内容/身份/epoch 校验、恢复原 payloadRef、同事务 ingress 和真实 DurableReceipt |
| control | 有界 feed/answer/cancel pump、完整绑定、真实 dispatch 分类 | 用户授权、问题/答案 ledger、调用排队与当前版本校验 |
| recovery | 真实 AttemptRunner 后端、不可逆 admission close、完整 inventory、verified Journal snapshot | 认证登记、稳定 cancel intent、reconcile/barrier、core/候选处理 |

进程之间不能传 JS 闭包；B 可定义必要的、版本化的内部桥接 envelope，字段复用 frozen types，主线实现产品侧 adapter。它不扩大 AgentDriverV1、不开放 raw tool 执行、不增加另一个业务状态机/DB writer。桥接 transport 的具体实现由 owner 选已有 Node 能力，不为每个 RPC 再请示。

恢复 GET inspect/POST cancel 绝不能变成 begin/deliver/answer 的隐式入口。若提取共享 transport，原 `runner-link.ts` 仅保留兼容导出，RuntimeProducer 仅作兼容类型别名；同一 proof WeakMap、协议 v1 和旧 56 项检查必须保持。B 拥有这次精确提取例外，主 Agent 本轮不并发编辑这些区域。

## 5. 并行与验收规则

一个可消费接口检查点后继续自己的下游；主线可选择性集成稳定提交。未接受运行时不能获得生产调度资格，但可在自己的 fixture lane 开发 Catalog/Driver。未接受后端不妨碍 A 开发同 schema UI。

单模块 PASS、产品 fake E2E、native compatibility 和完整 release 四种结果分开。测试覆盖失败类别/不变量，不为每行实现镜像测试，也不靠减少断言过 gate。只有共享 wire、破坏性数据/权限或确实缺失的真实环境边界需要升级，其它选择自主推进。
