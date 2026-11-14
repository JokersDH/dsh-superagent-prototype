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
| `facts.ts` | `project-facts/1` | Only names, digests, counts and closed-enum flags of an observation. No script bodies, argv, absolute paths or credentials. |
| `catalog.ts` | `project-recipes` v1 | Three versioned kinds: `regression_fix`, `scoped_change`, `verification_followup`. |
| `match.ts` | pure function | `matchRecipe({ facts, configuration, kind, selection, now })` → deterministic result. |
| `draft.ts` | `project-recipe-draft/1` | Result schema plus `draftRevision` / `parseProjectRecipeDraft`. |
| `preview.ts` | `project-recipe-create-work-fields/1` | Reshape a `draft` into the existing `create_work` command input, and refuse stale inputs. |

## Guarantees

- **Deterministic.** No clock, environment, filesystem or network access inside `matchRecipe`; `now`
  is an input. Identical input yields identical bytes and `revision`.
- **References already exist.** Project id, scope paths, profile and criteria come from the current
  configuration; a machine criterion must name a check that the configuration lists as registered.
  Nothing is inferred from repository text.
- **Never widens.** Scope paths may only narrow (or equal) the configured project scope, exclusions
  may only grow, `externalActions` is always empty, and no fallback profile/fixture/agent is chosen.
- **Unknown stays unknown.** An unobserved stack, manager, lockfile pair or workspace layout becomes
  `needs_input`/`unsupported`; it never becomes an executable default.

## Result statuses

| Status | Meaning | Consumer action |
| --- | --- | --- |
| `draft` | Complete suggestion: `goal`, `scope`, `criteria`, `profileId`. | Prefill the existing form; require explicit confirmation. |
| `needs_input` | Correctable: explicit paths, profile, criteria, or a facts refresh. | Ask the user; do not guess. |
| `unsupported` | The request class is not served (non-Node stack, unsupported manager, unknown project/version). | Explain; do not substitute another executor. |

`RecipeInputError` (`invalid_facts`, `unknown_kind`, `invalid_clock`) is a caller bug, not a product
answer: the input could not even be interpreted.

## Use

```ts
import { matchRecipe, parseProjectRecipeDraft, previewInputs } from '@personal-agent/project-recipes'

const result = matchRecipe({
  facts,                 // project-facts/1
  configuration,         // public ApplicationConfiguration projection
  kind: 'regression_fix',
  selection: { paths: ['src/parser.ts'] },
  now: '2026-11-14T12:00:00.000Z',
})

const draft = parseProjectRecipeDraft(result)   // verifies the revision
if (draft.status === 'draft') {
  const fields = previewInputs(draft, { configuration, facts })  // throws when inputs went stale
  // hand `fields` to the existing delegation form / create_work confirmation
}
```

CLI (read-only): see `tools/project-recipes/cli.ts` and `docs/project-recipes/README.zh-CN.md`.

## Development

```sh
pnpm --dir packages/contracts build          # workspace dependency used for types and schemas
pnpm --dir packages/project-recipes typecheck
pnpm --dir packages/project-recipes test
pnpm --dir packages/project-recipes build
```

The package is private and ships from `src/`; `dist/` is not tracked.

## Ownership

`packages/project-recipes/`, `tools/project-recipes/`, `docs/project-recipes/` and
`reports/project-recipes/` only. Root workspace/lock, the public contracts and the App/HTTP
integration stay with main; product-acceptance assertions stay with E.
