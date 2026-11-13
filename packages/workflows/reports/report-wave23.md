# Wave-23 Agent A handoff

Branch `codex/g2-workspaces-verification`; source checkpoint `0041d21`, final status this commit.
Merged main `8c8fdef`. Schema remains 18; no migration added.

## Cross-process original identity and data manifest

- `wave23-reader.mjs` is a real child Node PID. It opens the original state and reads the same attempt,
  ticket, assignment, contract, fence epoch, runner/session, current pointer, question, answer,
  delivery and observations through existing public ports. The parent proves different PIDs, identical
  IDs and unchanged delivery/observation/queue counts.
- `buildDataManifest`/`verifyDataManifest` bind source SHA, actual data root, format, source
  fingerprint, entities, command/payload digests, dispatch state, observation payload refs/SHA/bytes,
  counts and a canonical digest. A single mutation of payload digest, answer ID, data root, source
  SHA, format or source fingerprint is rejected. The sample and rejection list are in
  `wave23-process-reader.txt`.
- Intent/written/unknown/result remain distinct: command receipts are not native observation,
  `indeterminate` stays unknown, and an ended binding is not physical writer stop.

## Same real Store and both formats

The real controlled Work/Broker question/answer/native_applied plus SDK candidate/context/receipt
data remains in one Store. Default v1 and explicit v2 each create/verify/restore to fresh second roots
and personal readonly reads work/candidate/history/frozen body/delivery; business POST 422, held
queue and provider counts unchanged. `?scopeReview=1` remains explanation-only with original Scope
gate and narrow/excluded path reasons.

## Evidence

| Check | Result |
| --- | --- |
| storage | 87/87 |
| workflows | 116/116 |
| application | 20/20 |
| verification | 23/23 |
| restored personal | 12/12 |
| recovery combination | 106/106 |
| main product/history/reply | 91/91 |
| main target | 50/50 |
| candidate consumers | 31/31 |
| product execution | 20/20 |
| genuine v1 producer | 2/2 |
| typecheck/build, coordinator strict | PASS |
| packet static check | PASS |
| model/native | 0 |

## Dependencies

- B has not delivered an admitted same-Runner business attach; idempotent recovered-result landing into
  the original A Store is **NOT_REACHED**. inspect/cancel is not business resume.
- C owns the single consumer driver; A provides the producer/child reader/manifest and parameter
  variables. A source test does not certify an installed package's consumer bytes.
- Private startup permission, physical writer proof and target activation remain main-owned. D/E
  installed and independent acceptance remain separate. Twelve user services, old ledger/tar/profile
  and shared reports were untouched.
