# Candidate Admission And Controlled Workbench

Date: 2026-11-09. Owner: main. Base: `d7f3401`. Sources reviewed: A `a517635` (implementation `6c8dfc8`), B `96cbe4e`. Active A/B checkouts were not edited.

## Accepted Scope

A's `apps/console/` and WP-11 documentation are imported byte-identically from the committed checkpoint. Independent review passed console 8 cases, typecheck and production build. Main now supplies `pnpm dev:workbench`: start the admitted controlled API, read its authenticated configuration, then start Vite with matching fixture defaults. This compatibility projection does not replace A's assigned direct dynamic configuration transport.

Main's browser checks cover actual login, delegation, native question, active-page refresh preserving the original target, answer, registered verification, output preview, current-candidate acceptance/reload, machine FAIL and desktop/narrow screenshots. The workbench uses the already admitted controlled host; no candidate B runtime or generic workspace fix is enabled by these browser results. Launch instructions: [受控工作台](../../WORKBENCH.zh-CN.md).

## Blocked Candidate Findings

The candidates' ordinary suites pass: A workspace 10 + verification 22 + console 8; B DriverKit 18 + execution 44 + testing 8 + Runner 110 + Catalog 17 + policy 9 + Codex protocol fixture 16 = 222. Two prior Journal probe sets also pass. The additional admission cases below fail and prevent generic workspace/runtime admission.

| Owner | Case | Observed Result |
| --- | --- | --- |
| A | `PATCH-MIXED-STAGED-AND-UNTRACKED` | A newly staged file disappears from the delivery patch when an untracked file is also present; the user's index stays intact |
| A | `PATCH-INCLUDES-COMMITS-SINCE-RESERVE-BASE` | An agent commit moves attempt HEAD beyond the reserve base; freeze returns a zero-byte patch for the committed deliverable |
| B | `DIRECT-MAIN-CLIENT-RECOVERY-CREDENTIAL` | Endpoint writes 65 bytes including newline; actual main client requires a private 64-byte credential and refuses it |
| B | `ACTUAL-SERVICE-LIVE-INVENTORY` | Actual child is alive, but the default service reports `terminated` and an empty complete inventory |
| B | `INDETERMINATE-CLEANUP-CANNOT-MINT-BARRIER` | With an injected indeterminate stop, a real private scratch writer keeps writing, yet the service supplies a terminated/closed/empty proof accepted by the main barrier |
| B | `CLOSED-RECOVERY-ADMISSION-CLOSES-BUSINESS-PUMP` | The endpoint says admission is closed; a later deliver frame still reaches the Driver |
| B | `RECOVERY-CANCEL-REQUIRES-FULL-ATTEMPT-IDENTITY` | A schema-valid cancellation naming another ticket reaches the stop callback and returns 200 |
| B | `JOURNAL-CORRUPTION-AFTER-OPEN-REFUSES-ALL-REPLAY` | A full corrupt tail added after open still allows one sink call from the apparently valid prefix |

For B's later service cases only, the probe uses a separate private 64-byte reference to the same fixture key after recording the real main-client failure. B's credential file and candidate sources are unchanged. This keeps each subsequent invariant independently measurable; it is not a production credential workaround.

The physical-stop case is fault injection in the review process, not a host outage or vendor test. It uses an actual harmless child writing only to a private temporary file and calls the actual main `confirmOwnedQuiescence`. The endpoint omits that child because default service wiring creates a different ProcessHost for inspection. Its state function also treats existence of the running Promise as termination. Main must not register this backend as trusted until its inventory, admission and stop evidence reflect the real AttemptRunner.

Evidence: `reports/releases/wave-02-delivery-runtime-admission.json`. Exit code 1 is the expected blocked-admission result for these candidate commits. The root controlled product's passing checks remain a separate scope.

## Owner Follow-Through

**A:** Keep the existing untracked/binary and neutral-manifest fixes, and complete patch roundtrip coverage for mixed staged/untracked files, staged additions/renames, and changes committed since the reserved base. Delivery must reconstruct the full frozen result without modifying the user's worktree/index. Continue the assigned dynamic configuration/browser package. Visual review of the admitted checkpoint also shows a narrow send button wrapping its label vertically; address this with the existing responsive/error-state pass, not a new design system.

**B:** Finish the existing runtime package with one real ProcessHost/inventory, accurate serving/terminal state, irreversible shared admission used by the business pump, no fake empty-inventory proof, full cancellation identity checks and fresh whole-file Journal verification before replay. Preserve the main protocol rather than weakening its credential, identity, resource or ACK checks. Payload refs/fsync and the complete authenticated launcher/resource-registration interface remain part of the same package. Catalog/native fixture passes do not admit the service.

**Main:** Consume only committed, independently accepted changes. Keep product/Broker/core/registration and final cross-module composition here. Do not adapt around false physical proofs or mark a missing inventory as stopped. The admitted console preview can progress independently of generic patch and Runner admission.

Each owner can run its selected cases independently after merging the main tool:

```sh
# Agent A checkout
node tools/bootstrap/review-wave02-delivery-runtime.mjs --only workspaces --workspaces "$PWD"

# Agent B checkout
node tools/bootstrap/review-wave02-delivery-runtime.mjs --only runner --runner "$PWD"
```

Use `--record` only from main for the combined release report. Owner evidence belongs in its existing progress report and owned evidence directory. These cases extend the current outcome-based packages; no per-defect redispatch or root schema fork is required.
