# Wave-22 A: attempt facts and parameterized data recipe

A owns storage/workflows. No new ledger, no execution authorization, no second lifecycle.

## Existing attempt-fact map (for B/main)

Use the existing public stores; do not query undocumented columns:

| Fact | Public read |
| --- | --- |
| attempt/history + immutable identity | `store.bindings.binding(attemptId)` |
| current attempt per ticket | `store.bindings.current(ticketId)` |
| attempt resources | binding `resources` (spawned/shared) |
| original command receipt/body | `store.commands.get(commandId)` |
| send intent / written / native accepted / indeterminate | `store.dispatch.get(commandId,target)` |
| begin/answer write-before intent | `store.dispatch.beginSend`/`markWritten` |
| observed accepted facts | `store.observations.forAttempt(attemptId)`, `forFact`, `forResource`, `summarize` |
| immutable payload bytes/hash | `store.payloads.read(payloadRef)` |
| question/answer/delivery | `store.product.questions.get`, `store.answers.get/deliveries` |
| source facts | `store.workflows.recoveryActivation*`, `recoverySource` |

A command receipt existing does **not** mean a native frame was observed. `not_sent`/`written` are
write-before intent, `indeterminate` is unknown, and only a real native accepted/answer observation is
an observed result. An ended binding is not physical writer-stop proof.

`wave22-attempt-facts.case.ts` drives the real controlled product to a Work/question, captures
attempt/epoch/contract, then separately demonstrates `not_sent`→`written`→`indeterminate` on the
existing dispatch port. It answers, waits for `native_applied`, and reopens SQLite in a new Store to
check the same attempt/contract/epoch/question/answer/delivery/observation identities. Reads never
authorize a resend or a replacement command/attempt.

## Real personal review

Both formats and the signed narrow-scope read are preserved:
`wave20-personal-business.case.ts` (v1) and `wave21-personal-v2.case.ts` (v2). Real controlled
Broker/SDK/context/candidate data is snapshotted and read through the actual personal readonly demo;
business POST is 422, held queue and provider count unchanged. A new valid CLI selection with
`src/narrow/` + excluded `src/private/` is accepted; history stays readable and the wider binding
returns `scope_changed` with `scopeReview.reasons` including `selection_narrowed` and
`exclusion_added`, `withheldSourceCount` equal to the binding sources, `authorization=none`.

## D/E parameterized driver

Use public entry points with variables (no hand SQL/credential copy):

```sh
# 1. install root from the exact package, new empty state root, project id/paths from restored data
node <package>/tools/dev/review-restored.mjs --state "$RESTORED" --project "$PROJECT" \
  --allow-path "$ALLOW" [--exclude-path "$EXCLUDE"] --output "$REVIEW"
# 2. start through the package's actual entry (pnpm start or package demo), format chosen before snapshot
# 3. snapshot creation: formatVersion omitted => workflow-v1; formatVersion:2 => explicit v2
# 4. verify and copy to a fresh root, then start personal readonly with --review-restored-scope "$REVIEW"
# 5. read candidates/history/sources; business POST must stay refused and queue/provider unchanged
```

Required driver inputs: package/install root, producer source SHA, restored state root, project id,
allow/exclude paths, format version, ports, review file output, and exact consumer entry. Source-only
tests do not certify an installed package; D/E must compare consumer bytes/hash to the package.

## B attach dependency

B has not delivered the same-Runner business-attach port. A5 (new coordinator results landing in the
original A store with idempotent `native_applied`/unknown) is therefore **NOT_REACHED**; the read
recipe above is ready for it. Do not mark an `inspect/cancel` wrapper as business resume.
