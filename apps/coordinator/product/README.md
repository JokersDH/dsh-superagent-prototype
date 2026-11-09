# Controlled Product API

This development entry consumes the real core execution queue. It launches an actual fixed scratch subprocess, routes a structured native question through the SQLite QuestionBroker, freezes the artifact after an authenticated owned-resource barrier, runs the registered check, and accepts only the current verified candidate.

It calls no vendor or model. Every profile is explicitly named `profile-fixture-*`. The subprocess only performs a fixed scratch-file operation; user text is data and is never evaluated as code or a shell command. The controlled host runs inside the coordinator, so coordinator SIGKILL leaves its prior writer uncertain. Independent Runner reconnect remains a separate integration lane.

## Run

Use Node 24.22.2 and pnpm 11.7.0, with the SQLite native dependency available. From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:g2-product
pnpm --filter @personal-agent/coordinator dev:product
```

Defaults: `http://127.0.0.1:8791`, private state at the repository's `.local-state/product-demo`, allowed console origin `http://127.0.0.1:5174`. Override with `--port`, `--state`, and `--console-origin`.

The first start creates a disposable Git project under `/tmp/pa-project-*`, outside the product checkout, and records its location in private state. Each attempt gets a detached worktree under the private workspace root. Keep that temporary project while using the corresponding state. The launcher never selects a user project, merges changes, or installs a vendor agent.

In another terminal, execute the complete authenticated loopback smoke:

```sh
node tools/bootstrap/smoke-product-api.mjs
```

It reads the private API credential locally, creates one fixed scratch work in `conv-main`, answers its question, reads the verification and output, accepts the current candidate, and prints only public result IDs. Credentials are never printed. The original queue-only `dev:api` sandbox on 8787 remains a separate entry.

## Integration Parameters

| Input | Accepted Values |
| --- | --- |
| Project in the demo | `project-atlas` |
| Scope | Exactly `allowedPaths: ['src/']`, empty exclusions and external actions; optional unexpired grant deadline |
| Profiles | `profile-fixture-question`, `profile-fixture-pass`, `profile-fixture-fail`, `profile-fixture-slow` |
| Required machine check | `check-fixture-output` |
| Optional required human criterion | Any unique schema-valid criterion ID |
| Question answer | Exact original version/target and `choices` option `allow` or `deny` |
| Authentication | Existing `POST /v1/session` local bootstrap or local API bearer credential |

The HTTP request and snapshot schemas are unchanged. Existing `/v1/commands`, `/v1/snapshot`, `/v1/works/:id`, `/v1/events`, `/v1/questions/:id/deliveries`, `/v1/verifications/:id`, and `/v1/artifacts/:id` serve this composition.

Agent A's current console defaults to `profile-codex-local` and other fixture check IDs. Its product integration must use the explicit parameters above, preferably through the upcoming public Catalog/configuration read surface. A successful fixture console report alone does not show that this backend was used.

## Code Map

| File | Responsibility |
| --- | --- |
| `runtime.ts` | Composes application, WP-04 workspace/verifier, fixed check registration and authorized detail readers |
| `execution.ts` | Consumes durable core intents, original input/command indexes, Broker transport, fact reducers and verification intents |
| `controlled-attempt.ts` | Per-attempt ProcessHost, complete retained resource inventory, authenticated recovery endpoint and closed admission |
| `fixture-driver.ts` | Frozen Driver v1 protocol adapter; ACKs actual writes and original native answer consumption |
| `fixture-agent.ts` | Fixed scratch subprocess; real stdio and file operation, no model |
| `completion.ts` | Immutable artifact bytes, trusted WP-04 evidence, read-only review index and acceptance preflight |
| `scratch.ts` | Creates the disposable scratch project outside the product repository |
| `demo.ts` | Local HTTP process, private credentials and writer lock |

## Safety And Recovery

- Ticket/Assignment remains the only execution lifecycle. These adapters store physical bindings, immutable command indexes, artifacts and evidence; they add no Work state machine.
- The stable preparation/start checkpoint commits before physical launch. Replaying a queue row never launches its attempt again. Unknown sends park for reconciliation. Up to four controlled attempts may be live.
- Every process registers in the authoritative binding before receiving begin. Resource identities remain in the complete inventory after ProcessHost drops exited handles. Only confirmed owned-process evidence can release the binding.
- Broker marks its write intent immediately before the actual response write. A feed into a command queue is not a physical write ACK. Original binding, connection epoch and lossless integer/string RPC identity are preserved.
- The question/read/answer reducers join the same SQLite transaction as the authoritative fact receipt. A failed receipt leaves no phantom question or input-consumption update.
- Required machine FAIL never delivers. Human acceptance cannot override it. Machine-only contracts do not create empty human-acceptance records.
- Verification starts after the physical barrier and guards the artifact before/after checking and while collecting bytes. Acceptance preflight reads immutable files outside the command transaction; the transaction rechecks current candidate and evidence. Delivered artifact references survive refresh/reopen.
- Verification intents contain their committed barrier reference and can finish after reopen without relaunching a native process. A SIGKILL with an unproven live writer instead stays uncertain and cannot retry.

The generic WP-04 Git patch currently omits untracked file contents, and its content-addressed workspace manifest can retain an earlier attempt ID when two attempts produce identical content. This controlled composition publishes its fixed output bytes and a current-candidate delivery manifest, alongside patch and check evidence. Generalizing delivery to arbitrary new files requires Agent A's package-level fix and acceptance; this is not a generic archive implementation.

## Measured Scope

`pnpm check:g2-product` validates 134 cases: the prior 90 application/Broker/HTTP/recovery cases, 8 workspace cases, 22 verification cases, and 14 controlled product integration cases. See `reports/releases/g2-product.json` for the actual run and environment.

The 14 new cases include real subprocess I/O, question/answer, duplicate native IDs across attempts, supplements, machine FAIL/PASS, human acceptance, pause during asynchronous launch, stop/revise, receipt rollback, artifact mutation, receipt/verification recovery, authenticated HTTP and one real coordinator SIGKILL window. The SIGKILL case proves no duplicate begin and truthful uncertainty, not independent Runner survival. Browser product acceptance, installed vendors, power loss and load/soak are not certified.
