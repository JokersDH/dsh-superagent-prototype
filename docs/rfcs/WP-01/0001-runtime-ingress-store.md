# Main-Agent Runtime Ingress Store Request

To: WP-02 storage and WP-03 runtime owners. Status: interface ready; production adapter requested after the current safety fixes. Implements the transaction decision in `docs/adr/core/g1-rfc-resolutions.md`.

Public local interface: `RuntimeIngressStore`, `IngressBinding`, `RuntimeProducer`, `ImmutablePayloadReader` in `apps/coordinator/runtime-ingress.ts`. Do not copy those definitions; consume them by type import or submit a concrete incompatibility fixture. No frozen wire version change is needed.

## Storage Requirements

- Retain known bindings by attemptId, including full Ticket/Assignment/attempt/epoch/contract, authenticated Runner identity/source, resource references/ownership and physical state. Current-by-ticket selection is distinct from history. Ended/old bindings must not become active merely because an old fact arrives.
- Expose known/current binding lookups, authoritative Ticket reads and current authorization in one synchronous UnitOfWork. Existing FactReceipts get/record can be composed; its body digest includes canonical full fact plus immutable payload digest.
- Core mutation, normalized runtime observations and receipt/event must commit together. Refusal returns no success receipt; exact known repeats return the original sequence. Conflict/reducer/commit failure must not leave partial runtime/core state.
- Payload records/files are immutable. Reader returns the JSON value plus the host-recorded canonical SHA-256. External file I/O completes before DB transaction; dangling/orphan file handling follows ArtifactStore rules. Do not put native credentials/config dumps into these payloads.
- Production migrations remain WP-02 owned. Main's SQLite tests use explicitly review-only `review_ingress_*` fixture tables, not a competing runtime schema.

## Runtime Requirements

- Trusted composition associates an authenticated Runner with RuntimeProducer and passes only `bind(producer).record`. Producer context is never deserialized from an untrusted fact body.
- Supervisor's local fence is diagnostic; authoritative record must reach ingress. Do not drop known old physical facts or exact repeated receipts solely because current binding has advanced.
- A receipt is returned only after the outer transaction committed. Missing/mismatched payload envelopes, stale business tuples, unknown resources and changed same-ID bodies are refused; unknown send/recovery is reconciled, not restarted.
- `runtime.exited` is a resource observation, not proof of whole-group quiescence. Native cancel acknowledgment is not resource release. Durable journal replay must keep original fact identities or use a legitimate new attempt/epoch.

## Acceptance

Run the main deterministic ingress suite and the optional SQLite fixture harness, then replace fixture bindings/observation reducers with the production repositories and repeat duplicate-after-stop, old-epoch, commit rollback, physical-after-stop and no-false-ACK cases. The module is not a daemon and does not enable the currently rejected process/lock paths.
