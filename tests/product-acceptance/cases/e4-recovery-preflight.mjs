import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { countRows } from '../lib/product-db.mjs'
import { cleanup, pickPort, startProduct, tempState } from '../lib/instance.mjs'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

function fixtureRepository() {
  const repo = mkdtempSync(join(tmpdir(), 'pa-recovery-git-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  writeFileSync(join(repo, 'README.md'), '# recovery preflight fixture\n')
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['commit', '-q', '-m', 'fixture baseline'], {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'acceptance-e',
      GIT_AUTHOR_EMAIL: 'acceptance-e@example.invalid',
      GIT_COMMITTER_NAME: 'acceptance-e',
      GIT_COMMITTER_EMAIL: 'acceptance-e@example.invalid',
    },
  })
  return realpathSync(repo)
}

/** A marker main's recovery inspector accepts: private, bound to this state, evidence verified. */
function verifiedMarker(stateRoot) {
  return {
    protocol: 'personal-restore/1',
    targetPath: realpathSync(stateRoot),
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 12 },
    evidence: { status: 'verified' },
    createdAt: new Date().toISOString(),
  }
}

/**
 * Independent acceptance of main's read-only recovery preflight. The plan is diagnostics only:
 * `authorization=not_granted` and `commitAvailable=false` are asserted, prepare must not write the
 * database, events, receipts or project bindings, and the commit entry must stay refused.
 */
export async function runRecoveryPreflight({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const define = (id, title) => ({
    id,
    title,
    layer: LAYERS.CONTROLLED,
    limitations: [
      'Controlled fixture executor with real SQLite; the recovery plan is diagnostics, not authorization.',
      'Commit of a new authorization is still main-owned and not implemented; this case does not claim it.',
    ],
  })
  const push = async (definition, body) => {
    const result = await runCase({ ...definition, evidence: {} }, body)
    cases.push(result)
    return result
  }

  const { root: tempRoot, state } = tempState('pa-w6-recovery-preflight-')
  const ports = { port: await pickPort(), consolePort: await pickPort(), normalPort: await pickPort(), normalConsole: await pickPort() }
  let server
  let normalServer
  try {
    writeFileSync(join(state, 'restore-report.json'), `${JSON.stringify(verifiedMarker(state))}\n`, { mode: 0o600 })

    await push(define('E4-RECOVERY-PREFLIGHT', 'Read-only recovery inspect/prepare is bounded, writes nothing and grants no authority'), async ({ assert, evidence }) => {
      server = await startProduct({ root, port: ports.port, stateRoot: state, consoleOrigin: `http://127.0.0.1:${ports.consolePort}` })
      const client = new LocalProductClient({ baseURL: `http://127.0.0.1:${ports.port}`, stateDir: state, timeoutMs: 20_000 })
      const configuration = await client.configuration()
      // Recovery is read-only, so no project advertises dispatch; the configured source project is
      // still the binding source and must be reported by inspect.
      const project = configuration.projects.find((item) => item.id === 'project-atlas') ?? configuration.projects[0]
      const markerBefore = readFileSync(join(state, 'restore-report.json'))
      const bindingsBefore = (() => {
        try {
          return readFileSync(join(state, 'native-projects.json'))
        } catch {
          return undefined
        }
      })()
      const tables = ['event_log', 'works', 'command_receipts', 'runtime_bindings']
      const rowsBefore = Object.fromEntries(tables.map((table) => [table, countRows(state, root, table)]))

      const inspection = await client.request('/v1/recovery/inspect')
      assert('INSPECT_200', inspection.status === 200, `status ${inspection.status} ${JSON.stringify(inspection.body)}`)
      const view = inspection.body
      assert('INSPECT_PROTOCOL', view.protocol === 'recovery-inspection/1', view.protocol)
      assert('INSPECT_STATE', view.state === 'recovery_readonly', view.state)
      assert('INSPECT_MARKER', /^[a-f0-9]{64}$/.test(String(view.markerDigest)), String(view.markerDigest))
      assert('INSPECT_NO_AUTHORITY', view.commitAvailable === false && view.blockers.some((blocker) => blocker.code === 'authorization_not_implemented'), JSON.stringify(view.blockers))
      assert('INSPECT_PROJECTS', view.projects.some((item) => item.id === project.id), JSON.stringify(view.projects))
      const fingerprint = view.inspectionFingerprint

      const repository = fixtureRepository()
      const prepareBody = {
        expectedFingerprint: fingerprint,
        bindings: [{ sourceProjectId: project.id, project: { path: repository, check: 'node_test' } }],
      }
      const prepared = await client.request('/v1/recovery/prepare', { method: 'POST', body: prepareBody })
      assert('PREPARE_200', prepared.status === 200, `status ${prepared.status} ${JSON.stringify(prepared.body)}`)
      const plan = prepared.body
      assert('PLAN_PROTOCOL', plan.protocol === 'recovery-plan/1', plan.protocol)
      assert('PLAN_NO_AUTHORITY', plan.authorization === 'not_granted' && plan.commitAvailable === false, JSON.stringify({ authorization: plan.authorization, commitAvailable: plan.commitAvailable }))
      assert('PLAN_FINGERPRINT', plan.inspectionFingerprint === fingerprint, String(plan.inspectionFingerprint))
      assert('PLAN_BINDING', plan.bindings.length === 1 && plan.bindings[0].sourceProjectId === project.id && /^[a-f0-9]{40}$/.test(String(plan.bindings[0].headCommit)), JSON.stringify(plan.bindings))
      const expiry = Date.parse(plan.expiresAt) - Date.parse(plan.createdAt)
      assert('PLAN_TTL_BOUNDED', expiry > 0 && expiry <= 5 * 60 * 1000 + 5_000, `ttl ${expiry}`)
      assert('PLAN_BLOCKERS_NAMED', Array.isArray(plan.blockers) && plan.blockers.every((blocker) => typeof blocker.code === 'string' && typeof blocker.owner === 'string'), JSON.stringify(plan.blockers))
      assert('PLAN_ARTIFACT_SCAN', Number.isSafeInteger(plan.artifactsChecked) && plan.artifactsChecked >= 0, String(plan.artifactsChecked))

      const rowsAfter = Object.fromEntries(tables.map((table) => [table, countRows(state, root, table)]))
      assert('PREPARE_WRITES_NOTHING', JSON.stringify(rowsAfter) === JSON.stringify(rowsBefore), `${JSON.stringify(rowsBefore)} -> ${JSON.stringify(rowsAfter)}`)
      assert('MARKER_UNCHANGED', sha(readFileSync(join(state, 'restore-report.json'))) === sha(markerBefore))
      const bindingsAfter = (() => {
        try {
          return readFileSync(join(state, 'native-projects.json'))
        } catch {
          return undefined
        }
      })()
      assert('BINDINGS_UNSAVED', (bindingsBefore === undefined) === (bindingsAfter === undefined) && (bindingsBefore === undefined || sha(bindingsAfter) === sha(bindingsBefore)))

      const stale = await client.request('/v1/recovery/prepare', {
        method: 'POST',
        body: { ...prepareBody, expectedFingerprint: '0'.repeat(64) },
      })
      assert('STALE_FINGERPRINT_REFUSED', stale.status === 409, `status ${stale.status} ${JSON.stringify(stale.body)}`)
      const foreign = await client.request('/v1/recovery/prepare', {
        method: 'POST',
        body: { expectedFingerprint: fingerprint, bindings: [{ sourceProjectId: 'project-not-configured', project: { path: repository, check: 'node_test' } }] },
      })
      assert('FOREIGN_PROJECT_REFUSED', foreign.status === 403, `status ${foreign.status} ${JSON.stringify(foreign.body)}`)
      const commit = await client.request('/v1/recovery/commit', { method: 'POST', body: { planId: plan.planId, expectedFingerprint: fingerprint } })
      assert('COMMIT_REFUSED', [403, 404, 422].includes(commit.status), `status ${commit.status} ${JSON.stringify(commit.body)}`)

      await server.stop()
      server = undefined
      const normalState = tempState('pa-w6-recovery-normal-').state
      normalServer = await startProduct({ root, port: ports.normalPort, stateRoot: normalState, consoleOrigin: `http://127.0.0.1:${ports.normalConsole}` })
      const normalClient = new LocalProductClient({ baseURL: `http://127.0.0.1:${ports.normalPort}`, stateDir: normalState, timeoutMs: 15_000 })
      const normalInspect = await normalClient.request('/v1/recovery/inspect')
      assert('NORMAL_INSPECT_NOT_RESTORED', normalInspect.status === 200 && normalInspect.body.state === 'normal' && normalInspect.body.blockers.some((blocker) => blocker.code === 'not_restored'), JSON.stringify(normalInspect.body?.blockers))
      const normalPrepare = await normalClient.request('/v1/recovery/prepare', {
        method: 'POST',
        body: { expectedFingerprint: normalInspect.body.inspectionFingerprint, bindings: [] },
      })
      assert('NORMAL_PREPARE_REFUSED', [403, 422].includes(normalPrepare.status), `status ${normalPrepare.status} ${JSON.stringify(normalPrepare.body)}`)

      evidence.recoveryPreflight = {
        inspection: {
          protocol: view.protocol,
          state: view.state,
          markerDigest: view.markerDigest,
          blockerCodes: view.blockers.map((blocker) => blocker.code),
          sourceWorksScanned: view.sourceWorksScanned,
        },
        plan: {
          protocol: plan.protocol,
          authorization: plan.authorization,
          commitAvailable: plan.commitAvailable,
          bindings: plan.bindings.map((binding) => ({ sourceProjectId: binding.sourceProjectId, headCommit: binding.headCommit })),
          artifactsChecked: plan.artifactsChecked,
          blockerCodes: plan.blockers.map((blocker) => blocker.code),
          ttlMs: expiry,
        },
        writes: { rowsBefore, rowsAfter, markerUnchanged: true, bindingsUnsaved: true },
        refusals: {
          staleFingerprint: stale.status,
          foreignProject: foreign.status,
          commit: commit.status,
          normalPrepare: normalPrepare.status,
        },
      }
    })
  } finally {
    await normalServer?.stop()
    await server?.stop()
    artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
  }

  return { cases, artifacts }
}
