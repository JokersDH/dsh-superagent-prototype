# Agent A：日常会话、项目工作流与唯一存储迁移

继续 `/Users/hh/Desktop/joker/superagent-agent-a` / `codex/g2-workspaces-verification`，保存自己的现有工作并合并最新 main。读取 AGENTS、START-HERE、product-spec/README 和本轮 README。基线 `c3f018e`；旧环境模块已按 `c005820` 集成，不重新覆盖主线 workspaces/console/Runner。

本轮拥有 `packages/storage/`、`packages/workflows/` 及其中的 manifest/tests/fixtures/docs/reports。**你是唯一生产 SQL 迁移 owner**。主线 owns 公共 contracts、application/questions、HTTP/coordinator/console 和 root lock；C/D 只能经你的公开 port 消费存储，不得私建 writer。原生模型预算 0。

## A1 仓储 interface 与稳定检查点

审计现有 Work/Contract/Message/Queue/Artifact/Backup 存储，确定可复用 port，提出会话目录/项目版本/读索引/明确决定持久接口所需的单个 RFC。公共 wire DTO 由主线确定，包内类型不能冒充替代协议。

在 `packages/workflows/` 提供小而完整的领域 interface，通过注入的现有 UnitOfWork/repositories 消费 `packages/storage`。只维护日常记录和派生视图，不创建第二个 Work/Ticket 执行状态机。先提交导出、合法消费 fixture 和迁移计划检查点，然后连续实现 A2–A5。

## A2 服务端会话目录、搜索与归档

交付持久会话身份/标题/更新时间/项目关联、分页目录与有界搜索。重开浏览器和服务后目录保持；消息分页和现有会话身份不被改写。采用 SQLite 能力或成熟解析/索引实现，确认实际 binding 支持，参数化查询并限制输入、匹配数与耗时，不能为检索再引入独立生产数据库。

归档仅改变目录可见性，不删除消息、产物或悄悄停止工作；活跃工作和待答问题的行为须在 RFC 定义，不能藏起用户还必须处理的请求。清除/永久删除不并入默认归档。重复命令/并发版本冲突有稳定结果。

验收：新/空/长/中文标题、消息量超过单页、重开、并发重放、跨项目/会话检索隔离和归档后历史读取；不依赖前端 localStorage 才能找回历史。

## A3 项目配置版本与读索引

支持检查/环境/显示名等明确设置的版本化变更与归档。保留旧项目身份、旧配置和来源，新配置只作用于新的授权；在途 Work 的合同、检查定义与环境策略不可被覆盖。接管 NativeProjectRegistry 的持久部分须先给主线迁移/消费方案，不能同时私改 coordinator 组合。

为 C 提供带 project/scope、基线/内容身份和有效性的读索引 port，可读取已有工作、检查、交付和授权项目来源。使用有界分页和明确 provenance；索引不读取账号、.env 或越界符号链接，也不授予模型文件/执行权限。

验收：更新后新工作可用、旧合同不变、旧配置可审计；重放/CAS 冲突准确；索引失效/来源消失不会伪造“当前事实”。

## A4 决定持久 port 与一致快照支持

与 C/main 对齐已有 UserDecision 等契约，提供明确决定的追加版本、撤销、scope/来源查询所需持久 port；由 C 实现决定治理规则，主线实现命令/HTTP 组合，A 不在存储暗中自动学习。

为 D 提供一致快照/引用产物清单/完整性检查所需 port，复用现有 SQLite online backup、artifact digest 和 UnitOfWork。外部消费者不直写 SQL，不以备份中的数据库行证明产物都在。迁移 append-only，旧 DB 打开/回滚限制、缺产物/损坏/IO 中断和不兼容版本均有明确结果。

## A5 跨包消费与交接

用公开 interface 在第二个消费者/新目录验证目录/搜索/设置/决定/快照 port；主线接线未到时用相同 interface fixture，准确标 package-local。补故障、边界和性能样例，不用纯 CRUD 自测代替真实 binding 行为。

更新自有 `reports/execution-status.json`：每阶段 commit/base、命令/证据、迁移序号、依赖请求、兼容范围和 main/C/D 消费步骤。只提交拥有路径、push 自己分支，主线独立验收后集成；不修改 root lock 或公共 schema 来绕过缺口。

遇阻备用工作：公共 DTO 未到先做仓储/迁移/搜索负例；C/D 未就绪先做公开消费者与 snapshot/坏数据测试；主线 API 未发布不停止整个包。没有真实模型任务、全局升级或用户服务操作。全部可执行阶段完成或仅剩明确外部阻断时交统一结果。
