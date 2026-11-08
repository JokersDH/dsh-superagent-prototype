import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '@personal-agent/storage'
import type { NativeQuestionBinding, TrustedActor, UserQuestion } from '@personal-agent/contracts'
import { ANSWER_EFFECT, DeliveryDeferred, DeliveryUnknown, QuestionBroker, QuestionFault } from '../src/index.ts'

const actor: TrustedActor = { userId: 'user-1', authorityRef: 'authority-1', source: 'local_ui' }
const target: NativeQuestionBinding = {
  id: 'binding-1',
  ticketId: 'ticket-1',
  assignmentId: 'assignment-1',
  attemptId: 'attempt-1',
  fenceEpoch: 1,
  contract: { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) },
  connectionEpoch: 1,
  nativeRequestId: { kind: 'integer', decimal: '9223372036854775807' },
  nativeMethod: 'native/question',
  provenanceRef: 'provenance-1',
}
const question = (id = 'question-1'): UserQuestion => ({
  id,
  version: 1,
  kind: 'clarification',
  contract: target.contract,
  scope: { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
  decisionKey: 'business-key',
  prompt: 'Choose a behavior',
  nativePayloadRef: 'raw-question-1',
  presentation: {
    kind: 'choices',
    multiple: false,
    options: [
      { id: 'yes', label: 'Yes', semantic: 'business_choice' },
      { id: 'no', label: 'No', semantic: 'business_choice' },
    ],
  },
  targets: [target],
  validity: 'open',
  openedAt: '2026-11-08T00:00:00.000Z',
})
function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'pa-questions-'))
  let store = new ProductStore({ path: join(dir, 'state.sqlite') }),
    current = true,
    allowed = true,
    now = '2026-11-08T01:00:00.000Z'
  const make = () =>
    new QuestionBroker(store, {
      deliveryTimeoutMs: 30,
      admit: () => true,
      authorize: (_q, a) => allowed && a.userId === actor.userId,
      current: () => (current ? 'current' : 'stale'),
      invalidate: (ref) => {
        store.events.append({ topic: 'test.candidate.invalidated', entityRef: ref.ticketId, payload: ref })
      },
      now: () => now,
    })
  let broker = make()
  t.after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return {
    get store() {
      return store
    },
    get broker() {
      return broker
    },
    setCurrent: (v: boolean) => {
      current = v
    },
    setAllowed: (v: boolean) => {
      allowed = v
    },
    setNow: (v: string) => {
      now = v
    },
    reopen: () => {
      store.close()
      store = new ProductStore({ path: join(dir, 'state.sqlite') })
      broker = make()
    },
    answer: (id = 'answer-1', q = question()) =>
      broker.answer({
        answerId: id,
        questionId: q.id,
        expectedVersion: q.version,
        answer: { kind: 'choices', optionIds: ['yes'] },
        actor,
      }),
  }
}
test('question/answer are durable, per-target intents precede I/O, and exact answer replay does not requeue', (t) => {
  const h = fixture(t),
    q = question()
  h.broker.open(q)
  const result = h.answer()
  assert.equal(result.deliveries[0]!.status, 'local_recorded')
  assert.equal(h.store.queue.dueRows(ANSWER_EFFECT, 0, 10).length, 1)
  assert.equal(h.broker.get(q.id)!.version, 2)
  assert.equal(h.broker.get(q.id)!.validity, 'answered')
  const cursor = h.store.events.cursor()
  h.reopen()
  assert.deepEqual(h.answer(), result)
  assert.equal(h.store.events.cursor(), cursor)
})
test('same ID body/actor conflict, stale version, unknown option and mismatching form are refused', (t) => {
  const h = fixture(t),
    q = question()
  h.broker.open(q)
  assert.throws(
    () =>
      h.broker.answer({
        answerId: 'bad',
        questionId: q.id,
        expectedVersion: 2,
        answer: { kind: 'choices', optionIds: ['yes'] },
        actor,
      }),
    QuestionFault,
  )
  assert.throws(
    () =>
      h.broker.answer({
        answerId: 'bad',
        questionId: q.id,
        expectedVersion: 1,
        answer: { kind: 'choices', optionIds: ['unknown'] },
        actor,
      }),
    QuestionFault,
  )
  h.answer()
  assert.throws(
    () =>
      h.broker.answer({
        answerId: 'answer-1',
        questionId: q.id,
        expectedVersion: 1,
        answer: { kind: 'choices', optionIds: ['no'] },
        actor,
      }),
    /immutable/,
  )
  assert.throws(
    () =>
      h.broker.answer({
        answerId: 'answer-1',
        questionId: q.id,
        expectedVersion: 1,
        answer: { kind: 'choices', optionIds: ['yes'] },
        actor: { ...actor, source: 'local_cli' },
      }),
    /immutable/,
  )
})
test('form fields use declared types, required values and exact options, with no arbitrary field injection', (t) => {
  const h = fixture(t),
    q: UserQuestion = {
      ...question(),
      presentation: {
        kind: 'form',
        fields: [
          { kind: 'boolean', id: 'flag', label: 'Flag', required: true },
          {
            kind: 'single',
            id: 'choice',
            label: 'Choice',
            required: true,
            options: [{ id: 'a', label: 'A', semantic: 'business_choice' }],
          },
        ],
      },
    }
  h.broker.open(q)
  for (const values of [
    { flag: 'true', choice: 'a' },
    { flag: false, choice: 'b' },
    { flag: false, choice: 'a', unknown: 'value' },
  ])
    assert.throws(
      () =>
        h.broker.answer({
          answerId: 'bad',
          questionId: q.id,
          expectedVersion: 1,
          answer: { kind: 'form', values },
          actor,
        }),
      QuestionFault,
    )
  assert.equal(
    h.broker.answer({
      answerId: 'good',
      questionId: q.id,
      expectedVersion: 1,
      answer: { kind: 'form', values: { flag: false, choice: 'a' } },
      actor,
    }).deliveries.length,
    1,
  )
})
test('permission keeps one native request and exact option; deferral leaves it open without an effect', (t) => {
  const h = fixture(t),
    q: UserQuestion = {
      ...question(),
      kind: 'permission',
      presentation: {
        kind: 'choices',
        multiple: true,
        options: [
          { id: 'once', label: 'Once', semantic: 'allow_once' },
          { id: 'deny', label: 'Deny', semantic: 'deny' },
        ],
      },
    }
  h.broker.open(q)
  assert.throws(
    () =>
      h.broker.answer({
        answerId: 'bad',
        questionId: q.id,
        expectedVersion: 1,
        answer: { kind: 'choices', optionIds: ['once', 'deny'] },
        actor,
      }),
    QuestionFault,
  )
  const result = h.broker.answer({
    answerId: 'defer',
    questionId: q.id,
    expectedVersion: 1,
    answer: { kind: 'defer' },
    actor,
  })
  assert.equal(result.deferred, true)
  assert.equal(h.broker.get(q.id)!.validity, 'open')
  assert.equal(h.store.queue.dueRows(ANSWER_EFFECT, 0, 10).length, 0)
})
test('expiry and revoked authorization prevent new answers without producing delivery intents', (t) => {
  const h = fixture(t),
    q = { ...question(), expiresAt: '2026-11-08T02:00:00.000Z' }
  h.broker.open(q)
  h.setNow('2026-11-08T03:00:00.000Z')
  assert.throws(() => h.answer(), QuestionFault)
  assert.equal(h.broker.expire(q.id), true)
  assert.equal(h.broker.get(q.id)!.validity, 'expired')
  const next = question('next')
  h.broker.open(next)
  h.setAllowed(false)
  assert.throws(() => h.answer('next-answer', next), QuestionFault)
  assert.equal(h.store.queue.dueRows(ANSWER_EFFECT, 0, 10).length, 0)
})
test('answer transaction rollback also restores the question, queue, answer ledger and invalidation events', (t) => {
  const h = fixture(t)
  h.broker.open(question())
  const cursor = h.store.events.cursor()
  h.store.db.exec(
    "CREATE TRIGGER refuse_answer BEFORE INSERT ON answer_deliveries BEGIN SELECT RAISE(ABORT,'answer failure'); END",
  )
  assert.throws(() => h.answer(), /answer failure/)
  assert.equal(h.broker.get('question-1')!.validity, 'open')
  assert.equal(h.store.answers.get('answer-1'), undefined)
  assert.equal(h.store.events.cursor(), cursor)
})
test('writes preserve lossless request ID/version and remain response_written until native consumption is observed', async (t) => {
  const h = fixture(t)
  h.broker.open(question())
  h.answer()
  let writes = 0
  const sent = await h.broker.deliver('answer-1', target.id, {
    send: async (id, payload, before) => {
      assert.equal(h.store.uow.nesting, 0)
      assert.deepEqual(payload.nativeBinding.nativeRequestId, target.nativeRequestId)
      assert.equal(payload.questionVersion, 1)
      before()
      writes++
      return { commandId: id, delivery: 'written', retry: 'reconcile_first', evidenceRefs: ['wire-1', 'wire-2'] }
    },
  })
  assert.equal(sent.status, 'response_written')
  h.reopen()
  assert.deepEqual(h.broker.deliveries('answer-1')[0]!.evidenceRefs, ['wire-1', 'wire-2'])
  await h.broker.deliver('answer-1', target.id, {
    send: async () => {
      throw new Error('must not resend')
    },
  })
  assert.equal(writes, 1)
  assert.equal(
    h.broker.observe(
      { answerId: 'answer-1', targetBindingId: target.id, status: 'native_applied', evidenceRefs: ['native-1'] },
      target,
    ).status,
    'native_applied',
  )
})
test('unknown answer write survives reopen and never sends a second native response', async (t) => {
  const h = fixture(t)
  h.broker.open(question())
  h.answer()
  let writes = 0
  const transport = {
    send: async (_id: string, _payload: unknown, before: () => void) => {
      before()
      writes++
      throw new Error('lost ACK')
    },
  }
  await assert.rejects(h.broker.deliver('answer-1', target.id, transport), DeliveryUnknown)
  h.reopen()
  await assert.rejects(h.broker.deliver('answer-1', target.id, transport), DeliveryUnknown)
  assert.equal(writes, 1)
  assert.equal(h.broker.deliveries('answer-1')[0]!.status, 'indeterminate')
})
test('binding change during preparation prevents the physical answer write', async (t) => {
  const h = fixture(t)
  h.broker.open(question())
  h.answer()
  let writes = 0
  const result = await h.broker.deliver('answer-1', target.id, {
    send: async (id, _payload, before) => {
      h.setCurrent(false)
      before()
      writes++
      return { commandId: id, delivery: 'written', retry: 'none', evidenceRefs: [] }
    },
  })
  assert.equal(result.status, 'expired')
  assert.equal(writes, 0)
})
test('explicit proven not_sent before the marker can retry the same ID; malformed send receipts cannot', async (t) => {
  const h = fixture(t)
  h.broker.open(question())
  h.answer()
  const ids: string[] = []
  await assert.rejects(
    h.broker.deliver('answer-1', target.id, {
      send: async (id) => {
        ids.push(id)
        return { commandId: id, delivery: 'not_sent', retry: 'same_key_safe', evidenceRefs: ['queue-full-proof'] }
      },
    }),
    DeliveryDeferred,
  )
  await h.broker.deliver('answer-1', target.id, {
    send: async (id, _payload, before) => {
      ids.push(id)
      before()
      return { commandId: id, delivery: 'native_accepted', retry: 'none', evidenceRefs: ['accepted-1'] }
    },
  })
  assert.equal(ids[0], ids[1])
  assert.equal(h.broker.deliveries('answer-1')[0]!.status, 'response_written')
})
test('partial multi-target results stay separate; old wire-type observations cannot mark another request applied', async (t) => {
  const h = fixture(t),
    other = { ...target, id: 'binding-2', nativeRequestId: { kind: 'string' as const, value: '9223372036854775807' } },
    q = { ...question(), targets: [target, other] }
  h.broker.open(q)
  h.answer('answer-1', q)
  await h.broker.deliver('answer-1', target.id, {
    send: async (id, _payload, before) => {
      before()
      return { commandId: id, delivery: 'written', retry: 'none', evidenceRefs: ['wire-1'] }
    },
  })
  assert.equal(
    h.broker.deliveries('answer-1').find((item) => item.targetBindingId === other.id)!.status,
    'local_recorded',
  )
  assert.throws(
    () =>
      h.broker.observe(
        { answerId: 'answer-1', targetBindingId: other.id, status: 'native_applied', evidenceRefs: ['wrong'] },
        target,
      ),
    QuestionFault,
  )
})
test('business answer reuse requires the same decision, scope, version and current authorization', (t) => {
  const h = fixture(t),
    a = question()
  h.broker.open(a)
  h.answer()
  const b = { ...question('question-2'), targets: [{ ...target, id: 'binding-2' }] }
  h.broker.open(b)
  assert.equal(
    h.broker.reuse({ sourceAnswerId: 'answer-1', answerId: 'answer-2', questionId: b.id, expectedVersion: 1, actor })
      .deliveries.length,
    1,
  )
  const c = { ...question('question-3'), decisionKey: 'different' }
  h.broker.open(c)
  assert.throws(
    () =>
      h.broker.reuse({ sourceAnswerId: 'answer-1', answerId: 'answer-3', questionId: c.id, expectedVersion: 1, actor }),
    QuestionFault,
  )
})
test('a hung transport reaches a bounded unknown state and its late callback cannot write', async (t) => {
  const h = fixture(t)
  h.broker.open(question())
  h.answer()
  let late: (() => void) | undefined
  await assert.rejects(
    h.broker.deliver('answer-1', target.id, {
      send: async (_id, _payload, before) => {
        late = before
        return new Promise(() => {})
      },
    }),
    DeliveryUnknown,
  )
  assert.throws(() => late!(), DeliveryUnknown)
  assert.equal(h.broker.deliveries('answer-1')[0]!.status, 'indeterminate')
})
test('a mismatched transport receipt is never accepted and unsolicited consumption cannot bypass a write intent', async (t) => {
  const h = fixture(t)
  h.broker.open(question())
  h.answer()
  assert.throws(
    () =>
      h.broker.observe(
        { answerId: 'answer-1', targetBindingId: target.id, status: 'native_applied', evidenceRefs: ['forged'] },
        target,
      ),
    QuestionFault,
  )
  await assert.rejects(
    h.broker.deliver('answer-1', target.id, {
      send: async (_id, _payload, before) => {
        before()
        return { commandId: 'wrong-command', delivery: 'written', retry: 'none', evidenceRefs: ['wrong'] }
      },
    }),
    DeliveryUnknown,
  )
})
