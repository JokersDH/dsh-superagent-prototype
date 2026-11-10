# 主线：可操作的验证故障与恢复接口

日期：2026-11-10。基线 `3957e30`。本批属于 product-wave-03 主线 M3 的一条完整链路，不替代 A/B/C/D/E 的整包任务。

## 产品行为

验证异常现在有持久故障状态，不再无限显示验证中。候选、工作区、环境或物理屏障失效立即停止自动尝试；未分类的基础设施异常总共最多尝试三次（首次加两次自动重试），之后等待明确用户操作。数据库本身完全不可用时无法保证写入诊断，接口仍如实失败，不声称成功恢复。

主线用现有持久 effect 的 parked 状态保存验证故障，保留原候选和原屏障。每次故障都有新 `blockedId`，防止旧按钮在第二次故障时重新生效。恢复事务原子地移除 parked 行、重新排队并记录命令回执；失败整体回滚。相同 commandId/载荷/actor 重放只返回原回执，不重复排队；相同 ID 改载荷拒绝。

恢复只重新运行当前合同原有的注册检查，不发送 begin/deliver/answer，不启动模型，不重新编码。机器检查已经产生 FAIL/SKIPPED/NOT_TESTED 等结果时仍是不可接受的正式验证，不能用此入口替换不可变结果；修改工作要求仍走既有修订流程。

界面在工作详情的验证区域显示状态、简明原因和允许的“重新检查”动作。阻断任务投影为 needs_user；finished 只表示已产生验证记录，是否 PASS 必须继续读取原 Verification。没有后端恢复能力时不显示假按钮。旧 5180/5181 用户服务未被停止或重启，新后端接线在其下一次正常重启后生效。

## 稳定公共接口

公共定义：`packages/contracts/src/operations.ts`；生成文件：`generated/operations.schema.json` 和 `operations.manifest.json`。新增 HTTP resource 独立版本 `work-verification/1`；既有 Runner/data contract schemaHash `74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d` 保持原值。没有向 frozen UserCommand 加一个私有 kind。

| 入口 | 输入/输出 | 语义 |
| --- | --- | --- |
| GET `/v1/works/:id/verification` | WorkVerificationStatus | 认证后读取；not_ready/queued/running/retry_wait/blocked/finished；拒绝额外 query |
| POST `/v1/works/:id/verification/retry` | VerificationRetryCommand → CommandReceipt | 认证 JSON；URL workId 必须与候选一致；actor 由服务端生成 |
| ProductApplication.retryVerification | command + TrustedActor | 校验 principal、会话、当前合同/授权/候选、物理停止和恢复上下文；同外层事务写回执 |
| ProductExecution.retryVerification | candidate + blockedId | 仅在应用事务内消费原 parked 意图；核对资源清单摘要和既有可信屏障回执，不创造停止证明 |
| product.read.workVerification | workId | 通过现有授权 inspect 得到当前工作，再投影实际持久队列与当前进程检查状态 |
| product.operations.retryVerification | command + TrustedActor | HTTP 组合入口，复用应用方法 |

```json
{
  "kind": "retry_verification",
  "commandId": "user-recheck-unique-id",
  "conversationId": "original-conversation-id",
  "candidate": {
    "ticketId": "current-ticket-id",
    "assignmentId": "current-assignment-id",
    "contract": { "workId": "current-work-id", "revision": 1, "digest": "<64 hex>" },
    "candidateGeneration": 1
  },
  "blockedId": "<failure.id returned by GET>"
}
```

样例中的候选必须使用真实 GET 返回值，不能自己猜身份。业务拒绝仍是 status=rejected 的持久 CommandReceipt；认证、非法 JSON/字段、URL 错配和同 ID 改载荷走现有 HTTP AppError。公共故障只包含 id、枚举 code 和失败次数，不返回 exception、stderr、argv、环境变量或凭据。

## 并行消费者

- **A**：本批没有 SQL 或生产迁移；仍由 A 提供会话目录/项目版本/读索引等 RFC 和公开 port，主线再冻结相应 HTTP DTO。不要把验证 parked 行变成第二 Work 生命周期。
- **B**：Runner、Driver 和原生 wire 未改；资源证明继续由原可信屏障产生。此 API 不证明真实活动 native 停止/审批/恢复，B 原生任务仍按其独立预算执行。
- **C**：继续 Context/Proposal/Decision 领域检查点；主线会在消费 C 的 RFC 时增加其公共 DTO。本恢复入口不是 reasoner 可直接调用的工具或权限。
- **D**：生产组合需传 `read: product.read` 及 `operations: product.operations`，并提供真实 HTTP transport。迁移到新目录/新机器不能凭旧 parked 意图或旧物理屏障自动续跑；迁移 authority 重建仍是 D/A/main 的独立准入要求，本批只证明同机原 state 的重开。
- **E**：可直接消费上述已导出的 schema/API 和主线样例。优先独立覆盖合法旧候选、过期授权、同 ID 重放/冲突、旧 blockedId、资源清单变化、机器 FAIL、重启与按钮可达性；不修改主线测试或生产逻辑。

## 验证入口与范围

```sh
pnpm --filter @personal-agent/contracts test
pnpm --filter @personal-agent/application test
pnpm --filter @personal-agent/coordinator test:product
pnpm --filter @personal-agent/coordinator test:http
pnpm --filter @personal-agent/coordinator test:environment
pnpm --filter @personal-agent/console test
pnpm check:verification-recovery
```

浏览器工具自建隔离 HTTP/SQLite/受控子进程和临时端口，故障只注入私有 completion port，没有产品故障注入 API；验证桌面/窄屏故障提示、重开、实际按钮、同一编码执行的检查恢复与人工接受。`--no-capture` 可重复功能验收而不覆盖截图。首次工具运行在窄屏重开后试图点击隐藏导航项，修正为先打开工作空间后通过，没有降低产品断言。

这批是零模型的受控产品证据。真实 native 运行控制、完整环境重新准备、已发布不可变验证的替换、跨机器迁移、完整个人助理及完整 G2/G3 仍是独立任务。证据保存在 `reports/releases/verification-recovery/`。
