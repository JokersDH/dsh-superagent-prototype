# RFC-0003: Immutable routing/review/outcome evidence

- Status: implemented package-local (A1 checkpoint `f26f2eb`; main/C consumption pending)
- Owner: A (`packages/storage/`, `packages/workflows/`, migration v13)
- Shared source: `packages/contracts/src/routing-review.ts`; consumers: main/C/E, D for snapshot
- Model budget: 0; all fixtures use temporary SQLite directories

## A1: shared port

`createWorkflowPorts(store).routingEvidence` (also `store.workflows.routingEvidence`) implements the
main-owned synchronous `RoutingEvidencePort` over the existing `UnitOfWork`:

- `advice.put/get/list`
- `reviews.put/get/list` with exact `ReviewSubject` digest filtering
- `outcomes.put/get/list` with exact `ExecutionProfileRef` digest filtering
- `sources(attemptId, projectId)` (A-owned extension) for main's trusted outcome producer

All records are append-only and immutable. A same ID with the same canonical body returns the
original row with `replayed: true`; a different body is a `WorkflowConflict`. There is no HTTP or
arbitrary-client write entry. Validation uses the shared RouteAdvice/ReviewEvidence/ExecutionOutcome
parsers; a schema-valid row is data, not proof of native execution, review quality or acceptance.

## A2: bounded indexes

- Advice is ordered by `createdAt`, review/outcome by `observedAt`; cursors are stable
  `timestamp\0id` values with a limit of 1–200.
- Every public query requires a non-empty project ID. An empty project is invalid, never global.
- Reviews can be filtered by the complete canonical `ReviewSubject`; outcomes by the complete
  `ExecutionProfileRef` (profileId/revision/identityDigest). A same-named/newer profile is not
  treated as current.
- Historical records are never rewritten to change currentness; C/main decide whether a record is
  applicable from its exact subject/profile/layer/source.

## A3: source consistency

`sources()` reads only existing facts: binding identity/state, completion verifications and
acceptances for the attempt's ticket, and runtime observations. Missing usage remains
`completeness: 'unknown'` with no zero cost or invented human time. It returns artifact/verification
references, never claims that an artifact row belongs to the current candidate. Main must still decide
which candidate/acceptance/usage evidence is current and write the outcome once.

## A4: timeline and snapshots

`WorkflowIndex.timeline({workId, projectIds, limit})` returns a bounded chronological projection of
existing work/contract/link/question/verification/acceptance/runtime-observation/review/outcome
facts. It records event order and identity, not causality or correctness; it includes the optional
ReviewTiming payload from the outcome without deriving human time.

`WorkflowSnapshots` now asks the backup database for review report artifact references. A referenced
report artifact that is absent from the artifact registry makes the snapshot blocked/incomplete.
Existing DB backup, copied artifact bytes and digest verification remain unchanged. Restore/rollback
policy stays with D/main.

## A5: migration and consumers

Migration v13 `routing-evidence` is appended after v1–v12 and stores the three record families plus
project/time/subject/profile indexes. v12 databases upgrade without rewriting old works/contracts,
authorizations, decisions or delivery rows. The package tests cover create/replay/change conflict,
project/profile/subject isolation, cursor stability, transaction rollback, v12→v13 preservation,
sealed-copy review evidence, snapshot missing/complete artifacts, timeline facts and a second Node
process consumer.

C's actual routing module is not present in this checkout at the time of delivery; C must consume
`createWorkflowPorts(store).routingEvidence` and the same shared types, not create SQL or a second
writer. Main remains responsible for trusted producer composition and HTTP/UI exposure.

## Trust boundaries

- `RouteAdvice` is data; it cannot grant execution, expand project scope or accept a candidate.
- `ReviewEvidence` is not a verification PASS or human acceptance. The sealed-copy/native-readonly
  proof is retained exactly as recorded; the schema's isolation XOR is enforced by the shared parser.
- `ExecutionOutcome` accepted requires candidate/artifact/verification/acceptance/evidence at the
  schema level; A does not infer `accepted` from a model report or an artifact row.
- ReviewTiming is optional and null/unknown is preserved; A does not fill zeros, create a second
  accepted event, or treat client activity as quality proof.
- Evidence layers are stored as declared by the trusted producer; no model/native text can promote a
  controlled/fixture/schema row to actual native.
