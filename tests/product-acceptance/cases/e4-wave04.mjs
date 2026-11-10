import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { countRows } from '../lib/product-db.mjs'
import { cleanup, pickPort, startProduct, tempState } from '../lib/instance.mjs'

/**
 * Wave-04 recovery and distribution acceptance.
 *
 * Recovery read-only startup is implemented in main and is verified here through HTTP only. Portable
 * installation is still absent from the merged source (D's candidate is not integrated), so those
 * cases stay NOT_TESTED with the exact prerequisites and planned negatives.
 */
export async function runWave04E4({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const push = async (definition, body) => {
    const result = await runCase({ ...definition, evidence: {} }, body)
    cases.push(result)
    return result
  }
  const define = (id, title, layer = LAYERS.CONTROLLED, limitations = []) => ({
    id,
    title,
    layer,
    limitations: [
      'Controlled fixture executor with real SQLite; no vendor agent and no model task.',
      ...limitations,
    ],
  })

  const { root: tempRoot, state } = tempState('pa-w4-recovery-start-')
  const port = await pickPort()
  const consolePort = await pickPort()
  let server
  try {
    await push(
      define('E4-RECOVERY-READONLY', 'A restored state starts read-only and consumes no queued business'),
      async ({ assert, evidence, note }) => {
        server = await startProduct({ root, port, stateRoot: state, consoleOrigin: `http://127.0.0.1:${consolePort}` })
        let client = new LocalProductClient({ baseURL: `http://127.0.0.1:${port}`, stateDir: state, timeoutMs: 15_000 })
        const configuration = await client.configuration()
        const project = configuration.projects.find((item) => item.dispatchAllowed)
        const machine = project.defaultCriteria.find((item) => item.kind === 'machine' && item.required)
        const created = await client.dispatch({
          commandId: 'w4-recovery-work',
          conversationId: 'conv-recovery-start',
          kind: 'create_work',
          projectId: project.id,
          profileId: 'profile-fixture-question',
          goal: '恢复启动只读验证',
          scope: project.scope,
          criteria: [machine],
        })
        assert('WORK_RECORDED', created.receipt.status === 'recorded', JSON.stringify(created.receipt))

        // Crash the coordinator while the work is in flight, then simulate a restored database.
        process.kill(-server.child.pid, 'SIGKILL')
        await server.exited
        const tables = ['effect', 'event_log', 'runtime_bindings', 'answer_deliveries', 'works']
        const before = Object.fromEntries(tables.map((table) => [table, countRows(state, root, table)]))
        assert('ROWS_OBSERVED', tables.every((table) => before[table] !== null), JSON.stringify(before))
        writeFileSync(join(state, 'restore-report.json'), '{"protocol":"personal-restore/1"}\n', { mode: 0o600 })

        // Normal/native/assistant flags are deliberately supplied; the marker must win.
        server = await startProduct({
          root,
          port,
          stateRoot: state,
          consoleOrigin: `http://127.0.0.1:${consolePort}`,
          extraArgs: ['--startup-mode', 'normal', '--native', '--assistant'],
          env: { PA_MODEL_CONFIG: join(state, 'no-model.json') },
        })
        client = new LocalProductClient({ baseURL: `http://127.0.0.1:${port}`, stateDir: state, timeoutMs: 15_000 })
        const health = await client.request('/v1/health', { authenticated: false })
        assert('RECOVERY_MODE', health.body.startupMode === 'recovery_readonly', JSON.stringify(health.body))
        assert('QUEUES_DISABLED_LOG', /business queues and model providers are disabled/.test(server.log()))
        const readOnlyConfig = await client.configuration()
        assert(
          'DISPATCH_DISABLED',
          readOnlyConfig.projects.every((item) => item.dispatchAllowed === false && item.profileIds.length === 0) &&
            readOnlyConfig.profiles.every((item) => item.dispatchAllowed === false),
          JSON.stringify(readOnlyConfig),
        )
        const snapshot = await client.snapshot({ conversationId: 'conv-recovery-start' })
        const work = snapshot.works.find((item) => item.work.id === created.receipt.workId)
        assert('HISTORY_READABLE', work !== undefined, JSON.stringify(snapshot.works.map((item) => item.work.id)))
        assert('ACTIONS_CLEARED', work.actions.available.length === 0, JSON.stringify(work.actions.available))

        const rejected = []
        for (const [path, body] of [
          ['/v1/commands', { commandId: 'ro-command', conversationId: 'conv-recovery-start', kind: 'stop_work', workId: created.receipt.workId }],
          [
            '/v1/conversations/commands',
            {
              commandId: 'ro-conversation',
              conversationId: 'conv-recovery-start',
              kind: 'archive_conversation',
              expectedArchiveRevision: 0,
              archived: true,
            },
          ],
          [
            `/v1/works/${created.receipt.workId}/verification/retry`,
            {
              kind: 'retry_verification',
              commandId: 'ro-retry',
              conversationId: 'conv-recovery-start',
              candidate: {
                ticketId: 'ticket-ro',
                assignmentId: 'assignment-ro',
                contract: { workId: created.receipt.workId, revision: 1, digest: 'c'.repeat(64) },
                candidateGeneration: 1,
              },
              blockedId: 'blocked-ro',
            },
          ],
        ]) {
          const response = await client.request(path, { method: 'POST', body })
          rejected.push({ path, status: response.status, code: response.body?.error?.code })
        }
        assert('BUSINESS_WRITES_REJECTED', rejected.every((item) => item.status === 422), JSON.stringify(rejected))
        assert(
          'UNSUPPORTED_CAPABILITY',
          rejected.every((item) => item.code === 'unsupported_capability'),
          JSON.stringify(rejected),
        )

        await new Promise((resolveDelay) => setTimeout(resolveDelay, 2500))
        const after = Object.fromEntries(tables.map((table) => [table, countRows(state, root, table)]))
        assert('QUEUES_UNCHANGED', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)

        // The marker keeps the instance read-only across another start.
        await server.stop()
        server = await startProduct({ root, port, stateRoot: state, consoleOrigin: `http://127.0.0.1:${consolePort}` })
        client = new LocalProductClient({ baseURL: `http://127.0.0.1:${port}`, stateDir: state, timeoutMs: 15_000 })
        const secondHealth = await client.request('/v1/health', { authenticated: false })
        assert('STILL_RECOVERY', secondHealth.body.startupMode === 'recovery_readonly')

        note(`rows ${JSON.stringify(before)} unchanged across recovery start; rejected ${JSON.stringify(rejected.map((item) => item.status))}`)
        evidence.recovery = {
          startupMode: secondHealth.body.startupMode,
          rowsBefore: before,
          rowsAfter: after,
          rejectedStatuses: rejected.map((item) => item.status),
          markerForcesRecovery: true,
          restartStaysReadOnly: true,
        }
      },
    )
  } finally {
    await server?.stop()
    artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
  }

  const distributionPaths = {
    launcher: 'apps/launcher',
    distribution: 'tools/distribution',
    portability: 'packages/portability',
  }
  const missing = Object.entries(distributionPaths)
    .filter(([, path]) => !existsSync(join(root, path)))
    .map(([name]) => name)
  cases.push(
    notTested(
      define(
        'E4-DISTRIBUTION-PREREQUISITES',
        'Staged installation, active-writer rollback and instance reuse are not testable yet',
        LAYERS.NOT_TESTED,
        ['Owner: Agent D. No candidate has been integrated into this main checkout.'],
      ),
      `Distribution paths absent from the merged source: ${missing.join(', ') || 'none'}. ` +
        'No staged bundle exists, so installation and migration cannot be claimed.',
    ),
  )
  cases.at(-1).evidence.distribution = {
    missing,
    plannedNegatives: [
      'rollback with an active ProductStore/WriterLock refuses before moving any file',
      'restored database with old queues starts read-only and sends zero business effects',
      'same-size content drift is detected by digest, not byte count',
      'PID reuse and state-prefix collisions do not select another instance',
      'keys, native home, session and sockets are not copied into the bundle',
      'corrupt, traversal, version-mismatched and failed-upgrade bundles fail explicitly',
      'a new directory alone is not a cross-machine PASS',
    ],
  }

  return { cases, artifacts }
}
