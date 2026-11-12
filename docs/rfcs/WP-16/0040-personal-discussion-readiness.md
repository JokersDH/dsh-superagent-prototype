# 0040: Personal startup with unavailable execution

2026-11-12. Wave-13 M1 runnable main checkpoint, based on `30ecd70`.

## Product entry

`node tools/dev/workbench.mjs --state <private-state> --port <ui-port> --api-port <api-port>` still selects personal mode. Missing Codex, an unadmitted version/platform or a failed version probe now starts discussion and history instead of exiting. No controlled fixture is selected on this path. `--discussion-only` explicitly selects the same execution-disabled personal mode and avoids even the version probe. It is incompatible with `--fixture`.

The coordinator entry is `node apps/coordinator/product/demo.ts --native --assistant --state <private-state>`; `--discussion-only --assistant` explicitly disables execution. The configured discussion provider is unchanged. Missing model configuration still requires ordinary configuration before a reply. Discussion startup does not require Git, create a global starter repository or resolve package-manager commands.

Every personal instance exposes the permanent `project-personal-dialogue` workspace. It remains a discussion workspace when native execution later becomes available, so that its conversations remain discoverable. Existing private project registry entries remain readable; corrupt registry data fails startup and releases this attempt's writer lease instead of becoming an empty registry.

## Public contract and enforcement

`application-configuration/1` gains optional `executionAvailability` (`available/native`, `available/controlled_fixture` or `unavailable` with a safe reason) and project `discussionOnly`. Public output never includes executable paths or raw probe errors. Unavailable configuration has no admitted project/profile/check; the blocked Codex diagnostic remains visible. These additions do not change the frozen Runner/data wire.

The application receives a trusted startup `executionEnabled` flag. When false, only unanchored ordinary chat is allowed among work commands. New/revised/continued work, answer, stop, retry, dispatch control, candidate acceptance, verification retry and work-anchored chat are refused before their effects. Prior receipts can still be looked up or replayed; a historical recorded receipt is not new execution permission. A discussion-only workspace cannot create work even in an otherwise enabled runtime. Context/history/decision flows retain their own existing authorization.

Unavailable startup constructs only the existing Effects consumer with assistant reply handlers, not ProductExecution. Old assignment/answer/verification/reconcile rows have no registered handlers and retain their exact queue state. It uses the same Store/UOW; there is no new ledger or lifecycle. Replies are limited to configured projects and retain the existing persistent result/unknown-send behavior.

Unfinished old work remains visible with no execution actions and conservative uncertain/indeterminate resource status. This is not a claim that an old native writer stopped. Source/target recovery, actual process ownership and activation remain separate gates. Restore markers still force recovery-readonly startup, disabling the provider and business queues; no marker, account, queue or old state is removed to permit startup.

## Validation scope

- 2 contract tests: unavailable/available admission consistency and permanent discussion workspace rules.
- 7 real Store/runtime cases: safe classified fallback, corrupt registry, chat/result persistence, old queue/binding preservation, all controls denied, selected-context history and discussion workspace refusal with execution enabled.
- 8 actual coordinator/workbench process cases: missing/incompatible/probe-error/operator modes, no admitted project, no Git requirement, restore marker retention, failed startup lease release, and a real existing Work/queue/receipt reopened in unavailable mode.
- Existing contracts 228, application 20 and six product/assistant/context/process suites 77 pass; coordinator and console strict typechecks and generated-contract check pass. Frozen wire hash remains `74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`.

All replies in these tests use an isolated local mock. Fake Codex supports only `--version` and records any non-version launch as a failure. Automatic real model/native turns remain 0. Browser verification and an optional isolated preview follow this checkpoint; this is not an installer, target activation, native control or whole-release verdict. Existing ten user instances remain untouched.
