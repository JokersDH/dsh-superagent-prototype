# Question Broker

Transactional intake/answers and fenced per-target delivery over the existing ProductStore. No SQL or second writer is created here. Build dependencies, then run `pnpm --filter @personal-agent/questions test`.

`QuestionBroker` accepts the store and trusted synchronous `admit`, `authorize`, `current` and core `invalidate` callbacks. Its `open/answer/expire/reuse` methods join the caller's UnitOfWork. Answers record the original question/native binding/version, a version claim and per-target delivery intents before any external send. A display message is not another core Input. URL-open and defer only record intent; neither claims native authentication nor resumes business.

`reuse` is explicit and conservative: business clarification only, same current contract, scope, decision key, presentation/text, question version, actor and validity. Permission/authentication/review never share approval. Scope containment is over configured identical atoms, not inferred glob-language inclusion.

`deliver` runs outside database transactions. The transport completes preparation then invokes `beforeWrite` synchronously immediately before its first external write. This rechecks the fence and commits a write marker. An unexpected exception, mismatched receipt, timeout or uncertain earlier write yields `DeliveryUnknown`; the effect must park for reconciliation, not resend. Only explicit `not_sent + same_key_safe + evidence`, with no write marker, yields `DeliveryDeferred`. A late callback after completion/deadline cannot write. `response_written` is durable history, never automatic `native_applied`.

`observe` is a trusted normalized-fact entry, not a user operation. It requires the exact original wire binding and evidence plus a write intent for native consumption. The ingress adapter must authenticate/fence the fact before calling it. Evidence vectors are preserved in immutable database-backed bundles; public delivery reads expand them. Per-target statuses remain separate and terminal/unknown states never regress into success.

Queue kind: `question.answer`; value: `{answerId,targetBindingId}`. A coordinator effect adapter should map `DeliveryUnknown` to existing `UnknownSend`, `DeliveryDeferred` to `Later`, and actual successful/expired results to queue completion. Recovery never automatically reconstructs permission answers for a new connection epoch.

Current limits: 200 open questions (whole snapshot budget), delivery deadline 3 seconds by default (1–60000ms configurable). Production native transport composition is a separate acceptance scope from the real-SQLite module tests.
