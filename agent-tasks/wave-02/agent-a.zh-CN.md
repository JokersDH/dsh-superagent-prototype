# Agent A：可信交付、产品持久化与工作台

本轮目标是交付一个完整子系统。工作目录 `/Users/hh/Desktop/joker/superagent-agent-a`，继续 `codex/g2-workspaces-verification`。先读 [整包排程](README.zh-CN.md)、[集成约定](../../docs/rfcs/WP-16/0001-wave-02-integration-boundaries.md) 和原 WP-02/04/11。当前候选基线 `fcf3273`，主线基线 `57fd8ed`；开始时保留改动并合并最新 main。当前临时根 lock 差异属于安装产物，不可顺手丢弃或提交。

## 范围与所有权

拥有 `packages/storage/`、`packages/effects/`、`packages/workspaces/`、`packages/verification/`、`apps/console/`，以及 `docs/adr/storage/`、`docs/rfcs/WP-02/`、`docs/rfcs/WP-04/`、`docs/rfcs/WP-11/`。新包内部 manifest、fixtures、测试与报告归你。

主 Agent 拥有 core/共享 wire/应用/Broker/生产 HTTP/根锁/跨模块测试；B 拥有运行时和 Driver。不要修改这些实现或在 UI 写业务状态机。原 WP-04 对 console 的禁止仅适用于 WP-04 子步骤；本轮的 console 工作在明确分配的 WP-11 范围内。

## A1. 一次收拢可信交付

先完成 [已有两项修复](../g2-agent-a-wp04-admission-fixes.md)，随后按完整模块检查其相邻边界，不以通过某个单例为终点：

- 当前 pointer、完整 attempt/epoch/assignment/contract、candidate generation 和 artifact 必须共同匹配。历史清理证明不代表当前 writer 已静止。
- host 证明须连接到正确 topic、完整 producer、已提交的 barrier command result 和对应 writer fact；缺字段、错 scope、错 receipt、零/新增资源、失效配置均有明确处理。
- freeze 对删除、symlink link text、可执行位、dirty patch 和不可变 manifest 正确；`digest()` 不覆盖基线。原用户 worktree 的内容、分支和未跟踪文件不被改写。
- 检查执行不阻塞 coordinator；输出、deadline、TERM/KILL 和清理都有上限。leader exit 或发送 kill 不能自行变成组静止证明；无法证明时结果不能为 PASS。
- Verification/acceptance/quiescence 严格校验、完整正文幂等，过期或部分机器失败不能被人工接受覆盖。对 caller 的事务范围作明确约束，避免记录与 snapshot 竞态。

运行本包测试、storage/effects 回归及下面两个主线探针，证据归档在你拥有的目录，不修改主线探针来取消断言：

```sh
node tools/bootstrap/review-wp04.mjs --runtime "$PWD" --commit COMMIT
node tools/bootstrap/review-completion-runtime.mjs --runtime "$PWD"
```

COMMIT 替换成实际待复核提交；本地 dirty 验证须明确标注，最终交付以 committed source 复验。API 从同步改异步等必要变更可在 RFC 给出兼容补丁与测试说明，由主 Agent 处理其拥有的调用方。

## A2. 补齐产品仓储并发布早期检查点

现有 ProductStore 已有 core rows、answers/deliveries、回执、队列、事件和 runtime 仓储；缺少应用/Broker 使用的产品记录。按 [数据接口约定](../../docs/rfcs/WP-16/0001-wave-02-integration-boundaries.md) 提供以下同连接 repository：

| 数据 | 要求 |
| --- | --- |
| WorkRecord | 稳定 ID、project/conversation 索引；不存执行 phase |
| ContractRevision | 版本与 digest 不可变，按完整 ref 查询；current authority 仍复用现有 authority |
| TicketLink | 合同与 Ticket 的明确关联、幂等/唯一约束 |
| ConversationMessage/Page | 持久顺序、分页、原始 project/profile/anchor/provenance，重放不重复消息 |
| UserQuestion | 严格 schema、版本/validity CAS、原生 targets 与 scope；问题语义由 Broker 决定 |
| dispatch control | 只保存 paused/revision CAS 控制，不成为第二 Work 生命周期 |

复用已有 Answers/AnswerDelivery；补上实际需要的单调状态和冲突保护，不再造答案表。所有操作能加入同一 UnitOfWork，与核心、receipt/event/effect 一起提交或回滚。新增迁移只追加，不改已交付版本 checksum；v6 候选与你的分支统一整理，升级/冲突/重开/备份用真实 SQLite 验证。不要为了未来学习、项目管理或复杂通用实体框架预建无消费者的表。

完成 A1+A2 后发布 **一个 backend-surface 检查点 commit**，附导出 API、方法语义、调用样例、真实测试与依赖请求。主 Agent 可先消费这部分。你随后直接继续 A3；不等主 Agent 逐条确认。

## A3. 实现可操作工作台

使用现有 React 18/TypeScript 方向和有界依赖，具体样式实现由你决定。新增 `apps/console/`，从主对话和工作列表进入真实操作界面；不做营销首页。

1. 先实现 HTTP transport 与隔离 fixture adapter，消费公共 Snapshot/UserCommand/CommandReceipt/Change/AppError；浏览器发送命令不携带 TrustedActor，身份由后端生成。
2. 覆盖新建委托、工作详情、主对话 project/anchor、集中问题、答案逐 target 状态、停止/暂停派工/继续/重试、验证结果与当前候选接受。动作来自后端 `actions.available` 和当前引用，不在页面猜状态。
3. 处理 choices/form/free_text/url/review，权限/认证逐请求呈现原生选项；写出或本地记录不能显示成 native_applied。旧问题、候选、token、版本冲突有可恢复的错误状态。
4. 支持 snapshot+cursor、SSE 去重/断线/过期后重取、页面刷新与返回详情。模型离线仍能查询、回答、停止。长标题、空/加载/失败/停止中/未知 writer 状态可用。
5. 执行器连接组件可先消费 AgentProfile/ProbeReport fixture。Catalog 的生产读取入口由主 Agent统一接线；不私加 Snapshot 字段或页面 vendor if/else。

固定项目/场景 fixture 只能位于开发/测试 adapter，不能作为生产业务状态源。生产 API 尚未齐备时完成同 schema 的操作场景，不等待后端；同时记录哪些真实接线尚未验收。

UI 应紧凑、便于扫描和重复操作。使用图标/tooltip、明确表单控件和可见焦点；避免装饰性 hero、嵌套卡片和大段功能说明。用 Playwright 验证桌面和窄屏、键盘、中文/英文长文本、错误和刷新恢复，提交截图证据。启动 console 的开发服务器并报告实际 URL，遇到端口占用换端口。

## 整包验收与报告

- A1 的两项阻断与相邻不变量、A2 的原子性/升级/幂等/分页测试通过。
- UI fixture 场景可实际操作，所有请求/响应由公共 schema 验证，截图无重叠溢出；真实后端未接上时只报告 fixture 级 PASS。
- 发布可复现命令、配置/运行方式、接口样例、依赖清单和验收表；测试数量不替代行为清单。机器失败、未知清理和旧候选始终不能交付成功。
- 当前包覆盖 WP-02 增量、WP-04 和 WP-11 首版，不包含 CLI/发行、学习实验或原生 Driver。不得自动 merge/deploy、操作用户原项目或 native profiles。
- 各里程碑单独 commit/push 方便主线挑选；只对外汇报一次后端检查点和一次整包交付，真正跨边界阻塞可提前集中报告。只 push 本分支，不 push main。
- 在 `packages/verification/reports/wave-02-progress.json` 持续更新 A1/A2/A3 状态、tested source commit、接口检查点、测试/截图路径和未接线项，供主线直接读取。报告源码 commit 应指向被测试的代码提交，不用无法自引用的报告提交 SHA。
