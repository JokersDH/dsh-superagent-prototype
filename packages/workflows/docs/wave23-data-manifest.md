# Wave-23 A data manifest and cross-process reader

A owns storage/workflows. The manifest is data integrity evidence, not a grant, ledger or writer-stop proof.

## Producer

`buildDataManifest(store, input)` reads only public ports:

`bindings.binding/current`, `commands.get`, `dispatch.get`, `observations.forAttempt`,
`payloads.read`, `product.questions`, `answers.get/deliveries`, `recoverySource.inspect`.

Inputs: `sourceSha`, `snapshotFormat:1|2`, `ticketId`, `attemptId`, `questionId`, `answerId`,
`commandIds`, `dispatch[{commandId,target}]`.

Manifest `wave23-data-manifest/1` records the actual root, attempt/ticket/assignment/contract/epoch/
session/resources, current pointer, question/answer/delivery identities, command receipt/payload
digests, dispatch delivery state (`not_sent|written|native_accepted|indeterminate`), observed facts
with payload refs/SHA/bytes, counts, source fingerprint and a canonical `digest`.

`verifyDataManifest(store, manifest, {sourceSha, snapshotFormat})` rebuilds from live public reads and
rejects a changed payload digest, answer/attempt ID, data root, source SHA, snapshot format or source
fingerprint. It never resends, consumes queue or writes.

## Independent process reader

`packages/workflows/test/fixtures/wave23-reader.mjs <db> <manifest> <source-sha>` opens the original
state under a new Node PID, verifies the manifest and prints the binding/current/question/answer/
deliveries/observations/dispatch/source fingerprint. The parent test proves `pid !== process.pid`,
identical original IDs and unchanged delivery/observation/queue counts. Running the parent again
produces the same identities; unknown stays `indeterminate`, not success.

A sample actual manifest and the single-variable rejection list are in
`packages/workflows/reports/wave23-process-reader.txt` (`WAVE23_MANIFEST`, `WAVE23_MUTATIONS_REJECTED`).

## Reuse by C/D/E

C should use this manifest as the only data subject input to its one parameterized consumer driver;
D/E bind the same IDs/format/source SHA to the exact install root and consumer bytes. The driver
variables are: install root, producer source SHA, restored state root, project/allowed/excluded paths,
workflow format 1|2, ports, review output and consumer entry. Default v1 and explicit v2 remain
distinct from portability personal-evidence 1/2.

Both formats continue through the real controlled Work/Q&A/native_applied + SDK/context/candidate
store to second-root personal readonly (`wave20-personal-business`, `wave21-personal-v2`), including
`?scopeReview=1` reasons and narrowed/excluded paths. Business POST stays 422, queue held and provider
count unchanged.

## Not reached

B same-Runner business attach is still not admitted; idempotent landing of a real reconnected result
into the original A Store is NOT_REACHED. inspect/cancel wrappers are not business resume.
Private startup permission, physical writer proof and target activation remain main-owned.
