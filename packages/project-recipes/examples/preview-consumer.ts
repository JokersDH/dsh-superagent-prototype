/**
 * Runnable consumer sample: draft → existing create_work command input.
 *
 * Self-checking; it touches nothing outside its own memory (no file, network, model, agent,
 * install, check registration or database). Run:
 *   node packages/project-recipes/examples/preview-consumer.ts
 */
import {
  matchRecipe,
  parseProjectRecipeDraft,
  previewInputs,
  toCreateWorkCommand,
  type CreateWorkFields,
} from '../src/index.ts'

const NOW = '2026-11-14T12:00:00.000Z'

const configuration = {
  protocol: 'application-configuration/1',
  revision: 'c'.repeat(64),
  executionAvailability: { state: 'available', kind: 'native' },
  projects: [{
    id: 'project-alpha',
    displayName: 'Alpha 服务',
    scope: { projectId: 'project-alpha', allowedPaths: ['src', 'test'], excludedPaths: ['src/generated'], externalActions: [] },
    profileIds: ['profile-native'],
    defaultProfileId: 'profile-native',
    defaultCriteria: [
      { id: 'tests', description: 'Registered project tests pass.', kind: 'machine', required: true, checkDefinitionRef: 'check-node-test' },
      { id: 'review', description: 'User reviews the delivery.', kind: 'human', required: true },
    ],
    dispatchAllowed: true,
  }],
  profiles: [{ id: 'profile-native', revision: 1, displayName: 'Native profile', driverId: 'codex', kind: 'native', readiness: 'native_test_passed', dispatchAllowed: true }],
  checks: [{ id: 'check-node-test', revision: 4, displayName: 'node --test' }],
} as const

const facts = {
  protocol: 'project-facts/1',
  projectId: 'project-alpha',
  observedAt: '2026-11-14T11:55:00.000Z',
  provenance: { source: 'injected', provider: 'example/1', authority: 'none', scope: 'package', inputs: [] },
  stack: { kind: 'node', packageManagerField: 'pnpm@11.7.0', enginesNode: '>=24' },
  manager: { kind: 'pnpm', declaredVersion: '11.7.0' },
  locks: [{ name: 'pnpm-lock.yaml', digest: 'd'.repeat(64) }],
  workspace: { declaration: 'none' },
  scripts: ['build', 'test'],
  languages: ['node', 'typescript'],
  missing: [],
} as const

interface Row {
  kind: string
  paths?: readonly string[]
  status: string
  codes: readonly string[]
  fields?: CreateWorkFields
  command?: { kind: string; projectId: string; profileId: string; criteria: readonly string[] }
}

// An omitted `paths` list means "no narrowing requested"; an explicitly empty list is missing input.
const cases: readonly { kind: string; paths?: readonly string[] }[] = [
  { kind: 'regression_fix', paths: ['src/parser.ts'] },
  { kind: 'scoped_change' },
  { kind: 'verification_followup' },
]

const rows: Row[] = cases.map(({ kind, paths }) => {
  const selection = paths === undefined ? {} : { paths }
  const draft = parseProjectRecipeDraft(matchRecipe({ facts, configuration, kind, selection, now: NOW }))
  const base = paths === undefined ? { kind } : { kind, paths }
  if (draft.status !== 'draft') {
    const codes = draft.status === 'needs_input' ? draft.needsInput.map((item) => item.code) : draft.unsupported.map((item) => item.code)
    return { ...base, status: draft.status, codes }
  }
  const fields = previewInputs(draft, { configuration, facts })
  const command = toCreateWorkCommand(draft, { commandId: 'command-example', conversationId: 'conversation-example' })
  if (command.kind !== 'create_work') throw new Error('expected a create_work command')
  return {
    ...base,
    status: draft.status,
    codes: [],
    fields,
    command: { kind: command.kind, projectId: command.projectId, profileId: command.profileId, criteria: command.criteria.map((criterion) => criterion.id) },
  }
})

process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)

const expected = ['draft', 'needs_input', 'draft']
if (rows.some((row, index) => row.status !== expected[index])) {
  process.stderr.write('unexpected result statuses\n')
  process.exitCode = 1
}
