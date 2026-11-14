/**
 * Explicitly observed project facts (protocol `project-facts/1`).
 *
 * This module holds no observation code: a caller that already holds an authorized, public
 * observation (for example the coordinator's existing project settings/registration record, or
 * `tools/project-recipes` reading an allow-listed metadata file under an explicitly authorized
 * root) hands the facts in. Nothing here discovers paths, reads the home directory or environment,
 * executes a package manager, or treats repository text as a command.
 *
 * Only names, digests, counts and closed-enum flags are represented. Script *bodies*, argv,
 * absolute paths and credentials never appear in the contract, so a caller cannot accidentally
 * promote untrusted repository text into an executable suggestion.
 */
import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from '@personal-agent/contracts'

export const PROJECT_FACTS_PROTOCOL = 'project-facts/1' as const

/** Lockfile names this product already understands; anything else is simply not observed. */
export const KNOWN_LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lockb'] as const
export type KnownLockfile = (typeof KNOWN_LOCKFILES)[number]

/** Marker files whose presence alone proves the root is not a Node package. */
export const FOREIGN_STACK_MARKERS = ['pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle'] as const
export type ForeignStackMarker = (typeof FOREIGN_STACK_MARKERS)[number]

/** Conservative script-name alphabet: untrusted names outside it are counted, never echoed. */
const ScriptNameSchema = z.string().regex(/^[A-Za-z0-9:._-]{1,128}$/)

export const FactsProvenanceSchema = z.strictObject({
  /** `injected` means the caller observed the project elsewhere; `authorized_metadata` is this product's README/CLI reader. */
  source: z.enum(['injected', 'authorized_metadata']),
  /** Who produced the observation, e.g. `coordinator-project-settings/1` or `project-recipes-cli/1`. */
  provider: z.string().trim().min(1).max(160),
  /** Observation is data only; it never carries or implies execution authority. */
  authority: z.literal('none'),
  scope: z.enum(['package', 'workspace_root', 'workspace_member', 'unknown']),
  /** Digests of the exact metadata inputs the observation was derived from (sorted by caller). */
  inputs: z.array(DigestSchema).max(16).readonly(),
})

/**
 * Node is the only stack this product supports. A manager is `pnpm`/`npm` when declared or implied by
 * exactly one known lockfile, `none` when neither exists, `unsupported` for a declared non-Node manager,
 * and `unknown` when the caller simply could not observe it.
 */
export const FactsManagerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pnpm'), declaredVersion: z.string().trim().min(1).max(64).optional() }),
  z.strictObject({ kind: z.literal('npm'), declaredVersion: z.string().trim().min(1).max(64).optional() }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('unsupported'), name: z.enum(['yarn', 'bun', 'other']) }),
  z.strictObject({ kind: z.literal('unknown'), reason: z.enum(['unobserved', 'ambiguous_lock']) }),
])

export const FactsStackSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('node'),
    /** Raw `packageManager` declaration (e.g. `pnpm@11.7.0`), reported verbatim but never executed. */
    packageManagerField: z.string().trim().min(1).max(120).optional(),
    /** Raw `engines.node` range; the reader does not resolve it against a runtime. */
    enginesNode: z.string().trim().min(1).max(200).optional(),
  }),
  z.strictObject({ kind: z.literal('not_node'), markers: z.array(z.enum(FOREIGN_STACK_MARKERS)).max(FOREIGN_STACK_MARKERS.length).readonly() }),
  z.strictObject({ kind: z.literal('unknown'), reason: z.enum(['unobserved', 'unparsable']) }),
])

export const ProjectFactsSchema = z
  .strictObject({
    protocol: z.literal(PROJECT_FACTS_PROTOCOL),
    /** Existing configured project identity this observation belongs to. */
    projectId: IdSchema,
    observedAt: TimestampSchema,
    provenance: FactsProvenanceSchema,
    stack: FactsStackSchema,
    manager: FactsManagerSchema,
    locks: z.array(z.strictObject({ name: z.enum(KNOWN_LOCKFILES), digest: DigestSchema.optional() })).max(KNOWN_LOCKFILES.length).readonly(),
    workspace: z.strictObject({
      /** `package_json_workspaces` covers both the array and object shapes; members are not enumerated. */
      declaration: z.enum(['none', 'package_json_workspaces', 'pnpm_workspace_yaml', 'unknown']),
    }),
    /** Script *names* only, sorted and unique. Bodies are never observed. */
    scripts: z.array(ScriptNameSchema).max(512).readonly(),
    /** Declared language markers. `node` always accompanies a Node stack. */
    languages: z.array(z.enum(['node', 'typescript', 'javascript'])).max(8).readonly(),
    /** Fields the observer could not provide; a gap is a gap, never an empty value. */
    missing: z.array(z.enum(['packageJson', 'lockfile', 'manager', 'enginesNode', 'scripts', 'workspace'])).max(8).readonly(),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.locks.map((lock) => lock.name)).size !== value.locks.length)
      ctx.addIssue({ code: 'custom', message: 'Lockfile names must be unique' })
    if (new Set(value.scripts).size !== value.scripts.length)
      ctx.addIssue({ code: 'custom', message: 'Script names must be unique' })
    if (new Set(value.languages).size !== value.languages.length)
      ctx.addIssue({ code: 'custom', message: 'Languages must be unique' })
    if (value.stack.kind === 'node' && !value.languages.includes('node'))
      ctx.addIssue({ code: 'custom', message: 'A Node stack must declare the node language marker' })
    if (value.stack.kind !== 'node' && value.languages.length > 0)
      ctx.addIssue({ code: 'custom', message: 'Language markers belong only to an observed Node stack' })
  })

export type ProjectFacts = z.infer<typeof ProjectFactsSchema>
export type FactsProvenance = z.infer<typeof FactsProvenanceSchema>
export type FactsManager = z.infer<typeof FactsManagerSchema>
