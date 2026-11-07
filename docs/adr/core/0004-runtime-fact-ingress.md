# ADR 0004: Authoritative Runtime Fact Ingress

Status: implemented as a main-agent composition module; production runtime storage/Runner wiring remains pending owner integration. Frozen wire contracts remain v1.0.0.

## Interface And Ownership

`apps/coordinator/runtime-ingress.ts` exposes `createRuntimeIngress(store, payloads)`. A trusted composition root authenticates a Runner, creates a RuntimeProducer with the full AttemptRef plus runner identity/source, and supplies the frozen `bind(producer).record(fact)` facade to that Runner. A fact body cannot choose a different principal.

RuntimeIngressStore is one synchronous transaction surface for known/current bindings, core Ticket access/authority, fact receipts and business/physical reducers. It uses existing core types and fact receipt shapes, not a duplicate Work lifecycle. Main owns this application module, its package/check configuration and integration tests; A still owns production runtime tables/migrations, B owns Runner/Supervisor implementation.

## Transaction Order

1. Parse/copy the fact and trusted producer. Reject any tuple/source mismatch.
2. Before opening a DB transaction, resolve an immutable host-managed payload, canonicalize JSON, verify its recorded SHA-256, and parse the existing RuntimeFactPayload kind/value schema against the fact.
3. Open an outer synchronous transaction. Known attempt/producer identity must match, even for a replay. Read the fact receipt by immutable factId/body digest.
4. An exact known replay returns the original sequence without applying again; a changed body/reference conflicts. No replacement payload generation is invented.
5. New business facts require the exact current active runtime binding, live non-retired personal Ticket, current contract/authority and latest non-ended Assignment. Native physical observations can use a known historical binding; resource IDs/ownership must belong to it.
6. Apply the appropriate reducer and store the fact receipt/event together. Validate the returned receipt against the row just written and require exactly one reducer invocation. Return persisted ACK only after the outer commit.

Ingress refuses entry inside an already open outer transaction, which could otherwise expose a nested uncommitted ACK. Native async reducers/storage callbacks are refused before invocation; thenable return values roll back. Side-effecting asynchronous continuations are forbidden in storage/reducers and cannot be made transactional by this interface. All reducers use the same connection; no model/network/process I/O belongs inside them.

## Physical Observations

`runtime.exited`, `writer.observed` and `cancel.observed` are stored through a physical-only reducer. They remain useful after Ticket stop, revision supersession or binding end. They never automatically create a ready report, complete a Ticket, revive business authorization or prove all writer resources stopped. The reducer must preserve per-resource observations and require actual ownership/quiescence evidence before any resource barrier changes.

`turn.ended` is a business fact for the current Assignment. Tests apply it only through the scoped core turn-ended callback; even `candidateAvailable:true` does not complete or create a core candidate. Later explicit candidate/verification integration is separate. Unknown or malformed payloads receive no success ACK; error handling/reconciliation must not regenerate the original business action.

## Evidence And Limits

The deterministic tests exercise protocol/identity/duplicate/conflict/freshness/rollback/ACK rules. A separate optional native SQLite harness uses review-only fixture tables to test the same-connection property without shipping a private production schema. Neither proves production bindings, durable Runner journals, IPC authentication implementation or real native-agent compatibility.

The existing payload port stays generic because it also holds ExecutionInput, NativeAnswerPayload and PreparedExecutionPolicy. For facts, the kind/value envelope is mandatory at authoritative ingress, not optional based on what a Driver happens to send. Fact IDs/payload records remain immutable and retained long enough for replay; no raw account data is collected.
