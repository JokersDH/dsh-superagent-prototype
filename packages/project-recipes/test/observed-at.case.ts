/**
 * J5/J10: the observation time and the observed content are separate identities.
 *
 * A fresh read of unchanged bytes must compare equal to an applied draft, while a changed file must
 * not. The timestamp itself is provenance — never an authorization — and an observation outside the
 * freshness budget is refused when the caller supplies `now`.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { Json } from '@personal-agent/contracts'
import {
  PreviewError,
  factsContentDigest,
  factsContentOf,
  matchRecipe,
  observeProjectMetadata,
  parseProjectRecipeDraft,
  previewInputs,
} from '../src/index.ts'
import { NOW, alphaFacts, configuration } from './fixtures.ts'

const packageJson = { name: 'observed', packageManager: 'pnpm@11.7.0', engines: { node: '>=24' }, scripts: { test: 'node --test' } }

const withDir = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-observed-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const observe = (root: string, observedAt: string) => observeProjectMetadata({ root, projectId: 'project-alpha', observedAt }).facts

test('content digest is stable across observation times and changes with the bytes', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...packageJson, description: 'aaaa' }))
    const first = observe(dir, '2026-11-14T10:00:00.000Z')
    const second = observe(dir, '2026-11-14T11:00:00.000Z')
    assert.equal(factsContentDigest(first), factsContentDigest(second), 'same bytes, different time')
    assert.notEqual(first.observedAt, second.observedAt)
    assert.notEqual(canonicalDigest(first as unknown as Json), canonicalDigest(second as unknown as Json))

    // Same file length, different bytes: the content digest must still change.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...packageJson, description: 'bbbb' }))
    const changed = observe(dir, '2026-11-14T11:00:00.000Z')
    assert.notEqual(factsContentDigest(changed), factsContentDigest(first))
  })
})

test('the content digest matches the consumer formula that excludes observedAt', () => {
  const { observedAt: _ignored, ...content } = alphaFacts
  assert.equal(factsContentDigest(alphaFacts), canonicalDigest(content as unknown as Json))
  assert.equal(JSON.stringify(factsContentOf(alphaFacts)).includes('observedAt'), false)
})

test('a re-observation with the same content stays applicable; changed content or staleness does not', () => {
  const draft = parseProjectRecipeDraft(matchRecipe({ facts: alphaFacts, configuration, kind: 'regression_fix', selection: { paths: ['src/'] }, now: NOW }))
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return

  const fresher = { ...alphaFacts, observedAt: '2026-11-14T13:00:00.000Z' }
  assert.notEqual(fresher.observedAt, alphaFacts.observedAt)
  assert.equal(factsContentDigest(fresher), draft.provenance.facts.contentDigest)
  // Same content observed later is still applicable.
  assert.doesNotThrow(() => previewInputs(draft, { configuration, facts: fresher }))
  // But the draft's own provenance still records when it was produced.
  assert.equal(draft.provenance.facts.observedAt, alphaFacts.observedAt)

  const changed = { ...fresher, scripts: [...fresher.scripts, 'lint'] }
  assert.throws(
    () => previewInputs(draft, { configuration, facts: changed }),
    (error: unknown) => error instanceof PreviewError && error.code === 'stale_inputs' && error.staleInputs.includes('facts'),
  )

  // An old observation cannot be reused as a new authorization.
  assert.throws(
    () => previewInputs(draft, { configuration, facts: alphaFacts, now: '2026-11-14T20:00:00.000Z' }),
    (error: unknown) => error instanceof PreviewError && error.staleInputs.includes('facts'),
  )
  // Fresh enough is accepted when the caller states the time.
  assert.doesNotThrow(() => previewInputs(draft, { configuration, facts: alphaFacts, now: '2026-11-14T12:30:00.000Z' }))
})

test('the user may edit the goal while scope, criteria and profile stay the draft', async () => {
  const { toCreateWorkCommand } = await import('../src/index.ts')
  const draft = parseProjectRecipeDraft(matchRecipe({ facts: alphaFacts, configuration, kind: 'verification_followup', now: NOW }))
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return

  const edited = previewInputs(draft, { configuration, facts: alphaFacts }, { goal: '  只跟进失败用例并复验  ' })
  assert.equal(edited.goal, '只跟进失败用例并复验')
  assert.deepEqual(edited.scope, draft.scope)
  assert.deepEqual(edited.criteria, draft.criteria)
  assert.equal(edited.profileId, draft.profileId)
  assert.equal(edited.authorization, 'none')

  const command = toCreateWorkCommand(draft, { commandId: 'command-edit', conversationId: 'conversation-edit' }, { goal: '用户改写的目标' })
  assert.equal(command.kind, 'create_work')
  if (command.kind !== 'create_work') return
  assert.equal(command.goal, '用户改写的目标')
  assert.deepEqual(command.scope, draft.scope)

  for (const goal of ['   ', 'x'.repeat(16385)]) assert.throws(
    () => previewInputs(draft, { configuration, facts: alphaFacts }, { goal }),
    (error: unknown) => error instanceof PreviewError && error.code === 'not_actionable',
  )
})
