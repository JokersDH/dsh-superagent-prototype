# 第十六轮 Agent C：当前来源到候选确认的数据可靠性

2026-11-13，基线 `0778d46`（合并 `origin/main` `7a2f9e9`，产品 `a64a127/1169535`）。
C 只改 context/proposals/knowledge/routing；真实模型/native 0；未写 SQL/HTTP/root lock。

## 1. 真实入口消费（不再手造 verified wrapper）

C 侧新测试 `packages/knowledge/test/main-candidate-chain.case.ts` 直接复用 main 的
`tests/integration/fixtures/assistant-candidate-model.mjs`（本机伪 SDK），经真实产品链：

```
application.dispatch(chat) → effects(reply) → A18 artifact+replyResults
  → GET /v1/messages/:id/candidates            (main read.replyCandidates)
  → POST /v1/assistant/candidates/prepare      (指针 index+payloadDigest, 原 reply origin 绑定)
  → POST /v1/proposals/commands confirm|reject (原 ProductProposals/A 事务)
  → CompletedAssistantReplies.readVerified     (C 侧只读复核)
```

覆盖：decision/work/revision 三种 kind；requiredInputs；缺输入拒绝；确认后业务只发生一次；
原 receipt 重放（含 artifact 被破坏后仍重放）；拒绝无业务效果；混合有效+过期 revision
（index 0 候选、index 1 `contract_stale`）；reply-only 无候选；source/指针漂移拒绝；
artifact 缺失时 GET/prepare 非 200；8 候选+3 万字符长正文仍只调用一次 reader。

## 2. 默认 factory 的实际覆盖

main `apps/coordinator/product/context-preview.ts` 已默认调用
`createScopedConversationProvider`（pageSize200/maxPages3/maxScannedMessages600）与
`createPublishedArtifactProvider`（published receipt 校验）。C 侧新增用例：

- 610 条被排除的权限展示使扫描触及 600 边界 → `preview.status = 'partial'`，
  `issues` 含 `conversation_scan_incomplete`，`omitted` 含 `source_unavailable`；
- 可见 trusted 消息仍进入来源，展示文本/绝对路径不进入公开来源；
- 既有 main 工厂六项（cutoff/work 限定/外会话/发布 receipt/fingerprint/final guard）继续引用，
  不重复计数。

## 3. 候选数据契约（保留 wave-15 typed 边界）

- `reviewVerifiedReplyCandidates` 仅接受 main `readVerified` 生成的 typed wrapper；未知输入
  （null/缺字段/抛异常 getter/超大 suggestions/稀疏数组/symbol key）→ `invalid_body`，
  不抛异常、不部分接受。
- 候选 `index` = 原 `body.suggestions` 下标，`payloadDigest = proposalDigest(原 payload)`；
  C 返回 `verifiedIdentity` 供 main 绑定，自身不签发授权。
- 公共入口不把 `verifiedBy` 字符串当证明；main 的完整 reader 仍是前置。

## 4. 跨根只读复核

`chain-second-root` 用例：WAL checkpoint 后复制整个 state 根（SQLite+artifacts），第二根打开
`ProductStore` 只读复核：

- `CompletedAssistantReplies.readVerified` 可读原完成结果；history 读到 1 条 frozen 绑定
  （`current_window`、`requiresExplicitReauthorization: true`），不产生新 decision；
- 删除第二根 artifact 后 `readVerified` 安全拒绝；
- 恢复/跨根不继承执行许可；target 启动/confirm 仍归 main（本轮未交，NT）。

## 5. 决定适用性

撤销后 preview 不再包含该决定（`main-context-http` 既有用例）；supersession/范围/有效期解释
仍由 `DecisionGovernance.decisionSourceState` 与 `decision-transaction` 测试覆盖，本轮不新增
自动学习、隐式确认或第二授权。

## 6. 命令与结果

```
context 124 · proposals 40 · knowledge 93 · routing 44（全部 pass）
wave15 probe 4/4 · wave14 6/6 · wave13 6/6 · wave12 8/8 · wave11 17/17
四包 strict/exactOptional build 通过（contracts→…→routing）
```

## 7. NOT_TESTED / owner

- main 的 source confirm/私有许可/恢复 target 启动：未交，属恢复线。
- SSE：C 消费路径未读，不宣称。
- 真实公网模型：fixture 是本机受控伪 SDK；真实模型/native turn 0。
- 候选 UI/确认页面：main（C 只验证其数据前置）。
