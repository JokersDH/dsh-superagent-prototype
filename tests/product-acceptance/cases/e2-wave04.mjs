import { runCase, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { readRuntimeState } from '../lib/product-db.mjs'
import { cleanup, pickPort, startProduct, tempState } from '../lib/instance.mjs'
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

async function waitFor(read, predicate, { timeoutMs = 25_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`${label} timed out: ${JSON.stringify(latest)?.slice(0, 300)}`)
}

/**
 * Wave-04 additions: the durable conversation catalog/archive API and the operable verification
 * recovery flow. Both are exercised through authenticated loopback HTTP only.
 */
export async function runWave04({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  let sequence = 0
  const commandId = (kind) => `w4-${kind}-${++sequence}`
  const push = async (definition, body) => {
    const result = await runCase({ ...definition, evidence: {} }, body)
    cases.push(result)
    return result
  }

  // ---------------------------------------------------------------- conversation catalog
  {
    const { root: tempRoot, state } = tempState('pa-w4-conv-')
    const port = await pickPort()
    const consolePort = await pickPort()
    let server
    try {
      server = await startProduct({ root, port, stateRoot: state, consoleOrigin: `http://127.0.0.1:${consolePort}` })
      let client = new LocalProductClient({ baseURL: `http://127.0.0.1:${port}`, stateDir: state, timeoutMs: 20_000 })
      const configuration = await client.configuration()
      const project = configuration.projects.find((item) => item.dispatchAllowed)
      const machine = project.defaultCriteria.find((item) => item.kind === 'machine' && item.required)

      await push(
        define('E2-CONVERSATION-CATALOG', 'Conversation catalog, search, CAS rename, archive and restore persist'),
        async ({ assert, evidence, note }) => {
          const businessRejections = []
          const parseRejections = []
          const first = await client.json('/v1/conversations')
          assert('EMPTY_CATALOG', first.protocol === 'conversation-catalog/1' && first.conversations.length === 0)
          assert('EMPTY_NO_CURSOR', first.hasMore === false && first.nextCursor === undefined, JSON.stringify(first))

          await client.dispatch({
            commandId: commandId('chat-alpha'),
            conversationId: 'conv-alpha',
            kind: 'chat',
            projectId: project.id,
            text: 'Alpha 讨论：重试窗口与错误码',
          })
          const createCommandId = commandId('create-beta')
          const created = await client.json('/v1/conversations/commands', {
            method: 'POST',
            body: {
              commandId: createCommandId,
              conversationId: 'conv-beta',
              kind: 'create_conversation',
              projectId: project.id,
              title: 'Beta 会话',
            },
          })
          assert('CREATE_RECORDED', created.status === 'recorded', JSON.stringify(created))
          const beta = await client.json('/v1/conversations/conv-beta')
          assert('BETA_TITLE', beta.title === 'Beta 会话')
          assert('BETA_REVISIONS', beta.titleRevision === 1 && beta.archiveRevision === 0)
          assert('BETA_COUNTS', beta.messageCount === 0 && beta.workCount === 0)
          assert('BETA_PROJECT', JSON.stringify(beta.projectIds) === JSON.stringify([project.id]))
          assert('BETA_NOT_ARCHIVED', beta.archivedAt === undefined)

          const all = await client.json('/v1/conversations')
          assert('CATALOG_BOTH', all.conversations.length === 2)
          assert('CATALOG_ITEMS', all.conversations.some((c) => c.id === 'conv-alpha') && all.conversations.some((c) => c.id === 'conv-beta'))

          const byText = await client.json(`/v1/conversations?query=${encodeURIComponent('重试')}`)
          assert('SEARCH_MESSAGE_TEXT', byText.conversations.some((c) => c.id === 'conv-alpha'), JSON.stringify(byText))
          const byTitle = await client.json(`/v1/conversations?query=${encodeURIComponent('Beta')}`)
          assert('SEARCH_TITLE', byTitle.conversations.some((c) => c.id === 'conv-beta'))
          const noHit = await client.json('/v1/conversations?query=does-not-exist')
          assert('SEARCH_EMPTY', noHit.conversations.length === 0)
          // Querying a project the principal is not authorized for is refused before any list is built.
          const wrongProject = await client.request('/v1/conversations?projectId=project-other')
          assert('PROJECT_FILTER_FORBIDDEN', wrongProject.status === 403, `status ${wrongProject.status}`)
          assert('PROJECT_FILTER_CODE', wrongProject.body?.error?.code === 'forbidden', JSON.stringify(wrongProject.body))

          const page1 = await client.json('/v1/conversations?limit=1')
          assert('PAGE1_SIZE', page1.conversations.length === 1)
          assert('PAGE1_CURSOR', page1.hasMore === true && typeof page1.nextCursor === 'string')
          const page2 = await client.json(`/v1/conversations?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`)
          assert('PAGE2_DIFFERENT', page2.conversations[0].id !== page1.conversations[0].id, JSON.stringify(page2))

          const staleRename = await client.json('/v1/conversations/commands', {
            method: 'POST',
            body: {
              commandId: commandId('rename-stale'),
              conversationId: 'conv-beta',
              kind: 'rename_conversation',
              expectedTitleRevision: 99,
              title: 'Wrong revision',
            },
          })
          assert('STALE_RENAME_REJECTED', staleRename.status === 'rejected', JSON.stringify(staleRename))
          businessRejections.push(staleRename.error?.code)

          const malformed = await client.request('/v1/conversations/commands', {
            method: 'POST',
            body: {
              commandId: commandId('rename-malformed'),
              conversationId: 'conv-beta',
              kind: 'rename_conversation',
              expectedTitleRevision: 1,
              title: 'x',
              extra: true,
            },
          })
          assert('MALFORMED_400', malformed.status === 400, `status ${malformed.status}`)
          parseRejections.push(malformed.body?.error?.code)

          const renamed = await client.json('/v1/conversations/commands', {
            method: 'POST',
            body: {
              commandId: commandId('rename'),
              conversationId: 'conv-beta',
              kind: 'rename_conversation',
              expectedTitleRevision: beta.titleRevision,
              title: 'Beta 会话改名',
            },
          })
          assert('RENAME_RECORDED', renamed.status === 'recorded', JSON.stringify(renamed))
          const afterRename = await client.json('/v1/conversations/conv-beta')
          assert('TITLE_UPDATED', afterRename.title === 'Beta 会话改名' && afterRename.titleRevision === 2)

          const staleArchive = await client.json('/v1/conversations/commands', {
            method: 'POST',
            body: {
              commandId: commandId('archive-stale'),
              conversationId: 'conv-beta',
              kind: 'archive_conversation',
              expectedArchiveRevision: 9,
              archived: true,
            },
          })
          assert('STALE_ARCHIVE_REJECTED', staleArchive.status === 'rejected')
          businessRejections.push(staleArchive.error?.code)

          const archived = await client.json('/v1/conversations/commands', {
            method: 'POST',
            body: {
              commandId: commandId('archive'),
              conversationId: 'conv-beta',
              kind: 'archive_conversation',
              expectedArchiveRevision: afterRename.archiveRevision,
              archived: true,
            },
          })
          assert('ARCHIVE_RECORDED', archived.status === 'recorded', JSON.stringify(archived))
          const archivedSummary = await client.json('/v1/conversations/conv-beta')
          assert('ARCHIVED_AT', typeof archivedSummary.archivedAt === 'string')
          assert('ARCHIVED_READABLE', archivedSummary.title === 'Beta 会话改名')
          const defaultCatalog = await client.json('/v1/conversations')
          assert('ARCHIVED_HIDDEN_BY_DEFAULT', !defaultCatalog.conversations.some((c) => c.id === 'conv-beta'))
          const withArchived = await client.json('/v1/conversations?includeArchived=true')
          assert('ARCHIVED_VISIBLE_WITH_FLAG', withArchived.conversations.some((c) => c.id === 'conv-beta'))

          const restored = await client.json('/v1/conversations/commands', {
            method: 'POST',
            body: {
              commandId: commandId('restore'),
              conversationId: 'conv-beta',
              kind: 'archive_conversation',
              expectedArchiveRevision: archivedSummary.archiveRevision,
              archived: false,
            },
          })
          assert('RESTORE_RECORDED', restored.status === 'recorded')
          const restoredSummary = await client.json('/v1/conversations/conv-beta')
          assert('RESTORED', restoredSummary.archivedAt === undefined && restoredSummary.archiveRevision === 2)
          assert('RESTORED_VISIBLE', (await client.json('/v1/conversations')).conversations.some((c) => c.id === 'conv-beta'))

          // Replay is idempotent; a changed body under the same commandId is a conflict.
          const replay = await client.json('/v1/conversations/commands', {
            method: 'POST',
            body: {
              commandId: createCommandId,
              conversationId: 'conv-beta',
              kind: 'create_conversation',
              projectId: project.id,
              title: 'Beta 会话',
            },
          })
          assert('REPLAY_SAME_SEQ', replay.seq === created.seq, `${replay.seq} != ${created.seq}`)
          const conflict = await client.request('/v1/conversations/commands', {
            method: 'POST',
            body: {
              commandId: createCommandId,
              conversationId: 'conv-beta',
              kind: 'create_conversation',
              projectId: project.id,
              title: 'Changed title',
            },
          })
          assert('CONFLICT_409', conflict.status === 409, `status ${conflict.status}`)

          // Archived conversations stay visible to their work; observe that writes are still allowed.
          await client.dispatch({
            commandId: commandId('chat-in-archived'),
            conversationId: 'conv-alpha',
            kind: 'chat',
            projectId: project.id,
            text: '归档前讨论',
          })
          const alpha = await client.json('/v1/conversations/conv-alpha')
          const archivedAlpha = await client.json('/v1/conversations/commands', {
            method: 'POST',
            body: {
              commandId: commandId('archive-alpha'),
              conversationId: 'conv-alpha',
              kind: 'archive_conversation',
              expectedArchiveRevision: alpha.archiveRevision,
              archived: true,
            },
          })
          assert('ALPHA_ARCHIVED', archivedAlpha.status === 'recorded')
          const work = await client.dispatch({
            commandId: commandId('work-in-archived'),
            conversationId: 'conv-alpha',
            kind: 'create_work',
            projectId: project.id,
            profileId: 'profile-fixture-pass',
            goal: '归档会话仍可创建受控工作',
            scope: project.scope,
            criteria: [machine],
          })
          assert('ARCHIVED_WRITE_OBSERVED', work.receipt.status === 'recorded', JSON.stringify(work.receipt))
          const archivedWorks = await client.snapshot({ conversationId: 'conv-alpha' })
          assert('ARCHIVED_WORK_VISIBLE', archivedWorks.works.some((item) => item.work.id === work.receipt.workId))
          note('Archive is organisational: writes to an archived conversation are still accepted and recorded as observed.')

          // Persistence across a restart.
          await server.stop()
          server = await startProduct({ root, port, stateRoot: state, consoleOrigin: `http://127.0.0.1:${consolePort}` })
          client = new LocalProductClient({ baseURL: `http://127.0.0.1:${port}`, stateDir: state, timeoutMs: 20_000 })
          const afterRestart = await client.json('/v1/conversations?includeArchived=true')
          const betaAfter = afterRestart.conversations.find((c) => c.id === 'conv-beta')
          assert('PERSISTED_TITLE', betaAfter?.title === 'Beta 会话改名', JSON.stringify(betaAfter))
          assert('PERSISTED_RESTORE', betaAfter?.archivedAt === undefined)
          assert('PERSISTED_ARCHIVED_ALPHA', afterRestart.conversations.find((c) => c.id === 'conv-alpha')?.archivedAt !== undefined)

          assert('BUSINESS_REJECTIONS_ARE_RECEIPTS', businessRejections.every(Boolean), JSON.stringify(businessRejections))
          assert('PARSE_REJECTION_400', parseRejections.every((code) => code === 'invalid_request'), JSON.stringify(parseRejections))
          evidence.catalog = {
            conversations: afterRestart.conversations.length,
            businessRejections,
            parseRejections,
            archivedVisible: true,
            persisted: true,
          }
        },
      )
    } finally {
      await server?.stop()
      artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
    }
  }

  // ---------------------------------------------------------------- verification recovery
  {
    const { root: tempRoot, state } = tempState('pa-w4-recovery-')
    const { project: projectPath } = scratchProject()
    const scope = { projectId: 'project-recovery', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
    let runtime
    let reopened
    try {
      runtime = await startFaultProduct({ stateRoot: state, projectPath, scope })
      runtime.fault.active = true
      const client = runtime.client
      const configuration = await client.configuration()
      const machine = configuration.projects[0].defaultCriteria.find((item) => item.kind === 'machine' && item.required)

      await push(
        define('E2-VERIFICATION-RECOVERY', 'Blocked verification rechecks the same candidate, accepts and survives reopen'),
        async ({ assert, evidence, note }) => {
          const businessRejections = []
          const parseRejections = []
          const created = await client.dispatch({
            commandId: commandId('recovery-work'),
            conversationId: 'conv-recovery',
            kind: 'create_work',
            projectId: scope.projectId,
            profileId: 'profile-fixture-pass',
            goal: '验证故障恢复：同一候选重新检查',
            scope,
            criteria: [machine],
          })
          assert('WORK_RECORDED', created.receipt.status === 'recorded', JSON.stringify(created.receipt))
          const workId = created.receipt.workId
          const blocked = await waitFor(() => client.json(`/v1/works/${workId}/verification`), (value) => value.state === 'blocked', {
            label: 'blocked verification',
          })
          assert('BLOCKED', blocked.state === 'blocked')
          assert('BLOCKED_FAILURE', typeof blocked.failure?.id === 'string' && blocked.failure.code === 'verification_failed')
          assert('RETRY_AVAILABLE', blocked.retryAvailable === true)
          assert('BLOCKED_CANDIDATE', blocked.candidate?.contract.workId === workId)
          const view = await client.work(workId)
          assert('PHASE_NEEDS_USER', view.phase === 'needs_user')
          assert('NO_CANDIDATE_ACCEPT', !view.actions.available.includes('accept_candidate'))

          const beforeDb = readRuntimeState(state, root)

          const wrongBlocked = await client.json(`/v1/works/${workId}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: commandId('retry-wrong-blocked'),
              conversationId: 'conv-recovery',
              candidate: blocked.candidate,
              blockedId: 'verification-block:not-the-current-one',
            },
          })
          assert('WRONG_BLOCKED_REJECTED', wrongBlocked.status === 'rejected', JSON.stringify(wrongBlocked))
          businessRejections.push(wrongBlocked.error?.code)

          const malformed = await client.request(`/v1/works/${workId}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: commandId('retry-malformed'),
              conversationId: 'conv-recovery',
              candidate: blocked.candidate,
              blockedId: blocked.failure.id,
              extra: true,
            },
          })
          assert('MALFORMED_400', malformed.status === 400, `status ${malformed.status}`)
          parseRejections.push(malformed.body?.error?.code)

          const wrongWork = await client.request(`/v1/works/${'0'.repeat(8)}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: commandId('retry-wrong-work'),
              conversationId: 'conv-recovery',
              candidate: blocked.candidate,
              blockedId: blocked.failure.id,
            },
          })
          assert('WRONG_WORK_400', wrongWork.status === 400, `status ${wrongWork.status}`)
          parseRejections.push(wrongWork.body?.error?.code)

          runtime.fault.active = false
          const retry = await client.json(`/v1/works/${workId}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: commandId('retry'),
              conversationId: 'conv-recovery',
              candidate: blocked.candidate,
              blockedId: blocked.failure.id,
            },
          })
          assert('RETRY_RECORDED', retry.status === 'recorded', JSON.stringify(retry))
          const finished = await waitFor(() => client.json(`/v1/works/${workId}/verification`), (value) => value.state === 'finished', {
            label: 'finished verification',
          })
          assert('FINISHED', finished.state === 'finished' && typeof finished.verificationId === 'string')
          assert('RETRY_NOT_AVAILABLE', finished.retryAvailable === false)
          const verification = await client.verification(finished.verificationId)
          assert('VERIFICATION_PASS', verification.results.every((item) => item.outcome === 'PASS'), JSON.stringify(verification.results))

          const afterDb = readRuntimeState(state, root)
          if (beforeDb && afterDb) {
            assert('NO_NEW_WRITER', afterDb.attempts.length === beforeDb.attempts.length, `${beforeDb.attempts.length} -> ${afterDb.attempts.length}`)
            assert('NO_NEW_BEGIN', afterDb.begins === beforeDb.begins, `${beforeDb.begins} -> ${afterDb.begins}`)
            assert('ONE_MORE_VERIFICATION', afterDb.verifications === beforeDb.verifications + 1, `${beforeDb.verifications} -> ${afterDb.verifications}`)
          } else note('runtime attempt/begin observation is UNKNOWN')

          const accepted = await client.dispatch({
            commandId: commandId('accept'),
            conversationId: 'conv-recovery',
            kind: 'accept_candidate',
            candidate: (await client.work(workId)).actions.currentCandidate,
          })
          assert('ACCEPT_RECORDED', accepted.receipt.status === 'recorded', JSON.stringify(accepted.receipt))
          assert('DELIVERED', (await client.work(workId)).phase === 'delivered')

          const oldBlocked = await client.json(`/v1/works/${workId}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: commandId('retry-old-blocked'),
              conversationId: 'conv-recovery',
              candidate: blocked.candidate,
              blockedId: blocked.failure.id,
            },
          })
          assert('OLD_BLOCKED_REJECTED', oldBlocked.status === 'rejected', JSON.stringify(oldBlocked))
          businessRejections.push(oldBlocked.error?.code)

          const replay = await client.json(`/v1/works/${workId}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: retry.commandId,
              conversationId: 'conv-recovery',
              candidate: blocked.candidate,
              blockedId: blocked.failure.id,
            },
          })
          assert('REPLAY_SAME_SEQ', replay.seq === retry.seq, `${replay.seq} != ${retry.seq}`)

          const changedPayload = await client.request(`/v1/works/${workId}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: retry.commandId,
              conversationId: 'conv-recovery',
              candidate: blocked.candidate,
              blockedId: 'verification-block:changed-payload',
            },
          })
          assert('CHANGED_PAYLOAD_CONFLICT', changedPayload.status === 409, `status ${changedPayload.status}`)

          // A second blocked work is revised before recheck: the old candidate/contract is refused.
          runtime.fault.active = true
          const second = await client.dispatch({
            commandId: commandId('recovery-work-two'),
            conversationId: 'conv-recovery',
            kind: 'create_work',
            projectId: scope.projectId,
            profileId: 'profile-fixture-pass',
            goal: '验证恢复：修订后的旧候选必须拒绝',
            scope,
            criteria: [machine],
          })
          const secondBlocked = await waitFor(
            () => client.json(`/v1/works/${second.receipt.workId}/verification`),
            (value) => value.state === 'blocked',
            { label: 'second blocked verification' },
          )
          const revised = await client.dispatch({
            commandId: commandId('revise-while-blocked'),
            conversationId: 'conv-recovery',
            kind: 'revise_work',
            expected: secondBlocked.candidate.contract,
            goal: '验证恢复：修订后的合同',
            scope,
            criteria: [machine],
          })
          assert('REVISE_RECORDED', revised.receipt.status === 'recorded', JSON.stringify(revised.receipt))
          runtime.fault.active = false
          const staleRetry = await client.json(`/v1/works/${second.receipt.workId}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: commandId('retry-stale-contract'),
              conversationId: 'conv-recovery',
              candidate: secondBlocked.candidate,
              blockedId: secondBlocked.failure.id,
            },
          })
          assert('STALE_CONTRACT_RETRY_REJECTED', staleRetry.status === 'rejected', JSON.stringify(staleRetry))
          businessRejections.push(staleRetry.error?.code)
          const secondAfter = await client.json(`/v1/works/${second.receipt.workId}/verification`)
          assert('NO_STALE_FINISH', secondAfter.state !== 'finished', JSON.stringify(secondAfter))

          // Reopen: a new composition over the same store preserves delivery and verification.
          const beforeReopenDb = readRuntimeState(state, root)
          await runtime.close()
          reopened = await runtime.reopen()
          const reopenedClient = reopened.client
          const delivered = await reopenedClient.work(workId)
          assert('REOPEN_DELIVERED', delivered.phase === 'delivered')
          const reopenedStatus = await reopenedClient.json(`/v1/works/${workId}/verification`)
          assert('REOPEN_FINISHED', reopenedStatus.state === 'finished' && reopenedStatus.verificationId === finished.verificationId)
          const artifact = await reopenedClient.artifact(delivered.artifactIds[0])
          assert('ARTIFACT_BYTES', artifact.bytes.length > 0)
          const afterReopenDb = readRuntimeState(state, root)
          if (beforeReopenDb && afterReopenDb) {
            const deliveredTicket = blocked.candidate.ticketId
            const beforeAttempts = beforeReopenDb.attempts
              .filter((item) => item.ticketId === deliveredTicket)
              .map((item) => item.attemptId)
              .sort()
            const afterAttempts = afterReopenDb.attempts
              .filter((item) => item.ticketId === deliveredTicket)
              .map((item) => item.attemptId)
              .sort()
            assert(
              'REOPEN_NO_NEW_BEGIN_FOR_DELIVERED',
              JSON.stringify(afterAttempts) === JSON.stringify(beforeAttempts),
              `${JSON.stringify(beforeAttempts)} -> ${JSON.stringify(afterAttempts)}`,
            )
            note('Other pending work may resume on start; only the delivered ticket is required to stay untouched.')
          }
          const oldAfterReopen = await reopenedClient.json(`/v1/works/${workId}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: commandId('retry-after-reopen'),
              conversationId: 'conv-recovery',
              candidate: blocked.candidate,
              blockedId: blocked.failure.id,
            },
          })
          assert('OLD_BLOCKED_AFTER_REOPEN', oldAfterReopen.status === 'rejected', JSON.stringify(oldAfterReopen))

          assert('BUSINESS_REJECTIONS', businessRejections.every(Boolean), JSON.stringify(businessRejections))
          assert('PARSE_REJECTIONS_400', parseRejections.every((code) => code === 'invalid_request'), JSON.stringify(parseRejections))
          evidence.verificationRecovery = {
            blockedId: blocked.failure.id,
            verificationId: finished.verificationId,
            businessRejections,
            parseRejections,
            noNewWriter: true,
            reopened: true,
          }
        },
      )
    } finally {
      await reopened?.close()
      if (runtime && !reopened) await runtime.close().catch(() => undefined)
      runtime?.store?.close?.()
      artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
    }
  }

  // ---------------------------------------------------------------- finished/machine-fail states
  {
    const { root: tempRoot, state } = tempState('pa-w4-finished-')
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
        define('E2-VERIFICATION-FINISHED-STATES', 'Finished PASS/FAIL states are not retryable and machine FAIL stays unacceptable'),
        async ({ assert, evidence }) => {
          const pass = await client.dispatch({
            commandId: commandId('finished-pass'),
            conversationId: 'conv-finished',
            kind: 'create_work',
            projectId: project.id,
            profileId: 'profile-fixture-pass',
            goal: 'finished pass',
            scope: project.scope,
            criteria: [machine],
          })
          const passStatus = await waitFor(
            () => client.json(`/v1/works/${pass.receipt.workId}/verification`),
            (value) => value.state === 'finished',
            { label: 'pass finished' },
          )
          assert('PASS_FINISHED', passStatus.state === 'finished')
          assert('PASS_NOT_RETRYABLE', passStatus.retryAvailable === false)
          const passView = await client.work(pass.receipt.workId)
          assert('PASS_ACCEPTABLE', passView.actions.available.includes('accept_candidate'))
          const retryFinished = await client.json(`/v1/works/${pass.receipt.workId}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: commandId('retry-finished'),
              conversationId: 'conv-finished',
              candidate: passView.actions.currentCandidate,
              blockedId: 'verification-block:finished',
            },
          })
          assert('FINISHED_RETRY_REJECTED', retryFinished.status === 'rejected', JSON.stringify(retryFinished))
          const passUnchanged = await client.json(`/v1/works/${pass.receipt.workId}/verification`)
          assert('FINISHED_ID_UNCHANGED', passUnchanged.verificationId === passStatus.verificationId)

          const fail = await client.dispatch({
            commandId: commandId('finished-fail'),
            conversationId: 'conv-finished',
            kind: 'create_work',
            projectId: project.id,
            profileId: 'profile-fixture-fail',
            goal: 'finished fail',
            scope: project.scope,
            criteria: [machine],
          })
          const failStatus = await waitFor(
            () => client.json(`/v1/works/${fail.receipt.workId}/verification`),
            (value) => value.state === 'finished',
            { label: 'fail finished' },
          )
          const verification = await client.verification(failStatus.verificationId)
          assert('FAIL_RECORDED', verification.results.some((item) => item.outcome === 'FAIL'), JSON.stringify(verification.results))
          assert('FAIL_NOT_RETRYABLE', failStatus.retryAvailable === false)
          const failView = await client.work(fail.receipt.workId)
          assert('FAIL_NOT_ACCEPTABLE', !failView.actions.available.includes('accept_candidate'))
          const failRetry = await client.json(`/v1/works/${fail.receipt.workId}/verification/retry`, {
            method: 'POST',
            body: {
              kind: 'retry_verification',
              commandId: commandId('retry-fail'),
              conversationId: 'conv-finished',
              candidate: failView.actions.currentCandidate,
              blockedId: 'verification-block:fail',
            },
          })
          assert('FAIL_RETRY_REJECTED', failRetry.status === 'rejected', JSON.stringify(failRetry))

          const slow = await client.dispatch({
            commandId: commandId('not-ready'),
            conversationId: 'conv-finished',
            kind: 'create_work',
            projectId: project.id,
            profileId: 'profile-fixture-slow',
            goal: 'not ready',
            scope: project.scope,
            criteria: [machine],
          })
          const notReady = await client.json(`/v1/works/${slow.receipt.workId}/verification`)
          assert('NOT_READY_OR_PENDING', ['not_ready', 'queued', 'running'].includes(notReady.state), notReady.state)
          assert('NOT_READY_NO_RETRY', notReady.retryAvailable === false)
          evidence.verificationRecovery = {
            passVerificationId: passStatus.verificationId,
            failOutcomes: verification.results.map((item) => item.outcome),
            states: [passStatus.state, failStatus.state, notReady.state],
            retryRejections: [retryFinished.error?.code, failRetry.error?.code],
          }
        },
      )
    } finally {
      await server?.stop()
      artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
    }
  }

  return { cases, artifacts }
}
