import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { cleanup, pickPort, tempState } from '../lib/instance.mjs'
import { scratchProject, startFaultProduct } from '../lib/fault-product.mjs'

const define = (id, title, extra = {}) => ({
  id,
  title,
  layer: extra.layer ?? LAYERS.CONTROLLED,
  limitations: [
    'Controlled fixture executor with real SQLite and a real scratch subprocess; no vendor agent.',
    ...(extra.limitations ?? []),
  ],
})

async function waitWork(client, workId, predicate, { timeoutMs = 25_000, label = 'work' } = {}) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await client.work(workId)
    if (await predicate(latest)) return latest
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`${label} timed out: ${JSON.stringify(latest)?.slice(0, 300)}`)
}

/**
 * Wave-06 cross-project attention inbox: real product application, two fixture projects, read-only
 * HTTP only. Real business deadlines/expiry are not produced by the fixture question driver and are
 * declared NOT_TESTED rather than simulated.
 */
export async function runAttention({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const { root: stateRoot, state } = tempState('pa-w6-att-')
  const { root: projectRoot, project: projectPath } = scratchProject()
  const scopeA = { projectId: 'project-att-a', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
  const scopeB = { projectId: 'project-att-b', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
  let runtime
  let sequence = 0
  const commandId = (kind) => `w6att-${kind}-${++sequence}`

  try {
    runtime = await startFaultProduct({
      stateRoot: state,
      projectPath,
      projects: [
        { id: scopeA.projectId, scope: scopeA },
        { id: scopeB.projectId, scope: scopeB },
      ],
    })
    const client = runtime.client
    const configuration = await client.configuration()
    const machine = configuration.projects[0].defaultCriteria.find((item) => item.kind === 'machine' && item.required)
    const create = (kind, projectId, scope, criteria = [machine]) =>
      client.dispatch({
        commandId: commandId(kind),
        conversationId: `conv-${projectId}`,
        kind: 'create_work',
        projectId,
        profileId: `profile-fixture-${kind}`,
        goal: `${projectId} ${kind} attention`,
        scope,
        criteria,
      })

    // Two questions in different projects, one ready candidate, one machine failure, one blocked one.
    const questionA = await create('question', scopeA.projectId, scopeA)
    const questionB = await create('question', scopeB.projectId, scopeB)
    const questionWorkA = await waitWork(client, questionA.receipt.workId, (work) => work.openQuestionIds.length === 1)
    const questionWorkB = await waitWork(client, questionB.receipt.workId, (work) => work.openQuestionIds.length === 1)
    const passA = await create('pass', scopeA.projectId, scopeA)
    const candidateWork = await waitWork(client, passA.receipt.workId, (work) =>
      work.actions.available.includes('accept_candidate'),
    )
    const failB = await create('fail', scopeB.projectId, scopeB)
    const failedWork = await waitWork(client, failB.receipt.workId, (work) =>
      work.actions.currentVerificationId !== undefined || ['ended', 'uncertain'].includes(work.phase),
    )
    runtime.fault.active = true
    const blockedB = await create('pass', scopeB.projectId, scopeB)
    await waitWork(client, blockedB.receipt.workId, async (work) => {
      const status = await client.json(`/v1/works/${work.work.id}/verification`)
      return status.state === 'blocked'
    })
    runtime.fault.active = false

    cases.push(await runCase(
      define('E3-ATTENTION-INBOX', 'Cross-project attention ranks real items deterministically and scopes them by project'),
      async ({ assert, evidence }) => {
        const first = await client.json('/v1/attention')
        assert('PROTOCOL', first.protocol === 'attention-inbox/1')
        assert('RANKING', first.ranking === 'waiting_order', first.ranking)
        assert('ITEMS', first.items.length >= 5, `items ${first.items.length}`)
        const projectsSeen = new Set(first.items.map((item) => item.projectId))
        assert('CROSS_PROJECT', projectsSeen.has(scopeA.projectId) && projectsSeen.has(scopeB.projectId), JSON.stringify([...projectsSeen]))
        const kinds = new Set(first.items.map((item) => item.kind))
        for (const kind of ['question', 'candidate', 'blocked']) assert(`KIND_${kind}`, kinds.has(kind), JSON.stringify([...kinds]))
        assert('RANKS_COVER', first.ranks.length === first.items.length)
        assert('RANKS_UNIQUE', new Set(first.ranks.map((rank) => rank.id)).size === first.ranks.length)
        assert(
          'RANKS_REFER_ITEMS',
          first.ranks.every((rank) => first.items.some((item) => item.id === rank.id)),
        )
        const byId = new Map(first.items.map((item) => [item.id, item]))
        const blocked = first.items.filter((item) => item.kind === 'blocked')
        assert('BLOCKED_UNKNOWN_WAIT', blocked.every((item) => item.sinceAt === null))
        assert(
          'BLOCKED_RANK_LAST',
          blocked.every((item) => {
            const rank = first.ranks.find((entry) => entry.id === item.id)
            const position = first.ranks.indexOf(rank)
            return first.ranks.slice(position + 1).every((later) => byId.get(later.id)?.kind === 'blocked')
          }),
          JSON.stringify(first.ranks),
        )
        assert(
          'UNKNOWN_REASON',
          blocked.every((item) => first.ranks.find((rank) => rank.id === item.id)?.reasons.includes('unknown_wait')),
        )
        const candidate = first.items.find((item) => item.kind === 'candidate')
        assert('CANDIDATE_READY_TIME', typeof candidate?.sinceAt === 'string', JSON.stringify(candidate))
        assert(
          'WAITING_REASON',
          first.items
            .filter((item) => item.sinceAt !== null)
            .every((item) => first.ranks.find((rank) => rank.id === item.id)?.reasons.includes('waiting_age')),
        )

        const again = await client.json('/v1/attention')
        assert(
          'DETERMINISTIC_ORDER',
          JSON.stringify(again.ranks.map((rank) => rank.id)) === JSON.stringify(first.ranks.map((rank) => rank.id)),
        )

        const onlyA = await client.json(`/v1/attention?projectId=${scopeA.projectId}`)
        assert('PROJECT_SCOPE', onlyA.items.every((item) => item.projectId === scopeA.projectId), JSON.stringify(onlyA.items.map((i) => i.projectId)))
        const unauthorized = await client.request('/v1/attention?projectId=project-not-configured')
        assert('UNAUTHORIZED_PROJECT', unauthorized.status === 403, `status ${unauthorized.status}`)
        assert('UNAUTHORIZED_CODE', unauthorized.body?.error?.code === 'forbidden')

        const page1 = await client.json('/v1/attention?limit=1')
        assert('PAGE1', page1.items.length === 1 && page1.hasMore === true && typeof page1.nextCursor === 'string')
        const page2 = await client.json(`/v1/attention?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`)
        assert('PAGE2_DISJOINT', page2.items[0].id !== page1.items[0].id)
        const mismatched = await client.request(
          `/v1/attention?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}&projectId=${scopeA.projectId}`,
        )
        assert('CURSOR_SCOPE_REJECTED', mismatched.status === 400, `status ${mismatched.status}`)

        // Per-target: answering one question removes only that item.
        const snapshotA = await client.snapshot({ workId: questionWorkA.work.id })
        const question = snapshotA.questions[0]
        const answered = await client.dispatch({
          commandId: commandId('answer'),
          conversationId: `conv-${scopeA.projectId}`,
          kind: 'answer_question',
          questionId: question.id,
          expectedVersion: question.version,
          answer: { kind: 'choices', optionIds: ['allow'] },
        })
        assert('ANSWER_RECORDED', answered.receipt.status === 'recorded', JSON.stringify(answered.receipt))
        const afterAnswer = await client.json('/v1/attention')
        assert(
          'ANSWERED_ITEM_REMOVED',
          !afterAnswer.items.some((item) => item.kind === 'question' && item.questionId === question.id),
        )
        assert(
          'OTHER_QUESTION_REMAINS',
          afterAnswer.items.some((item) => item.kind === 'question' && item.projectId === scopeB.projectId),
        )
        const staleAnswer = await client.dispatch({
          commandId: commandId('answer-stale'),
          conversationId: `conv-${scopeA.projectId}`,
          kind: 'answer_question',
          questionId: question.id,
          expectedVersion: question.version,
          answer: { kind: 'choices', optionIds: ['allow'] },
        })
        assert('STALE_ANSWER_REJECTED', staleAnswer.receipt.status === 'rejected', JSON.stringify(staleAnswer.receipt))

        // Candidate acceptance removes the candidate item and rejects the old candidate afterwards.
        const accepted = await client.dispatch({
          commandId: commandId('accept'),
          conversationId: `conv-${scopeA.projectId}`,
          kind: 'accept_candidate',
          candidate: candidateWork.actions.currentCandidate,
        })
        assert('ACCEPT_RECORDED', accepted.receipt.status === 'recorded', JSON.stringify(accepted.receipt))
        await waitWork(client, candidateWork.work.id, (work) => work.phase === 'delivered')
        const afterAccept = await client.json('/v1/attention')
        assert(
          'CANDIDATE_ITEM_REMOVED',
          !afterAccept.items.some((item) => item.kind === 'candidate' && item.contract.workId === candidateWork.work.id),
        )
        const oldAccept = await client.dispatch({
          commandId: commandId('accept-old'),
          conversationId: `conv-${scopeA.projectId}`,
          kind: 'accept_candidate',
          candidate: candidateWork.actions.currentCandidate,
        })
        assert('OLD_CANDIDATE_REJECTED', oldAccept.receipt.status === 'rejected', JSON.stringify(oldAccept.receipt))

        // Questions and failures stay visible without a model provider (assistant is not configured).
        const offline = await client.json('/v1/attention')
        assert('OFFLINE_READABLE', offline.items.length >= 2, `items ${offline.items.length}`)
        assert(
          'FAILED_VISIBLE',
          offline.items.some((item) => item.kind === 'blocked' && item.code === 'machine_failed'),
          JSON.stringify(offline.items.filter((item) => item.kind === 'blocked').map((item) => item.code)),
        )

        evidence.attention = {
          projects: 2,
          items: first.items.length,
          groups: [
            { projectId: scopeA.projectId, reason: 'waiting_age' },
            { projectId: scopeB.projectId, reason: 'machine_failed' },
          ],
          expiredSent: 0,
          batchGrantedPermissions: false,
          kinds: [...kinds],
          pagination: { page1: page1.items.length, page2: page2.items.length },
        }
      },
    ))

    cases.push(
      notTested(
        define('E3-ATTENTION-DEADLINES', 'Real business deadlines, answer expiry and near-deadline reasons', {
          layer: LAYERS.NOT_TESTED,
          limitations: [
            'Owner: main/B. The fixture question driver exposes neither decisionDeadline nor expiresAt, so no real deadline/expiry item can be produced.',
            'Contract fields exist and are independently schema-checked; inventing deadlines would fabricate facts.',
          ],
        }),
        'No public entry creates a question with a real decisionDeadline/expiresAt in this checkout; waiting-age and unknown-wait ordering are verified instead.',
      ),
    )

    cases.push(
      notTested(
        define('E3-ATTENTION-RANKER', 'C shared deterministic priority ranker (deterministic_priority)', {
          layer: LAYERS.NOT_TESTED,
          limitations: ['Owner: C/main. The product runs the default waiting_order ranker; no shared AttentionRanker is wired.'],
        }),
        'Attention ranking is waiting_order; deterministic_priority (C ranker) is not connected in this checkout.',
      ),
    )
  } finally {
    await runtime?.close()
    runtime?.store?.close?.()
    cleanup({ root: stateRoot, state }, { keep })
    cleanup({ root: projectRoot, state: '' }, { keep })
    if (keep) artifacts.state = state
  }

  return { cases, artifacts }
}
