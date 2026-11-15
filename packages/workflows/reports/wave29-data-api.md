# Wave-29 A: trusted completion facts and current data consumers

Base `1f08006`; merged `origin/main` `79525b6`. Schema 18, no migration, no candidates table/ledger.
The artifact/FTS/content-v2/restore closure from waves 27–28 is retained.

## Strict review classification

`WorkflowIndex.work().completion.reviews` now derives the **canonical review command id** from each
original `completion_verifications` candidate:

```
candidate = { ticketId, assignmentId, contract, candidateGeneration }
commandId = sha256(JSON.stringify(['product-review', canonicalDigest(candidate)])).slice(0, 32)
receipt   = command_receipts[commandId]
```

`productReviewCommandId` is exported and its test cross-checks the exact public algorithm. A receipt
is classified only when all of these hold:

- object keys are exactly `proposal, verification, artifactIds, attemptId`;
- `CompletionProposalSchema` and `VerificationSchema` parse strictly; `attemptId` is an `IdSchema`;
- `artifactIds` is a non-empty, duplicate-free list of valid IDs (no filtering of bad IDs);
- proposal ticket/assignment/contract/work match the work link and the original runtime binding
  (current pointer, or the historical binding for an ended attempt); the attempt id matches;
- proposal and verification agree on candidate/ticket/assignment/contract/verification id and
  artifact digest;
- the receipt command id equals `productReviewCommandId(proposal)`.

Failures are returned in `completion.unclassifiedReviews` with a reason
(`review_shape`, `proposal_shape`, `verification_shape`, `artifact_or_attempt_shape`,
`foreign_work_or_binding`, `proposal_verification_mismatch`, `noncanonical_review_key`,
`binding_missing`, `result_not_json`). No bad receipt becomes a review. The original
ProductCompletion.current/metadata/preflight/accept remains the only current/accept authority.

## Coverage and limits

Reviews are looked up by canonical keys from at most 50 original verification rows per ticket; this
avoids a JSON scan of all commands. `completion.coverage.{reviews,verifications,acceptances}` is
`complete` or `truncated`, and `completion.limits.perTicket = 50`. `unclassifiedReviews` is bounded
by the same verification set. Existing `verificationIds`, `acceptanceIds`, `deliverables` and
timeline projections remain.

## Current data surface

`parseDataSubjectExpectation`/`buildDataManifest`/`verifyDataManifest`, `readWorkflowContent`
(v2 current, v1 historical), `restoreWorkflowSnapshot`/`verifyRestoredSnapshot` with independent
artifact/content expectation, and `applyOriginalResult` (data-only) are unchanged. `applyOriginalResult`
does not replace any B/I live result.

## Evidence

- `wave29-node.txt` — Node24 11/11; `wave29-completion.txt` — strict review class positive plus four
  unclassified negatives; `wave29-workflow-tests.txt` 122/122; `wave29-storage-tests.txt` 88/88.
- `wave29-strict-*.txt`, `wave29-build-*.txt`, `wave29-product-strict.txt` — exit 0.
- `wave29-main-completion.txt` — actual main Product/Broker/check/accept consumer 8/8.
- `wave29-project-recipes.txt` — actual J preview → original Work/check/currentCandidate/manualaccept
  chain 5/5 (main/J owned consumer).
- `wave29-dual.txt` — v1/v2 content `63c7e11b…`, 138 rows / 56328 bytes / 17 artifacts; C proof
  independent/independent `ok`, added-message and emptied-inventory `mismatch`.
- `wave29-content-proof.txt`, `wave29-original-result.txt` — FTS/content and original-result data.

## Package / not reached

D `1ba0032` metadata is recorded (build `67abd96690030eb7`, schema 18, ABI 137); it contains
statistics but not the later J wiring. E's actual verdict remains bounded to ce64. A does not install
or certify 1ba/1fba, and source data does not become an installed/native/recovered verdict.
B/I live attach and F App/readiness package remain NOT_REACHED.
