# Blockers found by native acceptance (Agent B)

Only owned path is `tests/native-acceptance/`. Each blocker has the exact input, expected vs actual,
a minimal reproduction and the API needed to continue.

---

## BLOCKER-1 (owner: main) — candidate artifact carries no diff, and location is empty

**Severity:** high — the delivered work cannot be reviewed or roundtripped, which is the core of the
"review the complete patch, then accept" acceptance step.

**Reproduction**

```sh
# 1. start a private native instance
node apps/coordinator/product/demo.ts --native --port 8899 --state /tmp/pa-native

# 2. create_work + continue_work (harness does this)
node tests/native-acceptance/run.mjs --url http://127.0.0.1:8899 \
  --state /tmp/pa-native --run-native

# 3. read the work's first artifact
curl -H "authorization: Bearer $(cat /tmp/pa-native/api.key)" \
  http://127.0.0.1:8899/v1/artifacts/<first artifactId>
```

**Observed**

```json
{
  "kind": "product-artifact/1",
  "artifactDigest": "b7170201...",
  "baseCommit": "f82eb759f3cc7c19d4cef30c5c9e98acdb44c426",
  "headCommit": "f82eb759f3cc7c19d4cef30c5c9e98acdb44c426"
}
```

- `baseCommit === headCommit`, so `git diff base head` is empty;
- the artifact has no `patch`/`diff` field;
- `GET /v1/works/:id/location` returns `{"projectPath":"...","workspacePath":null,"baseCommit":null}`.

**Expected**

- `headCommit` differs from `baseCommit` when the agent changed files, **or** the artifact exposes the
  unified diff directly;
- `GET /v1/works/:id/location` returns the detached worktree path and its base commit while the work
  is in `needs_user`, so a reviewer can inspect exactly what changed.

**Impact on acceptance**

`NATIVE-LINK` can prove: delegation recorded, real Codex executed, machine check PASS (2/2 tests),
candidate reached. It **cannot** prove: patch roundtrip, "original project unchanged" comparison,
stale-candidate rejection. Those stay NOT_TESTED until the artifact/location contract carries the
real diff.

**API needed to continue**

1. artifact fields `baseCommit`/`headCommit` (or `patch`) reflecting the attempt's worktree state; and
2. `/v1/works/:id/location` returning `workspacePath` + `baseCommit` while the work is open.

---

## BLOCKER-2 (owner: main) — `create_work` alone does not start execution

**Observed:** `create_work` returns a recorded receipt and the work stays without an attempt until a
separate `continue_work` command is sent.

**Impact:** the harness had to send a second command. This is workable but should be explicit in the
product handoff: a UI that only shows "delegated" after `create_work` would mislead the operator.

**API needed:** none; document the two-step contract (or accept `autoContinue` in `create_work`).

---

## BLOCKER-3 (owner: main / environment) — Playwright is not installed

**Observed:** `require.resolve('playwright')` fails in this worktree; there is no `playwright`
binary in `node_modules/.bin`. `apps/console/e2e/*.mjs` exist but cannot run.

**Impact:** B4 (real browser regression at 1440×900 and 390×844, download roundtrip through the
same-origin proxy, SSE reconnect) is **NOT_TESTED**. Installing a browser dependency is a root
lockfile change, which is main-owned, so this cannot be resolved from the acceptance directory.

**Needed:** main adds `playwright` (or provides an existing browser driver) and states the launch
command for the console dev server; the acceptance harness then drives the published UI.
