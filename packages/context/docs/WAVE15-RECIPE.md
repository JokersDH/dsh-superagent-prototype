# 第十五轮 Agent C：实际来源与非空候选的数据闭环

2026-11-12，基线 `f5fe6bc`（合并 `origin/main` `53b1598`；主产品 `697efdc` 预检检查点）。
仅 context/proposals/knowledge/routing。真实模型/native 0；无 SQL/HTTP/root lock/第二确认权威。

## 1. 未知输入与 typed 私有输入的区别

```ts
// 公共/未知输入：任何形态都返回 invalid_body，不抛异常，不产生候选
reviewVerifiedReplyCandidates(input /* unknown */, bindings)

// 生产路径：main 在 CompletedAssistantReplies.read 完整核对后构造 typed wrapper
interface VerifiedCompletedReply {
  verifiedBy: 'main-completed-reply'   // private 构造契约，不是公共证明
  body: AssistantReplyBody
  identity: { requestId; replyMessageId; sourceMessageId; projectId; conversationId; model;
              principal; requestDigest?; artifactRef?; artifactDigest? }
}
```

- null/非对象/`verifiedBy` 不符 → `unverified_reply`；body/identity/principal 缺失或字段为空 →
  `incomplete_identity`；body↔identity 漂移 → `reply_identity_mismatch`；identity↔当前 bindings/principal
  不符 → `reply_binding_mismatch` / `principal_unverified`。
- artifact tuple 只要出现一项，三项必须齐全且 `artifactRef === artifactDigest`，否则
  `incomplete_identity` / `artifact_mismatch`；C 不校验字节，字节由 main 的 reader 负责。
- 合法 typed 正例仍返回 `candidates`；C 签发 `verifiedIdentity`（request/reply/source/project/
  conversation/model/principal + 可选 requestDigest/artifactRef/artifactDigest）供 main 绑定事务。

## 2. 候选与原始 payload/index/digest

- `candidate.index` 是 `body.suggestions` 的原数组下标；`candidate.payloadDigest =
  proposalDigest(body.suggestions[index])`，不从 title/summary 重建。
- `planProposalCommand` 使用 `proposalIntent(原 payload)`：work 的 goal、decision 的 content/scope
  都来自原建议；`commandId`/`effectiveCommandId` 由调用方或 main 生成。
- 展示字段（title/summary/fields）只用于 UI，`executable:false`、`requiresUserConfirmation:true`
  永不改变；公共请求不能附 `verifiedBy`/actor/tool 权限。

## 3. 接到原提案事务（无新权威）

```ts
const preview = await ops.prepareProposal({ projectId, conversationId, sourceMessageId, payload }) // main HTTP
const receipt = await ops.proposal({ kind:'confirm_proposal', commandId, projectId, conversationId, token })
```

- 已验证候选 → `preview.record.payloadDigest === candidate.payloadDigest`；`requiredInputs` 与
  `candidate.plan.missing` 一致。
- 确认由 main 同步写 proposal 状态、其自身派生 effectCommandId 与原业务命令（decision 同事务）；
  丢响应重放返回同一回执且不产生第二条决定；拒绝是独立终态且**无** effectCommandId。
- C 不保存确认、不签名 token、不派发命令；`AssistantProposalService` 只作为 main 已使用的库消费。

## 4. 来源审阅与历史（第十四轮契约保持）

- items/bytes/omissions/detail 预算独立；任裁剪置 `truncated`，`totals.suppressed` 汇总三者。
- 任意 POSIX/Windows/UNC/file URL 脱敏为 `<redacted-path>`；相对引用保持。
- factory：`maxScannedMessages`（main 生产 600）、published ids、newest-first + id tie-break、
  `coverage()` 贯穿 Composer/manifest；source fingerprint 只由 projectId+identity 派生。
- 历史：只经 main 验证的 `replyReader` 附加完成结果；live 正文修改后原 audit 的 `bundleDigest`
  不变，新 prepare 才读新正文。

## 5. 本轮证据

```sh
PA_ADMISSION_REPORT=/tmp/w15.json node tools/bootstrap/probe-wave15-context.mjs "$PWD"  # 4/4
probe-wave14 6/6 · wave13 6/6 · wave12 8/8 · wave11 17/17
context 124 · proposals 39 · knowledge 84 · routing 44
```

非空候选 fixture：`packages/proposals/test/verified-candidates-transaction.case.ts`（3 条建议，
原 index/digest/verifiedIdentity/plan 断言）；真实链路：`packages/knowledge/test/
main-context-use-consumer.case.ts`（9 例，含非空 verified 候选 → 真实 A 提案状态；以及
main ProductProposals HTTP preview/confirm/replay/reject）。

## 6. NOT_TESTED / owner

- main 默认预览 adapter 替换为这些 factory：main 尚未接线（仓库内无调用方），只按 composer
  内调用计数/来源/coverage 计量，不冒充 HTTP 准入。
- main 模型 port 仍返回 text/model 并保存 `suggestions:[]`：非空候选的真实生产路径 NT；
  本包给出合法结构化 fixture 与 validator，不调模型、不自动补发/重试。
- 候选 UI 与最终用户确认：main。
- SSE：本消费路径未读，不宣称。
- A `history work_id` 派生列：A 修；C 以 query.workId 复核。
