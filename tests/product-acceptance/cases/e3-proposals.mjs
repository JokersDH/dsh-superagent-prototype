import { join } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { cleanup, pickPort, tempState } from '../lib/instance.mjs'
import { scratchProject, startFaultProduct } from '../lib/fault-product.mjs'
import { latestEvents } from '../lib/product-db.mjs'

const define = (id, title, extra = {}) => ({
  id,
  title,
  layer: extra.layer ?? LAYERS.CONTROLLED,
  limitations: [
    'Controlled fixture executor with real SQLite; proposal payloads are inert data until one explicit confirmation.',
    ...(extra.limitations ?? []),
  ],
})

/**
 * Wave-08 independent acceptance of main's proposal prepare/confirm/reject HTTP over real SQLite.
 * Two fixture projects keep project isolation observable. No model is called: the payload is
 * synthetic structured data, and confirming a propose_work is the only effect.
 */
export async function runProposals({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const { root: stateRoot, state } = tempState('pa-w8-proposal-')
  const { project: projectPath } = scratchProject()
  const scopeA = { projectId: 'project-prop-a', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
  const scopeB = { projectId: 'project-prop-b', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
  let runtime
  let sequence = 0
  const commandId = (kind) => `w8prop-${kind}-${++sequence}`

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
    const projectA = configuration.projects.find((item) => item.id === scopeA.projectId)
    const projectB = configuration.projects.find((item) => item.id === scopeB.projectId)
    const machine = configuration.projects[0].defaultCriteria.find((item) => item.kind === 'machine' && item.required)
    const profileId = projectA.profileIds.find((id) => id.endsWith('-pass')) ?? projectA.defaultProfileId
    const events = () => latestEvents(state, root, 'application.proposal.changed', 100) ?? []

    const sourceOf = async (conversationId, projectId, text) => {
      await client.dispatch({ commandId: commandId(`chat-${conversationId}`), conversationId, kind: 'chat', projectId, text })
      const page = await client.conversation(conversationId)
      return page.messages.filter((item) => item.provenance === 'trusted_user').at(-1)
    }
    const prepare = (projectId, conversationId, sourceMessageId, payload) =>
      client.request('/v1/proposals/prepare', {
        method: 'POST',
        body: { projectId, conversationId, sourceMessageId, payload: { ...payload, sourceMessageId } },
      })
    const command = (projectId, conversationId, token, extra) =>
      client.request('/v1/proposals/commands', {
        method: 'POST',
        body: { commandId: commandId('proposal'), projectId, conversationId, token, ...extra },
      })
    const works = async (conversationId) => (await client.snapshot({ conversationId })).works

    const sourceA = await sourceOf('conv-prop-a', scopeA.projectId, '提案来源：把当前目标整理成一个可执行工作。')
    const sourceB = await sourceOf('conv-prop-b', scopeB.projectId, '项目 B 的独立提案来源。')

    cases.push(
      await runCase(
        { ...define('E3-PROPOSAL-HTTP', 'Proposal prepare is inert; confirm/reject are explicit, atomic and replay-safe'), evidence: {} },
        async ({ assert, evidence }) => {
          const before = (await works('conv-prop-a')).length
          const preview = await prepare(scopeA.projectId, 'conv-prop-a', sourceA.id, {
            kind: 'propose_work',
            goal: '为项目 A 创建一个受控交付工作。',
            projectId: scopeA.projectId,
          })
          assert('PREPARE_200', preview.status === 200, `status ${preview.status} ${JSON.stringify(preview.body)}`)
          const value = preview.body
          assert('PREVIEW_PROTOCOL', value.protocol === 'proposal-preview/1', value.protocol)
          assert('PREVIEW_PENDING', value.record.state === 'pending' && value.record.version === 1, JSON.stringify({ state: value.record?.state, version: value.record?.version }))
          assert('PREVIEW_INPUTS', ['work.scope', 'work.criteria', 'work.profileId'].every((item) => value.requiredInputs.includes(item)), JSON.stringify(value.requiredInputs))
          assert('PREVIEW_SOURCE', value.record.sourceMessageId === sourceA.id && value.record.projectId === scopeA.projectId, JSON.stringify({ source: value.record.sourceMessageId, project: value.record.projectId }))
          const ttl = Date.parse(value.expiresAt) - Date.now()
          assert('PREVIEW_TTL', ttl > 0 && ttl <= 5 * 60 * 1000 + 5_000, `ttl ${ttl}`)
          assert('PREPARE_NO_EFFECT', (await works('conv-prop-a')).length === before, `${before} -> ${(await works('conv-prop-a')).length}`)

          const missing = await command(scopeA.projectId, 'conv-prop-a', value.token, { kind: 'confirm_proposal' })
          assert('CONFIRM_NEEDS_INPUT', [400, 422].includes(missing.status) && missing.body?.status === 'rejected', JSON.stringify({ status: missing.status, body: missing.body }))
          assert('MISSING_NO_EFFECT', (await works('conv-prop-a')).length === before)

          const confirm = await command(scopeA.projectId, 'conv-prop-a', value.token, {
            kind: 'confirm_proposal',
            work: { scope: scopeA, criteria: [machine], profileId },
          })
          assert('CONFIRM_RECORDED', confirm.status === 200 && confirm.body?.status === 'recorded' && typeof confirm.body.workId === 'string', JSON.stringify({ status: confirm.status, body: confirm.body }))
          const after = await works('conv-prop-a')
          assert('WORK_CREATED', after.length === before + 1 && after.some((item) => item.work.id === confirm.body.workId), JSON.stringify(after.map((item) => item.work.id)))
          const confirmEvents = events().filter((item) => item.payload?.proposalId === value.record.proposalId)
          assert('CONFIRM_EVENT', confirmEvents.some((item) => item.payload?.state === 'confirmed'), JSON.stringify(confirmEvents.map((item) => item.payload?.state)))

          const replay = await client.request('/v1/proposals/commands', {
            method: 'POST',
            body: { commandId: confirm.body.commandId, projectId: scopeA.projectId, conversationId: 'conv-prop-a', token: value.token, kind: 'confirm_proposal', work: { scope: scopeA, criteria: [machine], profileId } },
          })
          assert('REPLAY_RECEIPT', replay.status === 200 && replay.body.commandId === confirm.body.commandId && replay.body.seq === confirm.body.seq, JSON.stringify(replay.body))
          assert('REPLAY_NO_SECOND_WORK', (await works('conv-prop-a')).length === after.length)

          const changed = await client.request('/v1/proposals/commands', {
            method: 'POST',
            body: { commandId: confirm.body.commandId, projectId: scopeA.projectId, conversationId: 'conv-prop-a', token: value.token, kind: 'confirm_proposal', work: { scope: scopeA, criteria: [machine], profileId: projectA.defaultProfileId } },
          })
          assert('CHANGED_PAYLOAD_CONFLICT', changed.status === 409, `status ${changed.status} ${JSON.stringify(changed.body)}`)

          const tampered = await client.request('/v1/proposals/commands', {
            method: 'POST',
            body: { commandId: commandId('tampered'), projectId: scopeA.projectId, conversationId: 'conv-prop-a', token: `${value.token.split('.')[0]}.AA`, kind: 'confirm_proposal', work: { scope: scopeA, criteria: [machine], profileId } },
          })
          assert('TAMPERED_TOKEN', tampered.status === 403, `status ${tampered.status}`)

          const cross = await prepare(scopeB.projectId, 'conv-prop-a', sourceA.id, {
            kind: 'propose_work',
            goal: '跨项目伪造提案',
            projectId: scopeB.projectId,
          })
          assert('CROSS_PROJECT_REFUSED', [400, 403].includes(cross.status), `status ${cross.status} ${JSON.stringify(cross.body)}`)

          // Rejection leaves no work and is recorded as a decision over the proposal only.
          const rejectPreview = await prepare(scopeA.projectId, 'conv-prop-a', sourceA.id, {
            kind: 'propose_work',
            goal: '这个提案会被明确拒绝。',
            projectId: scopeA.projectId,
          })
          assert('REJECT_PREVIEW', rejectPreview.status === 200, `status ${rejectPreview.status}`)
          const rejected = await command(scopeA.projectId, 'conv-prop-a', rejectPreview.body.token, { kind: 'reject_proposal' })
          assert('REJECT_RECORDED', rejected.status === 200 && rejected.body.status === 'recorded', JSON.stringify({ status: rejected.status, body: rejected.body }))
          assert('REJECT_NO_WORK', (await works('conv-prop-a')).length === after.length)
          assert('REJECT_EVENT', events().some((item) => item.payload?.proposalId === rejectPreview.body.record.proposalId && item.payload?.state === 'rejected'))

          // Project B is its own proposal and work scope.
          const previewB = await prepare(scopeB.projectId, 'conv-prop-b', sourceB.id, {
            kind: 'propose_work',
            goal: '项目 B 的独立受控工作。',
            projectId: scopeB.projectId,
          })
          assert('B_PREPARE', previewB.status === 200, `status ${previewB.status}`)
          const confirmB = await command(scopeB.projectId, 'conv-prop-b', previewB.body.token, {
            kind: 'confirm_proposal',
            work: { scope: scopeB, criteria: [machine], profileId },
          })
          assert('B_CONFIRM', confirmB.status === 200 && confirmB.body.status === 'recorded', JSON.stringify(confirmB.body))
          const worksB = await works('conv-prop-b')
          assert('B_WORK_CREATED', worksB.some((item) => item.work.id === confirmB.body.workId), JSON.stringify(worksB.map((item) => item.work.id)))
          assert('PROJECT_ISOLATION', (await works('conv-prop-a')).every((item) => item.work.id !== confirmB.body.workId))

          // A propose_decision confirmation records a decision in the same transaction.
          const decisionPreview = await prepare(scopeA.projectId, 'conv-prop-a', sourceA.id, {
            kind: 'propose_decision',
            content: '项目 A 决定：保留受控范围，不扩大授权。',
            scope: scopeA,
          })
          assert('DECISION_PREPARE', decisionPreview.status === 200, `status ${decisionPreview.status} ${JSON.stringify(decisionPreview.body)}`)
          const decisionConfirm = await command(scopeA.projectId, 'conv-prop-a', decisionPreview.body.token, { kind: 'confirm_proposal' })
          assert('DECISION_CONFIRM', decisionConfirm.status === 200 && decisionConfirm.body.status === 'recorded', JSON.stringify(decisionConfirm.body))
          const catalog = await client.json(`/v1/decisions?projectId=${scopeA.projectId}`)
          assert(
            'DECISION_RECORDED',
            (catalog.decisions ?? []).some((item) => item.record?.decision?.content?.includes('保留受控范围') && item.status === 'recorded' && item.sourceState === 'current'),
            JSON.stringify(catalog.decisions?.map((item) => ({ content: item.record?.decision?.content, status: item.status, source: item.sourceState }))),
          )
          // A question/answer or system display message is not a trusted user decision source and must
          // not be promoted into shared knowledge.
          const questionWork = await client.dispatch({
            commandId: commandId('auth-question'),
            conversationId: 'conv-prop-a',
            kind: 'create_work',
            projectId: scopeA.projectId,
            profileId: 'profile-fixture-question',
            goal: '权限问题答案不得成为共享决定',
            scope: scopeA,
            criteria: [machine],
          })
          let answered = false
          if (questionWork.receipt?.status === 'recorded') {
            const by = Date.now() + 20_000
            while (Date.now() < by) {
              const snapshot = await client.snapshot({ workId: questionWork.receipt.workId })
              const question = snapshot.questions[0]
              if (question) {
                await client.dispatch({
                  commandId: commandId('auth-answer'),
                  conversationId: 'conv-prop-a',
                  kind: 'answer_question',
                  questionId: question.id,
                  expectedVersion: question.version,
                  answer: { kind: 'choices', optionIds: [question.presentation.options[0].id] },
                })
                answered = true
                break
              }
              await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
            }
          }
          let authAnswerRefused = 'not_observed'
          if (answered) {
            const page = await client.conversation('conv-prop-a')
            const nonTrusted = page.messages.find((item) => item.provenance !== 'trusted_user')
            if (nonTrusted) {
              const promoted = await client.request('/v1/decisions/prepare', {
                method: 'POST',
                body: {
                  projectId: scopeA.projectId,
                  conversationId: 'conv-prop-a',
                  sourceMessageId: nonTrusted.id,
                  content: '权限答案不应成为共享决定。',
                  scope: scopeA,
                },
              })
              assert('AUTH_ANSWER_NOT_SHARED', [400, 403, 409].includes(promoted.status), `status ${promoted.status} ${JSON.stringify(promoted.body)}`)
              authAnswerRefused = promoted.status
            }
          }
          const bindings = await client.json('/v1/works/work-missing/evidence').catch((error) => ({ status: error.status }))
          assert('NO_NATIVE_AUTHORITY', bindings.status === 400 || bindings.status === 403 || bindings.status === 404)

          evidence.proposals = {
            preview: { protocol: value.protocol, requiredInputs: value.requiredInputs, ttlMs: ttl },
            confirm: { workId: confirm.body.workId, seq: confirm.body.seq },
            replay: { seq: replay.body.seq, works: after.length },
            refusals: { missingInput: missing.status, changedPayload: changed.status, tampered: tampered.status, crossProject: cross.status },
            reject: { recorded: true, noWork: true },
            isolation: { projectA: after.length, projectB: worksB.length },
            decision: { recorded: true },
            authAnswer: authAnswerRefused,
          }
        },
      ),
    )

    cases.push(
      notTested(
        define('E3-CONTEXT-GRANT-BOUNDARY', 'Expired, purpose-mismatched or over-budget context grants never reach a provider', { layer: LAYERS.NOT_TESTED }),
        'NOT_TESTED: E3-CONTEXT-PREVIEW verifies clamped budgets, omissions and basic refusals, but no public entry binds an expired grant or purpose mismatch to the read path. Required: expired grant, purpose mismatch, caller budget above the grant and negative/NaN budget must be refused before any provider read, with the effective window and truncation reported. The C composer probe shows these still fail at the library boundary, so a product pass cannot be claimed.',
      ),
    )
  } finally {
    await runtime?.close?.()
    artifacts.cleaned = cleanup({ root: stateRoot, state }, { keep })
  }

  return { cases, artifacts }
}
