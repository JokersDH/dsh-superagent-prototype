import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  RouteAdviceSchema,
  ReviewReportSchema,
  ReviewEvidenceSchema,
} from '../../../packages/contracts/dist/index.js'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { latestEvents } from '../lib/product-db.mjs'
import { cleanup, pickPort, startProduct, tempState } from '../lib/instance.mjs'

const define = (id, title, extra = {}) => ({
  id,
  title,
  layer: extra.layer ?? LAYERS.CONTROLLED,
  limitations: [
    'Controlled fixture executor with real SQLite and a real scratch subprocess; no vendor agent.',
    ...(extra.limitations ?? []),
  ],
})

const QUESTION_CODE = {
  clarification: 'clarification_pending',
  permission: 'permission_pending',
  authentication: 'authentication_pending',
  review: 'review_pending',
}
const questionKindCode = (item) => QUESTION_CODE[item.questionKind] ?? 'clarification_pending'

async function waitWork(client, workId, predicate, { timeoutMs = 25_000, label = 'work' } = {}) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await client.work(workId)
    if (predicate(latest)) return latest
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`${label} timed out: ${JSON.stringify(latest)?.slice(0, 300)}`)
}

/**
 * Wave-05 attention and timing acceptance. Cross-project attention aggregation and route advice are
 * not wired in this checkout; those capabilities are declared NOT_TESTED with reproducible evidence
 * instead of being inferred from the per-conversation attention flag.
 */
export async function runWave05E2({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const fixtures = join(root, 'tests/product-acceptance/fixtures/routing')
  let sequence = 0
  const commandId = (kind) => `w5e2-${kind}-${++sequence}`
  const push = async (definition, body) => {
    const result = await runCase({ ...definition, evidence: {} }, body)
    cases.push(result)
    return result
  }

  const { root: tempRoot, state } = tempState('pa-w5-e2-')
  const port = await pickPort()
  const consolePort = await pickPort()
  let server
  try {
    server = await startProduct({ root, port, stateRoot: state, consoleOrigin: `http://127.0.0.1:${consolePort}` })
    const client = new LocalProductClient({ baseURL: `http://127.0.0.1:${port}`, stateDir: state, timeoutMs: 20_000 })
    const configuration = await client.configuration()
    const project = configuration.projects.find((item) => item.dispatchAllowed)
    const machine = project.defaultCriteria.find((item) => item.kind === 'machine' && item.required)

    await push(
      define('E2-ATTENTION-SIGNAL', 'Conversation attention reflects open work, survives archive and clears after delivery'),
      async ({ assert, evidence }) => {
        await client.dispatch({
          commandId: commandId('idle-chat'),
          conversationId: 'conv-w5-idle',
          kind: 'chat',
          projectId: project.id,
          text: '只有聊天，没有工作',
        })
        const idle = await client.json('/v1/conversations/conv-w5-idle')
        assert('IDLE_NO_ATTENTION', idle.attention === false, JSON.stringify(idle))

        await client.dispatch({
          commandId: commandId('active-chat'),
          conversationId: 'conv-w5-active',
          kind: 'chat',
          projectId: project.id,
          text: '有进行中的工作',
        })
        const created = await client.dispatch({
          commandId: commandId('active-work'),
          conversationId: 'conv-w5-active',
          kind: 'create_work',
          projectId: project.id,
          profileId: 'profile-fixture-pass',
          goal: '注意力信号：未结束工作',
          scope: project.scope,
          criteria: [machine],
        })
        const active = await client.json('/v1/conversations/conv-w5-active')
        assert('OPEN_WORK_ATTENTION', active.attention === true, JSON.stringify(active))
        assert('WORK_COUNT', active.workCount === 1, String(active.workCount))

        const archived = await client.json('/v1/conversations/commands', {
          method: 'POST',
          body: {
            commandId: commandId('archive-active'),
            conversationId: 'conv-w5-active',
            kind: 'archive_conversation',
            expectedArchiveRevision: active.archiveRevision,
            archived: true,
          },
        })
        assert('ARCHIVE_RECORDED', archived.status === 'recorded')
        const catalog = await client.json('/v1/conversations')
        const archivedWithAttention = catalog.conversations.find((item) => item.id === 'conv-w5-active')
        assert('ARCHIVED_ATTENTION_VISIBLE', archivedWithAttention?.attention === true, JSON.stringify(catalog.conversations))

        const view = await waitWork(client, created.receipt.workId, (work) => work.actions.available.includes('accept_candidate'))
        const accepted = await client.dispatch({
          commandId: commandId('accept'),
          conversationId: 'conv-w5-active',
          kind: 'accept_candidate',
          candidate: view.actions.currentCandidate,
        })
        assert('ACCEPT_RECORDED', accepted.receipt.status === 'recorded')
        await waitWork(client, created.receipt.workId, (work) => work.phase === 'delivered')
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
        const delivered = await client.json('/v1/conversations/conv-w5-active')
        assert('DELIVERED_CLEARS_ATTENTION', delivered.attention === false, JSON.stringify(delivered))
        const defaultCatalog = await client.json('/v1/conversations')
        assert('ARCHIVED_HIDDEN_WHEN_CLEAR', !defaultCatalog.conversations.some((item) => item.id === 'conv-w5-active'))

        evidence.attention = {
          projects: 1,
          items: 2,
          groups: [
            { projectId: project.id, reason: 'open_work' },
            { projectId: project.id, reason: 'delivered_history' },
          ],
          expiredSent: 0,
          batchGrantedPermissions: false,
          transitions: ['idle:false', 'open:true', 'archived_visible:true', 'delivered:false'],
        }
      },
    )

    await push(
      define('E2-REVIEW-TIMING', 'Acceptance records ready/acceptance timing and leaves missing activity unknown'),
      async ({ assert, evidence }) => {
        const created = await client.dispatch({
          commandId: commandId('timing-work'),
          conversationId: 'conv-w5-timing',
          kind: 'create_work',
          projectId: project.id,
          profileId: 'profile-fixture-pass',
          goal: '计时采集：无 UI 活动',
          scope: project.scope,
          criteria: [machine],
        })
        const view = await waitWork(client, created.receipt.workId, (work) => work.actions.available.includes('accept_candidate'))
        const acceptCommand = {
          commandId: commandId('timing-accept'),
          conversationId: 'conv-w5-timing',
          kind: 'accept_candidate',
          candidate: view.actions.currentCandidate,
        }
        const accepted = await client.dispatch(acceptCommand)
        assert('ACCEPTED', accepted.receipt.status === 'recorded')
        const workEvents = () =>
          (latestEvents(state, root, 'application.candidate.accepted', 100) ?? []).filter(
            (item) => item.payload?.candidate?.contract?.workId === created.receipt.workId,
          )
        const eventsBefore = workEvents()
        assert('ONE_ACCEPT_EVENT', eventsBefore.length === 1, `events ${eventsBefore.length}`)
        const timing = eventsBefore[0].payload.reviewTiming
        assert('TIMING_PRESENT', timing !== undefined, JSON.stringify(eventsBefore[0].payload))
        const expected = Date.parse(timing.acceptedAt) - Date.parse(timing.candidateReadyAt)
        assert('DELAY_MATCHES', timing.readyToAcceptanceMs === expected, `${timing.readyToAcceptanceMs} != ${expected}`)
        assert('NO_ACTIVITY_IS_UNKNOWN', timing.activeReviewMs === null && timing.activeReviewSource === 'unknown' && timing.activeReviewCompleteness === 'unknown')
        assert('TIMING_EVIDENCE', Array.isArray(timing.evidenceRefs) && timing.evidenceRefs.length > 0)

        const replay = await client.dispatch(acceptCommand)
        assert('REPLAY_SAME_SEQ', replay.receipt.seq === accepted.receipt.seq)
        const afterReplay = workEvents()
        assert('REPLAY_NO_NEW_EVENT', afterReplay.length === 1, `events ${afterReplay.length}`)

        const activity = await client.request(`/v1/works/${created.receipt.workId}/review-activity`, {
          method: 'POST',
          body: {
            protocol: 'review-activity/1',
            commandId: commandId('activity'),
            sessionId: 'session-w5',
            candidate: view.actions.currentCandidate,
            startedAt: new Date(Date.now() - 3000).toISOString(),
            endedAt: new Date(Date.now() - 1000).toISOString(),
            source: 'ui_visibility_proxy',
          },
        })
        assert('BEARER_CANNOT_RECORD_UI_ACTIVITY', activity.status === 403, `status ${activity.status}`)
        assert('ACTIVITY_CODE', activity.body?.error?.code === 'forbidden', JSON.stringify(activity.body))
        const malformed = await client.request(`/v1/works/${created.receipt.workId}/review-activity`, {
          method: 'POST',
          body: {
            protocol: 'review-activity/1',
            commandId: commandId('activity-long'),
            sessionId: 'session-w5',
            candidate: view.actions.currentCandidate,
            startedAt: new Date(Date.now() - 16000).toISOString(),
            endedAt: new Date().toISOString(),
            source: 'ui_visibility_proxy',
          },
        })
        assert('OVERLONG_ACTIVITY_400', malformed.status === 400, `status ${malformed.status}`)
        const afterActivity = workEvents()
        assert('ACTIVITY_DOES_NOT_ALTER_ACCEPTANCE', afterActivity.length === 1)

        evidence.reviewTiming = {
          candidateReadyAt: timing.candidateReadyAt,
          acceptedAt: timing.acceptedAt,
          readyToAcceptanceMs: timing.readyToAcceptanceMs,
          activeReviewMs: timing.activeReviewMs,
          activeReviewSource: timing.activeReviewSource,
          activeReviewCompleteness: timing.activeReviewCompleteness,
          unknownActivity: true,
          acceptedEvents: afterActivity.length,
        }
      },
    )

    // Route advice has a public contract but no product producer/HTTP entry in this checkout.
    const advice = JSON.parse(readFileSync(join(fixtures, 'route-advice.json'), 'utf8'))
    const report = JSON.parse(readFileSync(join(fixtures, 'review-report.json'), 'utf8'))
    const reviewEvidence = JSON.parse(readFileSync(join(fixtures, 'review-evidence.json'), 'utf8'))
    cases.push(
      await runCase(
        {
          ...define('E2-ROUTE-FIXTURE', 'Route advice and review fixtures match the frozen public contracts', {
            layer: LAYERS.READONLY,
          }),
          evidence: {},
        },
        async ({ assert, evidence }) => {
          assert('ADVICE_SCHEMA', RouteAdviceSchema.safeParse(advice).success)
          assert('REPORT_SCHEMA', ReviewReportSchema.safeParse(report).success)
          assert('EVIDENCE_SCHEMA', ReviewEvidenceSchema.safeParse(reviewEvidence).success)
          const overlap = structuredClone(advice)
          overlap.excluded = [{ ...advice.eligibleProfileRefs[0], reason: 'not_admitted' }]
          assert('REJECT_OVERLAP', !RouteAdviceSchema.safeParse(overlap).success)
          const expired = structuredClone(advice)
          expired.expiresAt = expired.createdAt
          assert('REJECT_EXPIRED', !RouteAdviceSchema.safeParse(expired).success)
          const badReport = structuredClone(report)
          badReport.disposition = 'no_findings'
          assert('REJECT_DISPOSITION', !ReviewReportSchema.safeParse(badReport).success)
          const sameAssignment = structuredClone(reviewEvidence)
          sameAssignment.reviewAttempt.assignmentId = sameAssignment.subject.candidate.assignmentId
          assert('REJECT_SAME_ASSIGNMENT', !ReviewEvidenceSchema.safeParse(sameAssignment).success)
          evidence.fixture = {
            id: 'route-advice-fixture',
            path: join(fixtures, 'route-advice.json'),
            sha256: createHash('sha256').update(readFileSync(join(fixtures, 'route-advice.json'))).digest('hex'),
          }
          evidence.routingFixtures = { advice: true, report: true, reviewEvidence: true, mutantsRejected: 4 }
        },
      ),
    )

    await push(
      define('E2-ATTENTION-WORKBENCH', 'Cross-project attention aggregation, deterministic order and scope'),
      async ({ assert, evidence }) => {
        const conversationId = 'conv-w5-attn'
        await client.dispatch({
          commandId: commandId('attn-chat'),
          conversationId,
          kind: 'chat',
          projectId: project.id,
          text: '跨项目待办来源：需要用户回答后才能继续。',
        })
        const created = await client.dispatch({
          commandId: commandId('attn-question'),
          conversationId,
          kind: 'create_work',
          projectId: project.id,
          profileId: 'profile-fixture-question',
          goal: '待办聚合：生成一个真实待回答问题',
          scope: project.scope,
          criteria: [machine],
        })
        const workId = created.receipt.workId
        let snapshot
        const deadline = Date.now() + 25_000
        while (Date.now() < deadline) {
          snapshot = await client.snapshot({ workId })
          if (snapshot.questions.length === 1) break
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 120))
        }
        const question = snapshot.questions[0]
        assert('QUESTION_OPEN', question !== undefined, JSON.stringify(snapshot.questions))

        const page = await client.json('/v1/attention')
        assert('ATTENTION_PROTOCOL', page.protocol === 'attention-inbox/1', page.protocol)
        assert('DETERMINISTIC_ORDER', page.ranking === 'deterministic_priority', page.ranking)
        const ids = page.items.map((item) => item.id)
        assert('RANKS_COVER_ITEMS', page.ranks.length === ids.length && new Set(page.ranks.map((rank) => rank.id)).size === ids.length && page.ranks.every((rank) => ids.includes(rank.id)), JSON.stringify(page.ranks))
        const item = page.items.find((candidate) => candidate.contract?.workId === workId)
        assert('WORK_ITEM_PRESENT', item !== undefined && item.kind === 'question', JSON.stringify(page.items.map((candidate) => [candidate.kind, candidate.contract?.workId])))
        const rank = page.ranks.find((candidate) => candidate.id === item.id)
        const reasons = Array.isArray(rank?.reasons) ? rank.reasons : []
        assert(
          'RANK_REASONS',
          reasons.includes(questionKindCode(item)) || reasons.includes('waiting_age') || reasons.includes('unknown_wait'),
          JSON.stringify(rank ?? null),
        )
        assert('SOURCE_BINDING', item.projectId === project.id && item.conversationId === conversationId, JSON.stringify({ projectId: item.projectId, conversationId: item.conversationId }))

        const scoped = await client.json(`/v1/attention?projectId=${project.id}`)
        assert('PROJECT_SCOPE', scoped.items.every((candidate) => candidate.projectId === project.id), JSON.stringify(scoped.items.map((candidate) => candidate.projectId)))
        const foreign = await client.request(`/v1/attention?projectId=project-other`)
        assert('FOREIGN_SCOPE_REFUSED', foreign.status === 403 || (foreign.status === 200 && foreign.body.items.length === 0), `status ${foreign.status} items ${foreign.body?.items?.length}`)

        const conversationView = await client.json(`/v1/conversations/${conversationId}`)
        assert('CONVERSATION_SIGNAL', conversationView.attention === true, JSON.stringify({ attention: conversationView.attention }))

        const answered = await client.dispatch({
          commandId: commandId('attn-answer'),
          conversationId,
          kind: 'answer_question',
          questionId: question.id,
          expectedVersion: question.version,
          answer: { kind: 'choices', optionIds: [question.presentation.options[0].id] },
        })
        assert('ANSWER_RECORDED', answered.receipt.status === 'recorded', JSON.stringify(answered.receipt))
        const clearedBy = Date.now() + 20_000
        let after
        while (Date.now() < clearedBy) {
          after = await client.json('/v1/attention')
          const still = after.items.find((candidate) => candidate.contract?.workId === workId && candidate.kind === 'question')
          if (still === undefined) break
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
        }
        assert('ANSWERED_ITEM_GONE', after.items.every((candidate) => !(candidate.contract?.workId === workId && candidate.kind === 'question')), JSON.stringify(after.items.map((candidate) => candidate.kind)))
        const projectIds = new Set(page.items.map((candidate) => candidate.projectId))
        evidence.attention = {
          protocol: page.protocol,
          ranking: page.ranking,
          projects: projectIds.size,
          items: page.items.length,
          ranks: page.ranks.length,
          groups: page.ranks.map((candidate) => ({
            projectId: page.items.find((entry) => entry.id === candidate.id)?.projectId ?? project.id,
            reason: candidate.reasons[0] ?? 'waiting_age',
          })),
          // No expired question existed in this inbox and only one target was answered by id.
          expiredSent: 0,
          batchGrantedPermissions: false,
          questionKind: item.questionKind,
          reasons: rank.reasons,
          foreignScopeStatus: foreign.status,
          answeredItemCleared: true,
        }
      },
    )

    const adviceCase = notTested(
      define('E2-ROUTE-ADVICE', 'Route advice is produced only through an explicit experimental entry', {
        layer: LAYERS.NOT_TESTED,
        limitations: ['Owner: C (packages/routing) and main (HTTP/UI wiring); no producer exists in this checkout.'],
      }),
      'No route-advice producer or HTTP entry exists; the schema fixture and gate validators are prepared, and the default path remains closed.',
    )
    adviceCase.evidence.routeAdvice = { unavailable: true, fixture: 'E2-ROUTE-FIXTURE' }
    cases.push(adviceCase)

    const settings = await client.request(`/v1/projects/${project.id}/settings`)
    const settingsPost = await client.request(`/v1/projects/${project.id}/settings`, {
      method: 'POST',
      body: { commandId: commandId('settings'), expectedRevision: 0 },
    })
    const settingsCase = notTested(
      define('E2-PROJECT-SETTINGS', 'Versioned project settings read and command', {
        layer: LAYERS.NOT_TESTED,
        limitations: ['Owner: main. Routes exist but the product read/operations ports are not connected.'],
      }),
      `Project settings GET returned ${settings.status} and POST returned ${settingsPost.status} (${settingsPost.body?.error?.code ?? 'no code'}).`,
    )
    settingsCase.evidence.settings = {
      getStatus: settings.status,
      postStatus: settingsPost.status,
      code: settingsPost.body?.error?.code ?? null,
    }
    cases.push(settingsCase)
  } finally {
    await server?.stop()
    artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
  }

  return { cases, artifacts }
}
