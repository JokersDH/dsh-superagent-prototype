# Native MVP acceptance (external Agent B)

Ownership: **only** this directory. Product code (runner/driver/core/HTTP/console/schema/root lock) is
owned by the main line; this harness reports failures with a minimal reproduction instead of
changing the product or lowering expectations.

## Lanes

| Lane | When | What it proves |
| --- | --- | --- |
| read-only | default | The product's authenticated configuration boundary is honest: no-store, no backend-only identity fields, fixtures never presented as native |
| native | `--run-native` | Real delegation against a private scratch project with the real Codex driver |

The native lane **refuses to run** unless `GET /v1/configuration` publishes a `kind: native` profile
with `dispatchAllowed: true`. It never substitutes a `profile-fixture-*` profile, because a fixture
run would look like native evidence.

## Run

```sh
# read-only against a running product
node tests/native-acceptance/run.mjs \
  --url http://127.0.0.1:8796 \
  --state /absolute/private/product-state

# native lane (requires an admitted native profile)
node tests/native-acceptance/run.mjs --url ... --state ... --run-native

# harness self-test (no product required)
node --test tests/native-acceptance/selftest.mjs
```

Records are written with `--record tests/native-acceptance/reports/<name>.json`. Reports contain
case status, evidence and entity ids only — never credentials, session dumps or databases.

## Product prerequisites the native lane needs

These are **not published** by the current product build; until they are, the native lane reports
`NOT_TESTED` rather than failing:

1. an admitted `profile-codex-native` in `/v1/configuration`;
2. `POST /v1/projects` — register a private, committed Git scratch project;
3. `GET /v1/works/:id/location` — `{projectPath, workspacePath, baseCommit}`;
4. a native dispatch entry that launches the Codex driver instead of the fixture subprocess.

## Case map

| Case | Proves |
| --- | --- |
| `HARNESS-AUTH` | the harness can authenticate (session or bearer) |
| `CONFIG-READ` | authenticated `no-store` configuration read |
| `CONFIG-NATIVE-ADMISSION` | the product states exactly which profiles may dispatch |
| `CONFIG-NO-RAW-IDENTITY` | no executable/argv/native config/ policy revision leak |
| `CONFIG-FIXTURE-NOT-NATIVE` | fixture profiles are declared controlled fixtures |
| `NATIVE-LINK` | real Codex edits an isolated worktree, check PASSes, candidate accepted |
| `NATIVE-STOP` | stop is proven by process/descendant exit, not by a native ACK |
| `NATIVE-REOPEN` | browser reopen does not resend begin; the executor is preserved |
| `NATIVE-RESTART` | coordinator restart does not start a second physical writer |
| `NATIVE-STALE-CANDIDATE` | a modified current candidate cannot be accepted |
| `NATIVE-CHECK-FAIL` | a required machine FAIL cannot be bypassed by human acceptance |
| `NATIVE-QUESTION` | a real question is answered per request/attempt/epoch/contract |

Fixture-based checks may assist localization, but they are listed separately and never counted as
native evidence.
