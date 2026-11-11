import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { latestEvents } from '../lib/product-db.mjs'
import { cleanup, pickPort, startProduct, tempState } from '../lib/instance.mjs'

const define = (id, title, extra = {}) => ({
  id,
  title,
  layer: extra.layer ?? LAYERS.CONTROLLED,
  limitations: [
    'Controlled fixture executor with real SQLite; no vendor model and no native task.',
    ...(extra.limitations ?? []),
  ],
})

/**
 * Wave-06 explicit decision workflow over the new public HTTP: read-only prepare, explicit confirm,
 * catalog/source state, replay/conflict and revoke. No execution effect is expected at any step.
 */
export async function runDecisions({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const { root: tempRoot, state } = tempState('pa-w6-dec-')
  const port = await pickPort()
  const consolePort = await pickPort()
  let server
  let sequence = 0
  const commandId = (kind) => `w6dec-${kind}-${++sequence}`

  try {
    server = await startProduct({ root, port, stateRoot: state, consoleOrigin: `http://127.0.0.1:${consolePort}` })
    const client = new LocalProductClient({ baseURL: `http://127.0.0.1:${port}`, stateDir: state, timeoutMs: 20_000 })
    const configuration = await client.configuration()
    const project = configuration.projects.find((item) => item.dispatchAllowed)
    assertTruthy(configuration.decisionsAvailable === true, 'decisionsAvailable')
    const chat = await client.dispatch({
      commandId: commandId('chat-source'),
      conversationId: 'conv-dec',
      kind: 'chat',
      projectId: project.id,
      text: '项目决定来源：保留现有错误码，不自动扩大权限。',
    })
    assertTruthy(chat.receipt.status === 'recorded', 'chat source')
    const page = await client.conversation('conv-dec')
    const source = page.messages.at(-1)
    assertTruthy(source?.provenance === 'trusted_user', 'trusted source message')
    const catalog = () => client.json(`/v1/decisions?projectId=${project.id}`)
    const decisionEvents = () => latestEvents(state, root, 'application.decision.changed', 100) ?? []

    cases.push(
      await runCase(
        {
          ...define('E3-DECISION-WORKFLOW', 'Decision prepare is read-only; confirm and revoke are atomic and replay-safe'),
          evidence: {},
        },
        async ({ assert, evidence }) => {
          const businessRejections = []
          const parseRejections = []
          const before = await catalog()
          assert('EMPTY_CATALOG', before.protocol === 'decision-catalog/1' && before.decisions.length === 0)
          const eventsBefore = decisionEvents().length

          const preview = await client.request('/v1/decisions/prepare', {
            method: 'POST',
            body: {
              projectId: project.id,
              conversationId: 'conv-dec',
              sourceMessageId: source.id,
              content: '保留现有错误码，不自动扩大权限。',
              scope: project.scope,
            },
          })
          assert('PREPARE_200', preview.status === 200, `status ${preview.status}`)
          const value = preview.body
          assert('PREVIEW_PROTOCOL', value.protocol === 'decision-preview/1')
          assert('PREVIEW_SOURCE', value.conversationId === 'conv-dec' && value.sourceMessageId === source.id)
          assert('PREVIEW_SCOPE', value.decision.scope.projectId === project.id)
          const ttl = Date.parse(value.expiresAt) - Date.now()
          assert('PREVIEW_TTL_BOUNDED', ttl > 0 && ttl <= 5 * 60 * 1000 + 5_000, `ttl ${ttl}`)
          assert('PREVIEW_TOKEN', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.token))
          const afterPrepare = await catalog()
          assert('PREPARE_WRITES_NOTHING', afterPrepare.decisions.length === 0)
          assert('PREPARE_NO_EVENT', decisionEvents().length === eventsBefore)
          const worksAfterPrepare = await client.snapshot({ conversationId: 'conv-dec' })
          assert('PREPARE_NO_WORK', worksAfterPrepare.works.length === 0, `works ${worksAfterPrepare.works.length}`)

          const recordCommand = {
            kind: 'record_decision',
            commandId: commandId('record'),
            projectId: project.id,
            conversationId: 'conv-dec',
            token: value.token,
          }
          const recorded = await client.request('/v1/decisions/commands', { method: 'POST', body: recordCommand })
          assert('RECORD_200', recorded.status === 200, `status ${recorded.status}`)
          assert('RECORD_RECEIPT', recorded.body.status === 'recorded', JSON.stringify(recorded.body))
          const recordedCatalog = await catalog()
          assert('CATALOG_ONE', recordedCatalog.decisions.length === 1)
          const view = recordedCatalog.decisions[0]
          assert('STATUS_RECORDED', view.status === 'recorded', view.status)
          assert('SOURCE_CURRENT', view.sourceState === 'current', view.sourceState)
          assert('DECISION_CONTENT', view.record.decision.content === '保留现有错误码，不自动扩大权限。')
          assert('ONE_EVENT', decisionEvents().length === eventsBefore + 1, `${eventsBefore} -> ${decisionEvents().length}`)
          const worksAfterRecord = await client.snapshot({ conversationId: 'conv-dec' })
          assert('RECORD_NO_EXECUTION', worksAfterRecord.works.length === 0, `works ${worksAfterRecord.works.length}`)

          const replay = await client.request('/v1/decisions/commands', { method: 'POST', body: recordCommand })
          assert('REPLAY_SAME_SEQ', replay.body.seq === recorded.body.seq, `${replay.body.seq} != ${recorded.body.seq}`)
          assert('REPLAY_ONE_RECORD', (await catalog()).decisions.length === 1)
          assert('REPLAY_NO_EVENT', decisionEvents().length === eventsBefore + 1)

          const changed = await client.request('/v1/decisions/commands', {
            method: 'POST',
            body: { ...recordCommand, token: `${value.token.slice(0, -2)}zz` },
          })
          assert('CHANGED_PAYLOAD_CONFLICT', changed.status === 409, `status ${changed.status}`)
          assert('CHANGED_CODE', changed.body?.error?.code === 'conflict', JSON.stringify(changed.body))

          const tampered = await client.request('/v1/decisions/prepare', {
            method: 'POST',
            body: {
              projectId: project.id,
              conversationId: 'conv-dec',
              sourceMessageId: source.id,
              content: '另一条决定',
              scope: project.scope,
            },
          })
          const tamperedRecord = await client.request('/v1/decisions/commands', {
            method: 'POST',
            body: {
              kind: 'record_decision',
              commandId: commandId('tampered'),
              projectId: project.id,
              conversationId: 'conv-dec',
              token: `${tampered.body.token.slice(0, -2)}zz`,
            },
          })
          assert('TAMPERED_REJECTED', tamperedRecord.body.status === 'rejected', JSON.stringify(tamperedRecord.body))
          businessRejections.push(tamperedRecord.body.error?.code)
          assert('TAMPERED_NO_RECORD', (await catalog()).decisions.length === 1)

          const outside = await client.request('/v1/decisions/prepare', {
            method: 'POST',
            body: {
              projectId: project.id,
              conversationId: 'conv-dec',
              sourceMessageId: source.id,
              content: '越权范围',
              scope: { ...project.scope, allowedPaths: ['docs/'] },
            },
          })
          assert('OUTSIDE_SCOPE_FORBIDDEN', outside.status === 403, `status ${outside.status}`)
          assert('OUTSIDE_SCOPE_CODE', outside.body?.error?.code === 'forbidden')

          const malformed = await client.request('/v1/decisions/commands', {
            method: 'POST',
            body: { ...recordCommand, commandId: commandId('malformed'), extra: true },
          })
          assert('MALFORMED_400', malformed.status === 400, `status ${malformed.status}`)
          parseRejections.push(malformed.body?.error?.code)

          const revokeCommand = {
            kind: 'revoke_decision',
            commandId: commandId('revoke'),
            projectId: project.id,
            conversationId: 'conv-dec',
            decisionId: view.record.decision.id,
            expectedVersion: view.record.decision.version,
          }
          const revoked = await client.request('/v1/decisions/commands', { method: 'POST', body: revokeCommand })
          assert('REVOKE_RECORDED', revoked.body.status === 'recorded', JSON.stringify(revoked.body))
          const revokedCatalog = await catalog()
          assert('REVOKED_STATUS', revokedCatalog.decisions[0].status === 'revoked', revokedCatalog.decisions[0].status)
          assert('REVOKED_TIMESTAMP', typeof revokedCatalog.decisions[0].record.decision.revokedAt === 'string')
          assert('REVOKE_EVENT', decisionEvents().length === eventsBefore + 2)

          const staleRevoke = await client.request('/v1/decisions/commands', {
            method: 'POST',
            body: { ...revokeCommand, commandId: commandId('revoke-stale') },
          })
          assert('STALE_REVOKE_REJECTED', staleRevoke.body.status === 'rejected', JSON.stringify(staleRevoke.body))
          businessRejections.push(staleRevoke.body.error?.code)
          const replayRevoke = await client.request('/v1/decisions/commands', { method: 'POST', body: revokeCommand })
          assert('REVOKE_REPLAY_SAME_SEQ', replayRevoke.body.seq === revoked.body.seq)

          // Pagination is scoped to the project; a cursor from another project is refused.
          const secondPreview = await client.request('/v1/decisions/prepare', {
            method: 'POST',
            body: {
              projectId: project.id,
              conversationId: 'conv-dec',
              sourceMessageId: source.id,
              content: '第二条决定：保留原错误码。',
              scope: project.scope,
            },
          })
          await client.request('/v1/decisions/commands', {
            method: 'POST',
            body: {
              kind: 'record_decision',
              commandId: commandId('record-two'),
              projectId: project.id,
              conversationId: 'conv-dec',
              token: secondPreview.body.token,
            },
          })
          const page1 = await client.json(`/v1/decisions?projectId=${project.id}&limit=1`)
          assert('PAGE_LIMIT', page1.decisions.length === 1 && page1.hasMore === true && typeof page1.nextCursor === 'string')
          const page2 = await client.json(`/v1/decisions?projectId=${project.id}&limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`)
          assert('PAGE2_DISJOINT', page2.decisions[0].record.decision.id !== page1.decisions[0].record.decision.id)
          const crossScope = await client.request(`/v1/decisions?projectId=project-other&cursor=${encodeURIComponent(page1.nextCursor)}`)
          assert('CURSOR_SCOPE_REJECTED', crossScope.status === 403 || crossScope.status === 400, `status ${crossScope.status}`)

          assert('BUSINESS_REJECTIONS', businessRejections.every(Boolean), JSON.stringify(businessRejections))
          assert('PARSE_REJECTION_400', parseRejections.every((code) => code === 'invalid_request'), JSON.stringify(parseRejections))
          evidence.decisionWorkflow = {
            previewReadOnly: true,
            records: 2,
            revoked: true,
            sourceState: view.sourceState,
            executionEffects: 0,
            businessRejections,
            parseRejections,
            events: decisionEvents().length,
          }
        },
      ),
    )

    cases.push(
      notTested(
        define('E3-DECISION-SOURCE-STATES', 'Source missing/stale, scope expiry and forced transaction rollback', {
          layer: LAYERS.NOT_TESTED,
          limitations: [
            'Owner: main/C. Deleting a source message, expiring a grant mid-flight and injecting a commit failure need test-only seams that are not public.',
            'The current source remains current and the transaction is proven atomic by the receipt/event/catalog checks; absence of a fault API is not evidence of rollback.',
          ],
        }),
        'No public entry deletes/changes the source message or expires the project grant; transaction-failure injection is not exposed. These remain NOT_TESTED.',
      ),
    )
  cases.push(
    notTested(
      {
        ...define('E3-PROPOSAL-CONTEXT-BOUNDARY', 'Proposal confirmation and context window are explicit, transactional and revocable'),
        layer: LAYERS.NOT_TESTED,
        limitations: [
          'Owner: main (HTTP/composition) + C (rules). Context preview is published and verified by E3-CONTEXT-PREVIEW; automatic proposal confirmation and grant-level revocation remain unpublished.',
          'Explicit decisions are verified separately by E3-DECISION-WORKFLOW; this case is the automatic proposal/context surface, not a duplicate.',
        ],
      },
      'NOT_TESTED: context preview now exists, but automatic proposal confirmation and grant/revocation invalidation do not. Required inputs: proposal id/revision, source message and digest, current grant/scope/profile/contract, decision to confirm, plus context preview with project/conversation/work binding, window and invalidity. Planned negatives: unconfirmed means no execution; a failed original command leaves no half-confirmed state; an unknown response reuses the same command id; source/actor/grant/scope/profile/version drift is refused; revoke invalidates later context; cross-project isolation and reopen.',
    ),
  )

  } finally {
    await server?.stop()
    artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
  }

  return { cases, artifacts }
}

function assertTruthy(condition, label) {
  if (!condition) throw new Error(`Setup failed: ${label}`)
}
