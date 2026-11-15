/**
 * J3/J4: the same configuration is used by the matcher **and** the real product application.
 *
 * A `draft` is only useful if its `create_work` fields actually enter the application's
 * delegation flow. This test builds a real `ProductStore` + `createProductApplication`, produces the
 * command through the public hand-off, and dispatches it as the trusted local actor. It also proves
 * the declared-atom rule from both sides: a child path is refused by the matcher and rejected by the
 * application when forced.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
// Built product artifacts, imported the same way the repo's other probes consume them.
import { createProductApplication } from '../../../packages/application/dist/index.js'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import type { Scope, TrustedActor, UserCommand } from '../../../packages/contracts/dist/index.js'
import {
  createProjectFactsObserver,
  matchRecipe,
  parseProjectRecipeDraft,
  previewInputs,
  toCreateWorkCommand,
} from '../../../packages/project-recipes/src/index.ts'

const NOW = '2026-11-14T12:00:00.000Z'
const actor: TrustedActor = { userId: 'local-user', authorityRef: 'local-authority', source: 'local_ui' }

// Declared atoms exactly as the application compares them (trailing slash and '.' are legal).
const projectScope: Scope = { projectId: 'project-atlas', allowedPaths: ['src/', '.'], excludedPaths: ['src/private/'], externalActions: [] }

const criteria = [
  { id: 'unit', kind: 'machine' as const, required: true as const, description: 'Unit checks pass', checkDefinitionRef: 'check:unit' },
]

const configuration = {
  protocol: 'application-configuration/1',
  revision: 'a'.repeat(64),
  executionAvailability: { state: 'available', kind: 'native' },
  projects: [{
    id: 'project-atlas',
    displayName: 'Atlas',
    scope: projectScope,
    profileIds: ['profile-codex-local'],
    defaultProfileId: 'profile-codex-local',
    defaultCriteria: criteria,
    dispatchAllowed: true,
  }],
  profiles: [{ id: 'profile-codex-local', revision: 1, displayName: 'Codex local', driverId: 'codex', kind: 'native', readiness: 'native_test_passed', dispatchAllowed: true }],
  checks: [{ id: 'check:unit', revision: 1, displayName: 'unit' }],
} as const

const facts = {
  protocol: 'project-facts/1',
  projectId: 'project-atlas',
  observedAt: '2026-11-14T11:55:00.000Z',
  provenance: { source: 'injected', provider: 'actual-application-fixture/1', authority: 'none', scope: 'package', inputs: [] },
  stack: { kind: 'node', packageManagerField: 'pnpm@11.7.0' },
  manager: { kind: 'pnpm', declaredVersion: '11.7.0' },
  locks: [{ name: 'pnpm-lock.yaml', digest: 'd'.repeat(64) }],
  workspace: { declaration: 'none' },
  scripts: ['test'],
  languages: ['node'],
  missing: [],
} as const

const fixture = (t: { after(fn: () => void): void }, grant: Scope = projectScope) => {
  const directory = mkdtempSync(join(tmpdir(), 'pa-recipes-actual-'))
  const store = new ProductStore({ path: join(directory, 'state.sqlite'), artifactsRoot: join(directory, 'artifacts') })
  const application = createProductApplication({
    store,
    principal: actor,
    projects: [{ id: 'project-atlas', scope: grant }],
    profileIds: ['profile-codex-local'],
    registeredChecks: ['check:unit'],
    actionSecret: Buffer.alloc(32, 7),
    nativeFence: () => 'current',
    now: () => NOW,
  })
  t.after(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return { store, application }
}

const configurationFor = (grant: Scope) => ({
  ...configuration,
  projects: [{ ...configuration.projects[0]!, scope: grant }],
})

const fieldsFor = (paths: readonly string[], grant: Scope = projectScope) => {
  const draft = parseProjectRecipeDraft(matchRecipe({ facts, configuration: configurationFor(grant), kind: 'regression_fix', selection: { paths }, now: NOW }))
  return draft
}

test('a matcher draft is recorded by the real application under the same configuration', async (t) => {
  const { application } = fixture(t)
  const draft = fieldsFor(['src/'])
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return

  const command = toCreateWorkCommand(draft, { commandId: 'command-j-1', conversationId: 'conversation-j' })
  const receipt = await application.dispatch(command, actor)
  assert.equal(receipt.status, 'recorded', JSON.stringify(receipt))
  if (receipt.status !== 'recorded') return
  assert.equal(typeof receipt.workId, 'string')
  assert.ok((receipt.workId ?? '').length > 0)
})

test('every declared atom the matcher accepts is also accepted by the application', async (t) => {
  const { application } = fixture(t)
  for (const [index, atom] of ['src/', '.'].entries()) {
    const draft = fieldsFor([atom])
    assert.equal(draft.status, 'draft', atom)
    if (draft.status !== 'draft') continue
    assert.deepEqual(draft.scope.allowedPaths, [atom], 'the declared atom is preserved verbatim')
    const command = toCreateWorkCommand(draft, { commandId: `command-atom-${index}`, conversationId: 'conversation-j' })
    const receipt = await application.dispatch(command, actor)
    assert.equal(receipt.status, 'recorded', `${atom}: ${JSON.stringify(receipt)}`)
  }
})

test('a child path is not a narrower atom: the matcher refuses it and the application rejects it', async (t) => {
  const { application } = fixture(t)
  const child = fieldsFor(['src/file.ts'])
  assert.equal(child.status, 'needs_input')
  if (child.status !== 'needs_input') return
  assert.deepEqual(child.needsInput.map((item) => item.code), ['scope_path_outside_allowed'])

  // Force the pre-wave28 draft shape straight into the application: it is refused by the real rule.
  const forced: UserCommand = {
    kind: 'create_work',
    commandId: 'command-forced-child',
    conversationId: 'conversation-j',
    projectId: 'project-atlas',
    goal: 'forced child atom',
    scope: { projectId: 'project-atlas', allowedPaths: ['src/file.ts'], excludedPaths: ['src/private/'], externalActions: [] },
    criteria: [...criteria],
    profileId: 'profile-codex-local',
  }
  const receipt = await application.dispatch(forced, actor)
  assert.equal(receipt.status, 'rejected')
  if (receipt.status !== 'rejected') return
  assert.equal(receipt.error.code, 'forbidden')
  assert.match(receipt.error.message, /Scope exceeds the configured project grant/)
})

test('a removed atom in the current configuration produces needs_input, not a stale draft', () => {
  const narrowed = {
    ...configuration,
    revision: 'b'.repeat(64),
    projects: [{ ...configuration.projects[0]!, scope: { ...projectScope, allowedPaths: ['.'] } }],
  }
  const draft = matchRecipe({ facts, configuration: narrowed, kind: 'regression_fix', selection: { paths: ['src/'] }, now: NOW })
  assert.equal(draft.status, 'needs_input')
  if (draft.status !== 'needs_input') return
  assert.deepEqual(draft.needsInput.map((item) => item.code), ['scope_path_outside_allowed'])
  assert.equal(draft.provenance.configuration.revision, 'b'.repeat(64))
})

test('a draft carries exactly the configured criteria and profile the application registered', async (t) => {
  const { application } = fixture(t)
  const draft = fieldsFor(['src/'])
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return
  assert.deepEqual(draft.criteria.map((criterion) => criterion.id), ['unit'])
  assert.equal(draft.profileId, 'profile-codex-local')
  const command = toCreateWorkCommand(draft, { commandId: 'command-criteria', conversationId: 'conversation-j' })
  const receipt = await application.dispatch(command, actor)
  assert.equal(receipt.status, 'recorded')
})

test('the whole chain works: authorized root → facts → draft → form fields → recorded work', async (t) => {
  const { application } = fixture(t)
  const directory = mkdtempSync(join(tmpdir(), 'pa-recipes-chain-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: 'atlas-service',
    packageManager: 'pnpm@11.7.0',
    engines: { node: '>=24' },
    scripts: { test: 'node --test' },
  }))
  writeFileSync(join(directory, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

  // The observer is constructed with the caller's registered roots; the public call carries no path.
  const observer = createProjectFactsObserver({ rootFor: (id) => (id === 'project-atlas' ? directory : undefined) })
  const input = { projectId: 'project-atlas', observedAt: NOW } as const
  assert.deepEqual(Object.keys(input).sort(), ['observedAt', 'projectId'])
  const observed = observer.observe(input)
  assert.equal(observed.facts.provenance.source, 'authorized_metadata')

  const draft = parseProjectRecipeDraft(matchRecipe({
    facts: observed.facts,
    configuration,
    kind: 'regression_fix',
    selection: { paths: ['src/'] },
    now: NOW,
  }))
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return

  // Current inputs still match what produced the draft, so the form fields are usable.
  const fields = previewInputs(draft, { configuration, facts: observed.facts })
  assert.deepEqual(fields.scope.allowedPaths, ['src/'])
  assert.equal(fields.authorization, 'none')

  const command = toCreateWorkCommand(draft, { commandId: 'command-chain', conversationId: 'conversation-chain' })
  const receipt = await application.dispatch(command, actor)
  assert.equal(receipt.status, 'recorded', JSON.stringify(receipt))
  if (receipt.status === 'recorded') assert.ok((receipt.workId ?? '').length > 0)
})

test('the wave-28 admission scenario is closed: grant ["src"] never yields a child-path draft', async (t) => {
  const grant: Scope = { projectId: 'project-atlas', allowedPaths: ['src'], excludedPaths: ['src/private/'], externalActions: [] }
  const { application } = fixture(t, grant)

  const child = fieldsFor(['src/file.ts'], grant)
  assert.equal(child.status, 'needs_input')
  if (child.status !== 'needs_input') return
  assert.deepEqual(child.needsInput.map((item) => item.code), ['scope_path_outside_allowed'])

  const declared = fieldsFor(['src'], grant)
  assert.equal(declared.status, 'draft')
  if (declared.status !== 'draft') return
  assert.deepEqual(declared.scope.allowedPaths, ['src'])
  const receipt = await application.dispatch(
    toCreateWorkCommand(declared, { commandId: 'command-grant-src', conversationId: 'conversation-j' }),
    actor,
  )
  assert.equal(receipt.status, 'recorded', JSON.stringify(receipt))
})

test('two registered projects in one application keep their own atoms, profile and checks', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pa-recipes-two-'))
  const store = new ProductStore({ path: join(directory, 'state.sqlite'), artifactsRoot: join(directory, 'artifacts') })
  t.after(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const atlasScope: Scope = { projectId: 'project-atlas', allowedPaths: ['src/'], excludedPaths: ['src/private/'], externalActions: [] }
  const bravoScope: Scope = { projectId: 'project-bravo', allowedPaths: ['packages/core/src/'], excludedPaths: [], externalActions: [] }
  const application = createProductApplication({
    store,
    principal: actor,
    projects: [{ id: 'project-atlas', scope: atlasScope }, { id: 'project-bravo', scope: bravoScope }],
    profileIds: ['profile-codex-local', 'profile-bravo'],
    registeredChecks: ['check:unit', 'check:bravo'],
    actionSecret: Buffer.alloc(32, 9),
    nativeFence: () => 'current',
    now: () => NOW,
  })
  const criteriaFor = (id: string, check: string) => [{ id, kind: 'machine' as const, required: true as const, description: `${id} checks`, checkDefinitionRef: check }]
  const twoProjectConfig = {
    ...configuration,
    projects: [
      { ...configuration.projects[0]!, profileIds: ['profile-codex-local'], defaultProfileId: 'profile-codex-local' },
      {
        id: 'project-bravo',
        displayName: 'Bravo',
        scope: bravoScope,
        profileIds: ['profile-bravo'],
        defaultProfileId: 'profile-bravo',
        defaultCriteria: criteriaFor('bravo-tests', 'check:bravo'),
        dispatchAllowed: true,
      },
    ],
    profiles: [...configuration.profiles, { id: 'profile-bravo', revision: 1, displayName: 'Bravo native', driverId: 'codex', kind: 'native' as const, readiness: 'native_test_passed' as const, dispatchAllowed: true }],
    checks: [...configuration.checks, { id: 'check:bravo', revision: 1, displayName: 'bravo' }],
  }
  const drafts = [
    { facts: { ...facts }, paths: ['src/'], commandId: 'command-two-atlas' },
    { facts: { ...facts, projectId: 'project-bravo', locks: [], scripts: ['test'] }, paths: ['packages/core/src/'], commandId: 'command-two-bravo' },
  ]
  for (const entry of drafts) {
    const draft = parseProjectRecipeDraft(matchRecipe({
      facts: entry.facts,
      configuration: twoProjectConfig,
      kind: 'scoped_change',
      selection: { paths: entry.paths },
      now: NOW,
    }))
    assert.equal(draft.status, 'draft', entry.commandId)
    if (draft.status !== 'draft') continue
    assert.equal(draft.projectId, entry.facts.projectId)
    assert.equal(draft.profileId, entry.facts.projectId === 'project-bravo' ? 'profile-bravo' : 'profile-codex-local')
    const receipt = await application.dispatch(
      toCreateWorkCommand(draft, { commandId: entry.commandId, conversationId: `conversation-${entry.commandId}` }),
      actor,
    )
    assert.equal(receipt.status, 'recorded', `${entry.commandId}: ${JSON.stringify(receipt)}`)
  }

  // The other project's atom is never accepted for this project.
  const crossed = parseProjectRecipeDraft(matchRecipe({
    facts,
    configuration: twoProjectConfig,
    kind: 'scoped_change',
    selection: { paths: ['packages/core/src/'] },
    now: NOW,
  }))
  assert.equal(crossed.status, 'needs_input')
  if (crossed.status !== 'needs_input') return
  assert.deepEqual(crossed.needsInput.map((item) => item.code), ['scope_path_outside_allowed'])
})
