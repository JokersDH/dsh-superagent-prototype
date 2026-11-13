# 第十七轮 Agent C：一致来源与恢复只读用户流程

2026-11-13，基线 `1f7af35`（合并 `origin/main` `d494212`，运行基线 main `6050b4b`）。
C 只改 context/proposals/knowledge/routing；真实模型/native 0；未写 SQL/HTTP/新 grant/第二确认。

## 1. 未知输入异常边界（仅 helper 健壮性）

`reviewVerifiedReplyCandidates` 现在对 wrapper 的每一层读取都走有界 accessor：
outer `verifiedBy`、`body`、`identity`，以及 nested `body.replyMessageId`、`identity.principal`、
`identity.projectId`、artifact tuple 等 getter 抛异常时一律返回 `invalid_body`，不抛 TypeError。
typed 非空正例保持 `candidates`。这是 P2 防御性修复，不是主线公开权限绕过。

C-only 证据：`packages/context/reports/wave17-c-probe.json`（4/4：typed 正例、outer getter、
nested body getter、nested principal getter）。完整 `probe-wave17-context.mjs` 需要 A 的 dist；
本机 A 工作树 source/dist 处于未完成的中间改动（HEAD 8b462e1 + 未提交 schema-inventory），
A 半部分记 NOT_REACHED，不在 A 工作区构建或改动。

## 2. 一致来源与异步重核

`main-consistent-source.case.ts`：

- 一次逻辑读（main `/v1/context/preview`）取得当前 source digests；读后 `store.uow.nesting === 0`，
  后续 `await` 不持 SQL 事务；
- 异步间隔后撤销决定，再读 preview：digest 集合变化，旧 observation 不被改写，不合并两个时刻；
- 追加新消息后第三次读产生第三组 digest；
- artifact 字节在异步间隔后被替换：`artifacts.read` 按记录 digest 校验直接拒绝，而不是把新 body
  合进旧结果。

## 3. 真实恢复只读用户流程

`main-recovery-readonly.case.ts` 在**同一真实数据根**上先正常产生候选、selected-context 绑定与
frozen 来源，写入 restore marker 和一条 held 旧队列后，关闭正常 runtime，再以
`startupMode: 'recovery_readonly'` 启动 main runtime + HTTP：

| 动作 | 实际结果 |
| --- | --- |
| `GET /v1/messages/:id/candidates` | 200，`executable:false`、`authorization:'none'` |
| `GET /v1/context/history` | 200，非空 frozen entries |
| `GET /v1/messages/:id/context` | 200，`bundleDigest` 与正常根一致 |
| `GET /v1/messages/:id/context/sources` | 200 |
| candidates/prepare、proposals、context/preview、assistant context、decisions prepare | 全部 422 |
| `product.start()` | 抛 `unsupported_capability` |
| `POST /v1/recovery/source/prepare` | 200，`not_granted`、`startupAvailable:false`，不创建 target 目录 |
| `POST /v1/recovery/source/confirm` | 200，同一 intent/receipt；audit GET 与 confirm 结果一致 |
| held `effect` 行、Work 数、模型请求数 | 前后不变；恢复候选仍不可执行 |

结论：source 确认只记录原 A 事实/回执，不给业务候选启动、target 或私有许可；打开第二 Store 读取
数据不被当作恢复流程完成。

## 4. 候选/决定重放

`main-candidate-chain.case.ts` 增加：确认产生决定后 revoke，原 confirm receipt 仍原样重放、
决定数不变、revokedAt 保留、无第二业务；artifact 损坏后原 receipt 重放也不重发模型。

## 5. 成本与有界性

- 一次 chat 只触发 1 次本地伪 SDK 调用；8 候选+3 万字符正文仍 1 次；
- 610 条被排除展示触发 600 扫描边界 → preview `partial` + `conversation_scan_incomplete`；
- 恢复只读审查只走 GET 读路径，不启动 effects/不消费 held queue；
- 旧 10000 历史/候选规模证据保留引用。

## 6. 命令与结果

```
context 124 · proposals 41 · knowledge 96 · routing 44（全部 pass）
wave15 4/4 · wave14 6/6 · wave13 6/6 · wave12 8/8 · wave11 17/17
strict/exactOptional 全链 build 通过
wave17 C-only 4/4（A 半 NOT_REACHED：A 工作区中间态）
```

## 7. NOT_TESTED / owner

- 真实跨版本 snapshot 安全矩阵（mixed version / 缺空表）：依赖 A 修复，A 半 probe NOT_REACHED。
- main 私有启动许可、target 激活、native/value：分层未交。
- SSE：未读，不宣称。
- C 的 module-only 导出（`selectRelevantSources`、`projectSourceReview`、`collectContextHistory`）：
  main 仍未调用其 HTTP 投影；本轮只读验证走 main 自己的 DTO。
