/**
 * Hand-off to the existing confirmation flow: exact `create_work` fields, a command that the public
 * schema still validates, and a stale-input guard so an old draft cannot be submitted against a new
 * configuration.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UserCommandSchema } from '@personal-agent/contracts'
import {
  CREATE_WORK_FIELDS_PROTOCOL,
  PreviewError,
  assertDraftCurrent,
  matchRecipe,
  previewInputs,
  toCreateWorkCommand,
  toCreateWorkFields,
} from '../src/index.ts'
import { NOW, alphaFacts, configuration } from './fixtures.ts'

const draft = () => {
  const result = matchRecipe({ facts: alphaFacts, configuration, kind: 'regression_fix', now: NOW, selection: { paths: ['src/parser.ts'] } })
  assert.equal(result.status, 'draft')
  if (result.status !== 'draft') throw new Error('fixture must be a draft')
  return result
}

test('a draft becomes exactly the fields the existing create_work command needs', () => {
  const fields = toCreateWorkFields(draft())
  assert.equal(fields.protocol, CREATE_WORK_FIELDS_PROTOCOL)
  assert.equal(fields.authorization, 'none')
  assert.equal(fields.projectId, 'project-alpha')
  assert.equal(fields.profileId, 'profile-native')
  assert.deepEqual(fields.scope.allowedPaths, ['src/parser.ts'])
  assert.deepEqual(fields.criteria.map((criterion) => criterion.id), ['tests', 'review'])
  assert.deepEqual(fields.recipe, { id: 'regression_fix', version: 1, revision: draft().revision })
})

test('the command the application would receive passes the public schema', () => {
  const command = toCreateWorkCommand(draft(), { commandId: 'command-1', conversationId: 'conversation-1' })
  assert.equal(UserCommandSchema.safeParse(command).success, true)
  assert.equal(command.kind, 'create_work')
  if (command.kind !== 'create_work') return
  assert.equal(command.projectId, command.scope.projectId)
  assert.equal(command.profileId, 'profile-native')
})

test('only a complete draft is previewable', () => {
  const needs = matchRecipe({ facts: alphaFacts, configuration, kind: 'scoped_change', now: NOW })
  assert.throws(() => toCreateWorkFields(needs), (error: unknown) => error instanceof PreviewError && error.code === 'not_actionable')

  const unsupported = matchRecipe({ facts: { ...alphaFacts, projectId: 'project-ghost' }, configuration, kind: 'regression_fix', now: NOW })
  assert.throws(() => toCreateWorkFields(unsupported), (error: unknown) => error instanceof PreviewError && error.code === 'not_actionable')
})

test('a tampered draft cannot be handed over', () => {
  const tampered = { ...draft(), profileId: 'profile-other' }
  assert.throws(() => toCreateWorkFields(tampered), /revision does not match/)
})

test('a draft produced against an older configuration or older facts is refused', () => {
  const current = draft()
  assert.doesNotThrow(() => assertDraftCurrent(current, { configuration, facts: alphaFacts }))
  assert.doesNotThrow(() => previewInputs(current, { configuration, facts: alphaFacts }))

  assert.throws(
    () => assertDraftCurrent(current, { configuration: { ...configuration, revision: '9'.repeat(64) }, facts: alphaFacts }),
    (error: unknown) => error instanceof PreviewError && error.code === 'stale_inputs',
  )
  assert.throws(
    () => assertDraftCurrent(current, { configuration, facts: { ...alphaFacts, scripts: ['build', 'test', 'lint'] } }),
    (error: unknown) => error instanceof PreviewError && error.code === 'stale_inputs',
  )
})

test('a generated command still carries no token, argv or approval', () => {
  const text = JSON.stringify(toCreateWorkCommand(draft(), { commandId: 'command-2', conversationId: 'conversation-2' }))
  for (const forbidden of ['"argv"', '"executable"', '"token"', '"approval"']) assert.equal(text.includes(forbidden), false)
})
