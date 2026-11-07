import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  wireSchemas, UserCommandSchema, RequiredCriteriaSchema, CriterionSchema, WorkRecordSchema,
  RunnerCommandSchema, WireRequestIdSchema, NativeDispatchSchema, WorkViewSchema, UserQuestionSchema,
  ProbeReportSchema, ContractIdentitySchema, CONTRACT_IDENTITY, ScopeSchema, parseContractRevision, parseQuestionAnswer, parseRuntimeFactPayload,
} from '../src/index.ts';
import { validFixtures, commandFixtures, criterion, criteria, contract, revision, attempt, question, binding, view, scope } from './fixtures.ts';

for (const [name, schema] of Object.entries(wireSchemas)) {
  test(`wire fixture: ${name} parses and JSON-roundtrips`, () => {
    const fixture = validFixtures[name as keyof typeof validFixtures];
    assert.deepEqual(schema.parse(JSON.parse(JSON.stringify(fixture))), fixture);
  });
}
for (const command of commandFixtures) test(`user command: ${command.kind}`, () => assert.deepEqual(UserCommandSchema.parse(command), command));

test('untrusted command cannot carry actor, authority, raw credentials or an arbitrary kind', () => {
  const chat = commandFixtures[0];
  for (const extra of [{ actor: { kind: 'human' } }, { authorityRef: 'authority-forged' }, { token: 'fixture-secret' }, { kind: 'approve_all' }]) assert.equal(UserCommandSchema.safeParse({ ...chat, ...extra }).success, false);
});
test('scope and command projects must agree', () => assert.equal(UserCommandSchema.safeParse({ ...commandFixtures[1], projectId: 'other-project' }).success, false));
test('empty, optional-only, blank, duplicate and unregistered machine criteria cannot verify', () => {
  for (const value of [[], [{ ...criterion, required: false }], [{ ...criterion, description: '  ' }], [criterion, criterion]]) assert.equal(RequiredCriteriaSchema.safeParse(value).success, false);
  const { checkDefinitionRef: _check, ...missing } = criterion;
  assert.equal(CriterionSchema.safeParse(missing).success, false);
  assert.throws(() => parseContractRevision(revision, new Set()), z.ZodError);
  assert.deepEqual(parseContractRevision(revision, new Set(['check-1'])), revision);
  assert.equal(RequiredCriteriaSchema.safeParse([{ id: 'review', kind: 'human', required: true, description: 'Explicit user review.' }]).success, true);
});
test('Work cannot store a second lifecycle; runtime identities and prepared policy are mandatory', () => {
  assert.equal(WorkRecordSchema.safeParse({ ...view.work, state: 'running' }).success, false);
  const begin = { ...attempt, id: 'command-1', kind: 'begin', inputRef: 'input-1', preparedPolicyRef: 'prepared-1' };
  for (const key of ['assignmentId', 'attemptId', 'fenceEpoch', 'contract', 'preparedPolicyRef']) { const value: Record<string, unknown> = { ...begin }; delete value[key]; assert.equal(RunnerCommandSchema.safeParse(value).success, false); }
  for (const epoch of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(RunnerCommandSchema.safeParse({ ...begin, fenceEpoch: epoch }).success, false);
});
test('wire request IDs preserve string/integer distinction and int64 precision', () => {
  assert.notDeepEqual(WireRequestIdSchema.parse({ kind: 'string', value: '43' }), WireRequestIdSchema.parse({ kind: 'integer', decimal: '43' }));
  for (const decimal of ['-9223372036854775808', '9223372036854775807', '9007199254740993']) assert.deepEqual(WireRequestIdSchema.parse({ kind: 'integer', decimal }), { kind: 'integer', decimal });
  for (const decimal of ['nope', '01', '-0', '1.2', '9223372036854775808', '-9223372036854775809', '1'.repeat(100)]) assert.equal(WireRequestIdSchema.safeParse({ kind: 'integer', decimal }).success, false);
  assert.equal(WireRequestIdSchema.safeParse({ kind: 'integer', decimal: 43 }).success, false);
});
test('unknown native delivery cannot claim same-key safe retry', () => assert.equal(NativeDispatchSchema.safeParse({ commandId: 'command-1', delivery: 'indeterminate', retry: 'same_key_safe', evidenceRefs: [] }).success, false));
test('Work action context can retry without a candidate, but never without assignment/token', () => {
  const actions = { dispatchHold: { paused: true, revision: 1 }, currentAssignment: view.actions.currentAssignment, retryActionToken: 'action-1', available: ['retry_assignment'] };
  assert.equal(WorkViewSchema.safeParse({ ...view, actions }).success, true);
  assert.equal(WorkViewSchema.safeParse({ ...view, actions: { ...actions, retryActionToken: undefined } }).success, false);
  assert.equal(WorkViewSchema.safeParse({ ...view, actions: { ...actions, available: ['accept_candidate'] } }).success, false);
  assert.equal(WorkViewSchema.safeParse({ ...view, actions: { ...view.actions, currentCandidate: { ...view.actions.currentCandidate, contract: { ...contract, revision: 2 } } } }).success, false);
});
test('native approval is one current target with exact options; authentication uses native flow', () => {
  for (const value of [
    { ...question, targets: [binding, { ...binding, id: 'binding-2' }] },
    { ...question, targets: [{ ...binding, contract: { ...contract, revision: 2 } }] },
    { ...question, presentation: { kind: 'free_text' } },
    { ...question, kind: 'authentication' },
    { ...question, expiresAt: '2026-11-06T00:00:00Z' },
  ]) assert.equal(UserQuestionSchema.safeParse(value).success, false);
});
test('contextual answers reject unknown options, stale questions and forged form values', () => {
  const now = new Date('2026-11-07T01:00:00Z');
  assert.deepEqual(parseQuestionAnswer(question, { kind: 'choices', optionIds: ['deny'] }, now), { kind: 'choices', optionIds: ['deny'] });
  for (const answer of [{ kind: 'choices', optionIds: ['invented'] }, { kind: 'choices', optionIds: ['deny', 'allow-once'] }, { kind: 'free_text', text: 'approved' }]) assert.throws(() => parseQuestionAnswer(question, answer, now), z.ZodError);
  assert.throws(() => parseQuestionAnswer({ ...question, validity: 'cancelled' }, { kind: 'choices', optionIds: ['deny'] }, now), z.ZodError);
  assert.throws(() => parseQuestionAnswer({ ...question, expiresAt: '2026-11-07T00:30:00Z' }, { kind: 'defer' }, now), z.ZodError);
  const form = { ...question, kind: 'clarification' as const, presentation: { kind: 'form' as const, fields: [{ id: 'offline', label: 'Offline?', required: true, kind: 'boolean' as const }, { id: 'format', label: 'Format', required: true, kind: 'single' as const, options: [{ id: 'csv', label: 'CSV', semantic: 'business_choice' as const }] }] } };
  assert.deepEqual(parseQuestionAnswer(form, { kind: 'form', values: { offline: false, format: 'csv' } }, now), { kind: 'form', values: { offline: false, format: 'csv' } });
  for (const values of [{ format: 'csv' }, { offline: 'false', format: 'csv' }, { offline: true, format: 'json' }, { offline: true, format: 'csv', secret: 'value' }]) assert.throws(() => parseQuestionAnswer(form, { kind: 'form', values }, now), z.ZodError);
});
test('URL forms reject active schemes and embedded credentials', () => {
  for (const vettedUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@example.com']) assert.equal(UserQuestionSchema.safeParse({ ...question, kind: 'authentication', presentation: { kind: 'url_flow', vettedUrl, purpose: 'Login', statusRef: 'status-1' } }).success, false);
});
test('project scope rejects absolute paths and parent traversal', () => {
  for (const path of ['/tmp', '../secret', 'src/../../secret', 'C:\\secret', 'src\\file', '\0']) assert.equal(ScopeSchema.safeParse({ ...scope, allowedPaths: [path] }).success, false);
});
test('successful probes need a compatibility identity; current identity matches generated manifest', () => {
  assert.equal(ProbeReportSchema.safeParse({ capabilities: [], readiness: 'native_test_passed', checkedAt: '2026-11-07T00:00:00Z', evidenceRefs: [] }).success, false);
  assert.deepEqual(ContractIdentitySchema.parse(CONTRACT_IDENTITY), CONTRACT_IDENTITY);
  const manifest = JSON.parse(readFileSync(new URL('../generated/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.schemaHash, CONTRACT_IDENTITY.schemaHash);
  assert.equal(ContractIdentitySchema.safeParse({ ...CONTRACT_IDENTITY, apiMajor: 2 }).success, false);
});
test('critical facts resolve typed payloads with matching kinds and attempt identities', () => {
  const fact = { ...attempt, factId: 'fact-1', source: 'fixture-driver', kind: 'turn.ended' as const, payloadRef: 'payload-1' };
  assert.deepEqual(parseRuntimeFactPayload(fact, validFixtures.RuntimeFactPayload), validFixtures.RuntimeFactPayload);
  assert.throws(() => parseRuntimeFactPayload({ ...fact, kind: 'writer.observed' }, validFixtures.RuntimeFactPayload), z.ZodError);
  assert.throws(() => parseRuntimeFactPayload({ ...fact, kind: 'policy.prepared' }, { kind: 'policy.prepared', value: { ...validFixtures.PreparedExecutionPolicy, attemptId: 'old-attempt' } }), z.ZodError);
  assert.throws(() => parseRuntimeFactPayload({ ...fact, kind: 'question.opened', fenceEpoch: 2 }, { kind: 'question.opened', value: question }), z.ZodError);
  const exit = parseRuntimeFactPayload({ ...fact, kind: 'runtime.exited' }, { kind: 'runtime.exited', value: validFixtures.RuntimeExitedPayload });
  assert.equal(exit.kind, 'runtime.exited');
  assert.equal('writer' in exit.value, false);
});
