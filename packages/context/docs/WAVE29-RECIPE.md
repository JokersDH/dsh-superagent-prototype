# 第二十九轮 Agent C：严格完成事实、模板普通流与当前 1ba 产品数据链

2026-11-15，基线 merge `273de3a`（`origin/main` `79525b6`；RFC 0073/0074/0075）。
C 仅改 context/proposals/knowledge/routing；真实 vendor model/native 0；未改 UI/HTTP/SQL/root lock/E 断言。
wave28 的 A content/restore proof、1cd 双格式、event/message/artifact drift 拒绝保留。

## 1. A 严格完成事实（C2–C4）

新工具 `wave29-completion-facts.mjs` 调用 A 当前 `WorkflowIndex.work(workId, [projectId]).completion`
（A head `c80ec34…`，workflows.ts SHA `27f3142e…`）：

- `reviews` 只从 `completion_verifications` 派生，再按 canonical
  `productReviewCommandId(candidate)` 找 receipt；`canonical` 逐条输出；
- `unclassifiedReviews` 保留严格 shape/Work/contract/binding/canonical 校验失败；
- verifications/acceptances 原样读取；不创建候选表/ledger。

实测：源 Store 与 A restore 后副本的 review commandId、verification、acceptance 完全一致；
额外插入的 raw review receipt（合法 ticketId、foreign contract、缺 attemptId）**不会**进入 reviews，
verification/acceptance 计数不变；raw receipt 不能贴 current/accepted，原 ProductCompletion
`current/metadata` 仍是应用权威读取。

## 2. 模板原表单普通流（C9–C12）

C 测试用 main 已接的 J preview HTTP：注册项目 facts → `POST /v1/projects/:id/recipes/preview`
返回 `draft`、`authorization:none`、fields 与显式 project/profile/scope 一致、无 root 泄漏；
随后用原始 `create_work` → fixture check → `accept_candidate` 进入 delivered；再以 A strict facts
读回同一 Work 的 canonical review/verification/acceptance。没有新写接口、第二确认或模型请求。
J 模块未包含在当前 1ba 包内 → same-package 模板流 **NOT_REACHED**；source-only 明确。

## 3. 当前产品包（C7–C8）

精确 `1ba0032` 包（tar `504dfdc1…`、build `67abd966…`、schema18/Node24.21/ABI137）：
v1/v2 A restore + manifest/target proof + package prepare/start/read/stop；readiness
`authorization:none`/`recovery_readonly`/`development:readonly`/dispatchable 0/admitted 0。
D 1ba 含统计不含 J；E 仍 ce64；source/包/独立 verdict 分层，不互贴。

## 4. B/I 与恢复（C13–C16）

原 callback/live B/I 未准入 → **NOT_REACHED**；C 只复用 A facts/ProductCompletion，不发批准、
不新第二 coordinator。data-only/普通读取不冒充 live recovery；template/包/UI 路径独立继续。

## 5. 故障、身份、API（C17–C24）

保留完整 PID/API/start identity、合法 reuse/keep、stop 失败降级、全阶段 deadline/cleanupReserve、
silent/半 JSON/早退/readiness/stop 故障；输出/日志有界。driver API 仍
`personal-review-driver/2`；新增 facts consumer 为独立只读工具，不授执行/release。

未测：长期撤权、并发 writer、48h soak、B/I live、private/target/native、J-in-package、
F UI/E release。十二服务/state/tar/ledger 与 lock 差异保持；只信号本轮证明出生资源。
