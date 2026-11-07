# RFC-0002: Host barrier receipt consumed by the completion evidence store

- Status: proposed — **no frozen contract change**; storage/verification interface implemented
- From: WP-04 (Agent A)
- To: main agent (coordinator owner)
- Date: 2026-11-08

## Situation

Core `CompletionEvidence.quiescence` is `{ id, candidate, artifactDigest }`. The trusted host barrier
(`apps/coordinator/resource-barrier.ts`, `confirmOwnedQuiescence`) already records, in one
transaction: a host-derived `writer.observed` fact whose per-resource status is `quiescent` with the
proof payload as evidence, the ended binding, and a `runtime.barrier.confirmed` event carrying
`{ proofRef, resourceManifestDigest, scope: 'registered_owned_resources_only', contract }`. It returns
a receipt `{ scope, attemptId, proofRef, resourceManifestDigest, confirmedEventSeq, writerFactId? }`.

A completion adapter must consume that barrier, not promote ordinary writer observations to
authority. Coordinator implementation must not be imported into a shared package.

## Implemented interface (structural)

`CompletionEvidenceStore.recordQuiescence({ id, candidate, artifactDigest, attemptId, barrier })`
takes the receipt structurally (fields above) and re-verifies against the database on the same
connection:

1. The binding for `attemptId` belongs to the candidate (`ticketId`, `assignmentId`, contract) and
   is `ended`.
2. `canonicalDigest(sorted [{ref, ownership}])` of the binding's **full** registered resources equals
   `barrier.resourceManifestDigest` — a subset or a late append is refused.
3. The event at `confirmedEventSeq` is `runtime.barrier.confirmed` for the attempt with the same
   `proofRef`/manifest/scope and the candidate contract.
4. The host writer fact `writerFactId` exists with a `writer.observed` observation from that attempt,
   and its per-resource rows cover **every** registered `(ref, ownership)` with `quiescent` status.
   The proving `factId`s are stored; a ResourceObservation summary's `last` may name an exit, so it
   is never used as proof.

At `resolve`, the barrier is re-checked against the current binding, manifest and event, so a late
resource/epoch/contract change invalidates the stored evidence.

## Gap and options for main

- The receipt type currently duplicates `OwnedQuiescenceReceipt` structurally (kept in
  `packages/verification/src/evidence.ts`). Recommended: move the receipt and manifest-digest helper
  to a shared local interface (for example next to `RuntimeIngressStore` or a small
  `@personal-agent/ingress` module) so coordinator and storage cannot drift.
- The manifest digest must remain canonical JSON of `[{ref, ownership}]` sorted by ref; both sides
  already use the same canonical encoder (conformance-tested in `ingress-compat.case.ts`).
- Completion must not treat the barrier as sufficient by itself: core CandidateRef/artifact/
  Verification binding and human acceptance stay separate (implemented).
- Nothing here releases resources or authorizes remote writes; the receipt scope stays
  `registered_owned_resources_only`.

## Impact

No frozen wire-contract change, no new migration (the v6 columns already store the evidence JSON and
the proving fact IDs). The coordinator can wire `recordQuiescence` directly after
`confirmOwnedQuiescence` returns its receipt.
