# Wave-30 A: historical completion facts and recoverable product data

Base `c80ec34`; merged `origin/main` `6f385a54`. Schema 18, no migration, no candidates table/ledger.
The strict canonical classifier, artifact inventory, content-v2/FTS and dual-format closure remain.

## A1 Historical validity vs current eligibility

`WorkflowIndex.work().completion.reviews` now validates each canonical review against the **review's
own attempt binding**, not the ticket's current/highest epoch:

- canonical command id is still derived from the original verification candidate;
- shape, proposal/verification agreement, artifact ids, work/contract and ticket/assignment are
  strict; bad ids are unclassified, never filtered;
- the receipt's `attemptId` selects its historical `runtime_bindings` row; missing binding is
  `historical_binding_missing`;
- each review exposes `bindingState` and `currentLink: current_attempt | historical_attempt`. A new
  current epoch only changes `currentLink`; it does not erase or reclassify the old review;
- unclassified reviews keep a reason; coverage/limits remain explicit. Historical validity is data,
  not current eligibility; ProductCompletion.current/preflight/accept remains the authority.

The epoch+1 test registers a new current attempt and verifies the old review remains canonical,
readable, `bindingState=ended`, `currentLink=historical_attempt`, while C's
`wave29-completion-facts.mjs` consumer reports it canonically.

## A2 Stable public consumer closure

Exported from `@personal-agent/storage`/`@personal-agent/workflows`: completion facts and types,
`productReviewCommandId`, expectation/manifest build/verify, `readWorkflowContent` (v2 current, v1
historical), restore/verify with independent content/artifact expectations, and applyOriginalResult.
The current main product TypeScript consumer compiles and C's completion-facts tool runs the same
reader. Completion arrays are bounded per ticket (50) with `coverage`/`limits`; canonical lookup avoids
a command-receipt JSON table scan. No second SQL writer, registry, grant or empty probe method.

## A3 Product flow, receipts and dual-format

Current main's real project recipe flow (preview → original fields/editable goal → revalidation →
Application create/check/currentCandidate/manualaccept) runs 5/5. The same A/C dual-format run creates
and restores v1/v2 roots, reads original Work/Q&A/native_applied/candidates/sources, and C's
wave-27 target proof returns `ok` for both while added-message and emptied-inventory copies return
`mismatch`. Business reads stay 422; provider/queue deltas are zero. D package metadata is recorded but
not installed/certified here.

## A4 Fault, limits and support

Independent Node readback, original-result duplicate/unknown/foreign semantics, restore failure
atomicity, artifact/content bounds and the existing intent/written/observed windows remain. Each
result records source/command/exit/original IDs/coverage; no user instance, credential, native/model
call or second lifecycle is touched.

## Evidence

- `wave30-node.txt` — Node24 12/12; `wave30-completion.txt` — strict classification, epoch+1 historical
  review and C consumer; `wave30-workflow-tests.txt` 123/123; `wave30-storage-tests.txt` 88/88.
- `wave30-main-completion.txt` 8/8; `wave30-project-recipes.txt` 5/5.
- `wave30-dual.txt` — content `14ba5432…`, 138 rows / 56327 bytes / 17 artifacts; C proof
  independent/independent `ok`, drift/emptied `mismatch`.
- `wave30-strict-*.txt`, `wave30-build-*.txt`, `wave30-product-strict.txt` — exit 0.
- `wave30-content-proof.txt`, `wave30-original-result.txt`, `wave30-input-guards.txt`.

## Not reached

Installed/frozen D package dual chain, B/I live attach/recovered native result, F App/readiness package
and E final verdict remain separate NOT_REACHED tiers. D 1ba/1fbaf94 metadata and E's ce64 verdict are
not merged into this source result.
