# G1 RFC Resolutions And Review Disposition

Reviewed A: `8a02f02`; B: `b4111ed`. A's 34 storage + 8 effects tests and B's 63 runtime tests independently rerun. The review found additional negative cases; neither whole WP-02 nor WP-03 is accepted by those counts alone.

## WP-02 RFC-01: Domain Binding

Accepted as a structural adapter, not a new domain-model package. The formal core owns Repositories/Ticket/Thread/Trigger/Decision/Disposition. The application composition root maps them to DomainStore's generic JSON methods and the same UnitOfWork. Saves preserve every aggregate field, including personal completion. Generated-column behavior must be tested against the real core, not private model substitutes.

The adapter belongs to main-agent integration, not to the pure core package; no SQL runtime dependency is added to the core. Storage remains migration owner.

## WP-03 RFC-0001: Payload Kind / Generation

Do not change the frozen v1 port. Its generic payload store also holds ExecutionInput, NativeAnswerPayload and PreparedExecutionPolicy, not only runtime facts. For facts, the existing RuntimeFactPayload `{kind,value}` schema is mandatory. Authoritative ingress always uses `parseRuntimeFactPayload(fact, resolvedImmutablePayload)`; missing/wrong envelopes fail before any business commit/ACK. Early Driver/Runner validation can improve diagnostics but cannot replace that check.

Payload references are immutable/content-addressed. A factId names one immutable identity/body, so a changed payload/ref is a conflict, not a replacement generation. Native reconnect must preserve stable fact identity/cursor or create a new legitimate attempt/epoch; restarting a local seq and reusing old fact IDs is invalid. No version/hash update is needed for these existing rules.

## WP-03 RFC-0002: Atomic Ingress

Accept one authoritative transaction. Runtime binding/epoch belongs to the execution/application bridge; Assignment lifecycle belongs to core. Pure core must not acquire a runtime SQL model. The bridge reads current/known binding, checks the full tuple and payload, deduplicates immutable fact, applies core facts and stores event/receipt inside the same synchronous UnitOfWork. External payload I/O occurs before the transaction using an immutable reference. ACK follows commit.

Exact duplicate known facts return their original receipt without reapplying. Conflicting bodies are errors. Stale business facts never mutate a new assignment. Known old physical cancellation/exit/writer observations may update runtime audit while stopped; they do not authorize work or imply completion. Production binding/lease tables must be supplied by WP-02 migration owner; no main-agent private schema.

## Blocking Findings

WP-02 writer lock can steal an empty in-flight file and has check/unlink/create stale-takeover races. Synchronous transactions need Promise/thenable rejection. WP-03 commands omit contract, fence ignores Assignment/contract, unknown stop can become confirmed on a repeated call, initial input is confused with policy ref and command IDs collide. Process-group quiescence/start-marker behavior also needs the negative tests specified in the owner feedback.

Owner instructions are in `agent-tasks/g1-agent-a-review.md` and `agent-tasks/g1-agent-b-review.md`. No active worktree was edited. Core-to-SQL binding checks can proceed independently, but production coordinator startup, retry resource reuse and full G1 remain blocked until these invariants pass.
