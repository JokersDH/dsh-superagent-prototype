# `@personal-agent/project-recipes`

Deterministic project task/check declaration templates for the existing product flow.

A caller supplies **explicitly observed project facts** and the **current public
`ApplicationConfiguration`**, plus one task kind and explicit selection. The package returns one of
three results — `draft`, `needs_input`, `unsupported` — carrying provenance, the configuration
revision, the facts digest, a content-addressed `revision`, and `authorization: "none"`.

It is data, not execution: nothing here installs, runs or registers a check, starts a model or
agent, writes SQL, or creates another execution lifecycle. A draft becomes work only after the
application's existing preview and explicit user confirmation.

## Layers

| Module | Contract | Purpose |
| --- | --- | --- |
| `facts.ts` | `project-facts/1` | Only names, digests, counts and closed-enum flags of an observation, plus `factsContentDigest` (stable content, timestamp excluded). No script bodies, argv, absolute paths or credentials. |
| `observe.ts` | `project-facts-observer/1` | Bounded read-only metadata observation (NOFOLLOW, dev/ino/size/mtime identity checks) plus the registered-root port main consumes. |
| `scope.ts` | — | Declared-atom scope rules, mirroring the application's own `scopeWithin`. |
| `catalog.ts` | `project-recipes` v1 | Three versioned kinds: `regression_fix`, `scoped_change`, `verification_followup`. |
| `match.ts` | pure function | `matchRecipe({ facts, configuration, kind, selection, now })` → deterministic result. |
| `draft.ts` | `project-recipe-draft/1` | Result schema plus `draftRevision` / `parseProjectRecipeDraft`. |
| `preview.ts` | `project-recipe-create-work-fields/1` | Reshape a `draft` into the existing `create_work` command input, with precise stale-input refusal. |
| `rebind.ts` | `project-facts-rebind/1` | Compare a previous observation with a re-observed root: `current`/`changed`/`unbound`/`reidentified`, field-level changes, no root or grant in the report. |
| `module.ts` | `project-recipes-module/1` | Deterministic self-description (contracts, catalog digest, vocabularies, capabilities, version) for a same-version hand-off; no path or authority. |

## Guarantees

- **Deterministic.** No clock, environment, filesystem or network access inside `matchRecipe`; `now`
  is an input. Identical input yields identical bytes and `revision`.
- **Content and time are separate, and time is always checked.** `provenance.facts.contentDigest`
  stays equal for a fresh read of unchanged bytes, so an applied draft survives re-observation, but a
  future or expired observation, an expired scope, an unsupported/malformed current configuration or
  an invalid clock is refused — omitting `now` does not skip the check. The timestamp is never an
  authorization.
- **Budgets are validated.** `MetadataLimits` must be safe integers inside `MAX_METADATA_LIMITS`;
  zero, negative, fractional, `NaN`, `Infinity` or oversized values are refused, and observations
  record field-level `omissions` with reasons instead of an empty list that looks complete.
- **References already exist.** Project id, scope atoms, profile and criteria come from the current
  configuration; a machine criterion must name a check the configuration lists as registered.
- **Scope is atom containment, not prefixes.** The application compares `allowedPaths`/`excludedPaths`
  literally, so a recipe may only pass through atoms the project already declares: `src/` stays
  `src/`, `.` stays `.`, and `src/file.ts` is *not* a narrower form of `src/`. Narrowing below a
  declared atom belongs to the original configuration/authorization flow.
- **Never widens.** Exclusions may only grow, `externalActions` is always empty, and no fallback
  profile/fixture/agent is chosen.
- **Unknown stays unknown.** An unobserved stack, manager, lockfile pair or workspace layout becomes
  `needs_input`/`unsupported`; it never becomes an executable default.

## Result statuses

| Status | Meaning | Consumer action |
| --- | --- | --- |
| `draft` | Complete suggestion: `goal`, `scope`, `criteria`, `profileId`. | Prefill the existing form; require explicit confirmation. |
| `needs_input` | Correctable: declared atoms, profile, criteria, or a facts refresh. | Ask the user; do not guess. |
| `unsupported` | The request class is not served (non-Node stack, unsupported manager, unknown project/version). | Explain; do not substitute another executor. |

`RecipeInputError` (`invalid_facts`, `unknown_kind`, `invalid_clock`) is a caller bug, not a product
answer. `MetadataRefused` covers bounded-read refusals (`symlink`, `too_large`,
`root_not_registered`, …).

## Use

```ts
import { matchRecipe, parseProjectRecipeDraft, previewInputs, createProjectFactsObserver } from '@personal-agent/project-recipes'

// Facts: injected, or observed through the registered-root port (the call carries no path).
const observer = createProjectFactsObserver({ rootFor: (id) => registry.rootFor(id) })
const { facts } = observer.observe({ projectId, observedAt: new Date().toISOString() })

const result = matchRecipe({
  facts,
  configuration,         // public ApplicationConfiguration projection
  kind: 'regression_fix',
  selection: { paths: ['src/'] },   // an atom the configuration already declares
  now: '2026-11-14T12:00:00.000Z',
})

const draft = parseProjectRecipeDraft(result)   // verifies the revision
if (draft.status === 'draft') {
  // throws stale_inputs (with the changed input) when the content or configuration moved
  const fields = previewInputs(draft, { configuration, facts })
  const edited = previewInputs(draft, { configuration, facts }, { goal: 'user-edited goal' })
  // hand `fields` to the existing delegation form / create_work confirmation
}
```

CLI (read-only): see `tools/project-recipes/cli.ts` and `docs/project-recipes/README.zh-CN.md`.

## Development

```sh
pnpm --dir packages/contracts build              # workspace dependency used for types and schemas
./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.json
node --test packages/project-recipes/test/*.case.ts
./node_modules/.bin/tsc -p packages/project-recipes/tsconfig.build.json
node packages/project-recipes/examples/preview-consumer.ts   # in-memory sample, exit 0
```

`pnpm --dir packages/project-recipes <script>` also works once main adds the package's
`pnpm-lock.yaml` importer; before that it rewrites the root lock, so the direct commands above are
the non-mutating form.

## Distribution

`exports["."]` points at `dist/index.js` / `dist/index.d.ts`; `files: ["dist", "README.md"]`.
`npm pack --dry-run` yields 38 files (~47 KB) with no `src/`, `tools/` or tests, and every `dist` import is a Node builtin, `@personal-agent/contracts`, `zod` or a sibling module (asserted by `test/distribution.case.ts`). Runtime dependencies
are `@personal-agent/contracts` (workspace) and `zod`; everything else is a Node builtin.

## Ownership

`packages/project-recipes/`, `tools/project-recipes/`, `docs/project-recipes/` and
`reports/project-recipes/` only. Root workspace/lock, the public contracts and the App/HTTP
integration stay with main; product-acceptance assertions stay with E.
