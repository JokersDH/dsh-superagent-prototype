# Controlled Product API

The fixture API below remains available for regression. The default personal workbench now passes
`--native --assistant --local-access` and uses `createProductRuntime`: imported Git projects, the real
Codex 0.164.0 Driver on an independent Runner, applied native policy, registered checks, complete patch
delivery and current-candidate acceptance. See [the current user guide](../../../docs/ASSISTANT-GUIDE.zh-CN.md)
and [native MVP integration](../../../docs/rfcs/WP-16/0008-native-mvp-integration.md). `createControlledProduct`
is retained as a compatibility alias; omitting `native` still selects only the controlled lane.

This development entry consumes the real core execution queue. It launches an actual fixed scratch subprocess, routes a structured native question through the SQLite QuestionBroker, freezes the artifact after an authenticated owned-resource barrier, runs the registered check, and accepts only the current verified candidate.

By default it calls no vendor or model. `--assistant` optionally enables durable model dialogue through a private local configuration; the workbench launcher enables this option. Every execution profile is explicitly named `profile-fixture-*`. The subprocess only performs a fixed scratch-file operation; user text is data and is never evaluated as code or a shell command. The controlled host runs inside the coordinator, so coordinator SIGKILL leaves its prior writer uncertain. Independent Runner reconnect remains a separate integration lane.

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

The HTTP command and snapshot schemas are unchanged. Authenticated `/v1/configuration` now publishes supported projects, selectable fixture profiles and registered default criteria; use it before constructing a work command. Existing `/v1/commands`, `/v1/snapshot`, `/v1/works/:id`, `/v1/events`, `/v1/questions/:id/deliveries`, `/v1/verifications/:id`, and `/v1/artifacts/:id` serve this composition.

The integrated console consumes `/v1/configuration` in place of hard-coded profile/check defaults. See [the shared read interface](../../../docs/rfcs/WP-16/0004-application-configuration.md). A successful fixture console report alone does not show that this backend was used. Native Catalog/backend admission remains separate.

Optional assistant endpoints are authenticated: `GET /v1/assistant` returns safe status, `POST /v1/assistant/model` accepts only a configured model ID, and `GET /v1/guide` downloads the usage guide. Keys and gateway changes remain private local configuration, never browser DTOs. See [the user guide](../../../docs/ASSISTANT-GUIDE.zh-CN.md).

## Code Map

| File | Responsibility |
| --- | --- |
| `runtime.ts` | Composes application, WP-04 workspace/verifier, fixed check registration and authorized detail readers |
| `configuration.ts` | Safe project/profile/check projection from actual runtime admission, with registered defaults and expiry |
| `execution.ts` | Consumes durable core intents, original input/command indexes, Broker transport, fact reducers and verification intents |
| `controlled-attempt.ts` | Per-attempt ProcessHost, complete retained resource inventory, authenticated recovery endpoint and closed admission |
| `fixture-driver.ts` | Frozen Driver v1 protocol adapter; ACKs actual writes and original native answer consumption |
| `fixture-agent.ts` | Fixed scratch subprocess; real stdio and file operation, no model |
| `completion.ts` | Immutable artifact bytes, trusted WP-04 evidence, read-only review index and acceptance preflight |
| `scratch.ts` | Creates the disposable scratch project outside the product repository |
| `demo.ts` | Local HTTP process, private credentials and writer lock |
| `model-provider.ts` | Private model configuration, safe status and single OpenAI-compatible SDK completion |
| `assistant-replies.ts` | Durable reply intent, bounded conversation context and no automatic repeat billing after uncertain results |
| `native-attempt.ts` | Independent Runner launch, authenticated registration, immutable payload transfer and original answer-write gate |
| `native-startup.ts` | Locally admitted Codex version, native project defaults and private worktree root |
| `project-registry.ts` | Explicit local Git import and registered check presets, private durable configuration |

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

`pnpm check:g2-product` validates 188 contract cases plus 162 product cases: 96 application/Broker/HTTP/recovery cases, 8 workspace cases, 22 verification cases, 14 controlled product integration cases, 5 configuration/HTTP cases and 17 assistant cases. Assistant tests use a local mock SDK endpoint; actual provider connectivity is a separate manual smoke. See `reports/releases/g2-product.json` for the actual run and environment.

The model SDK uses streaming completions. Authenticated `GET /v1/assistant/stream?conversationId=...` publishes bounded in-memory cumulative display snapshots. Refresh can resume a live partial reply without restarting inference; the final message is committed only after completion. Shutdown aborts pending inference, and uncertain requests are never automatically charged again. Work-anchored text is excluded from ordinary model context. `pnpm check:assistant-browser` verifies the full SDK/effect/SSE/UI path with an isolated local model fixture.

The 14 new cases include real subprocess I/O, question/answer, duplicate native IDs across attempts, supplements, machine FAIL/PASS, human acceptance, pause during asynchronous launch, stop/revise, receipt rollback, artifact mutation, receipt/verification recovery, authenticated HTTP and one real coordinator SIGKILL window. The SIGKILL case proves no duplicate begin and truthful uncertainty, not independent Runner survival. Browser product acceptance, installed vendors, power loss and load/soak are not certified.
