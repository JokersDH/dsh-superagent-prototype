# RFC-0001: Check-definition revision in a criterion reference

- Status: proposed — **no frozen contract change required**
- From: WP-04 (Agent A)
- To: main agent (contracts owner)
- Date: 2026-11-07

## Situation

A contract `Criterion` carries `checkDefinitionRef: Id` (a plain string), while the WP-04 check
registry is revisioned: a changed check body must be registered as a new revision so historical
verifications stay explainable. The criterion cannot currently pin a revision.

## Current resolution (implemented)

`CheckRegistry.require(ref)` resolves the newest registered revision, and the verifier records the
exact `definitionRevision` it executed in the run evidence (`CheckEvidence.definitionRevision`) and
in the evidence reference (`check:<id>:r<revision>:<outputDigest>`). The verification's
`criteriaDigest` still covers the criterion text and `checkDefinitionRef`, so a contract cannot
silently point at a different check ID.

Failure scenario this leaves open: after registering revision 2 of a check, a later verification of
an *unchanged* contract runs revision 2 while an older verification ran revision 1. Both are
internally consistent, but the contract does not state which revision it expects.

## Proposed options (main decides)

1. Keep the current resolution; document that a check-definition revision bump is a verifier-side
   change recorded in evidence, and that a contract that needs a frozen check must bump its own
   contract revision (new Work revision) to express that intent.
2. Add an optional `checkDefinitionRevision` (positive integer) to the criterion shape in a future
   contracts version; the verifier pins it and refuses unknown revisions. This is additive and
   needs new-consumer fixtures, so it must not be rushed into v1.0.0.

## Impact

No frozen contract change is made by WP-04. The evidence store rejects a verification whose
criteria digest does not match the current criteria, so an edited criterion (or check ref) cannot
reuse an old verification.

## Repro

`packages/verification/test/checks.case.ts` — "the registry is immutable per revision" and
"a verification binds the candidate, artifact and core criteria digest".
