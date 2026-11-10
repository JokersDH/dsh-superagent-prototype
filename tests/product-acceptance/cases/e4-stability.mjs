import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { cleanup, pickPort, processSnapshot, startProduct, stateSizeKb, tempState } from '../lib/instance.mjs'
import { FIXTURE_PROTOCOL, loadFixture } from '../lib/fixtures.mjs'
import { readRuntimeState } from '../lib/product-db.mjs'

const MAX_CYCLES = 30
const MAX_DURATION_MS = 45 * 60 * 1000

async function waitWork(client, workId, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await client.work(workId)
    if (predicate(latest)) return latest
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`work ${workId} never reached the expected state: ${JSON.stringify(latest)?.slice(0, 300)}`)
}

const CRITERIA = (configuration) => {
  const project = configuration.projects.find((item) => item.dispatchAllowed)
  const machine = project.defaultCriteria.find((item) => item.kind === 'machine' && item.required)
  const human = project.defaultCriteria.find((item) => item.kind === 'human' && item.required)
  return { project, machine, human }
}

/**
 * A portability checklist is an acceptance-side requirement list, not a product protocol. It is
 * applied to whatever manifest D publishes; until then it only proves the acceptance rules.
 */
function portabilityDecision(checklist, { requireRollback }) {
  if (!checklist || typeof checklist !== 'object') return { ok: false, reason: 'missing_checklist' }
  if (!Array.isArray(checklist.files) || checklist.files.length === 0)
    return { ok: false, reason: 'missing_files' }
  const unlistedState = checklist.files.some((file) => file.bytes === 0)
  if (unlistedState) return { ok: false, reason: 'empty_artifact' }
  // Same byte count is not enough: a verified digest that differs is content drift.
  const drift = checklist.files.some(
    (file) => file.verifiedSha256 !== undefined && file.verifiedSha256 !== file.sha256,
  )
  if (drift) return { ok: false, reason: 'content_drift' }
  if (requireRollback && (checklist.rollback?.supported !== true || !checklist.rollback?.restoresVersion))
    return { ok: false, reason: 'rollback_unsupported' }
  return { ok: true, reason: 'satisfied' }
}

export async function runE4({ root, runDirectory, keep = false, cycles = 10 }) {
  const cases = []
  const fixturesRoot = resolve(root, 'tests/product-acceptance/fixtures')
  const artifacts = { screenshots: [] }

  // Portable installation is not implemented in this checkout; say so precisely.
  const distributionPaths = {
    launcher: 'apps/launcher',
    distribution: 'tools/distribution',
    portability: 'packages/portability',
  }
  const missing = Object.entries(distributionPaths)
    .filter(([, path]) => !existsSync(join(root, path)))
    .map(([name]) => name)
  const installation = {
    status: missing.length ? 'absent' : 'present',
    missing,
    checkedPaths: distributionPaths,
  }

  const { root: tempRoot, state } = tempState('pa-e4-')
  const port = await pickPort()
  const consolePort = await pickPort()
  let server
  try {
    server = await startProduct({ root, port, stateRoot: state, consoleOrigin: `http://127.0.0.1:${consolePort}` })
    const client = new LocalProductClient({ baseURL: `http://127.0.0.1:${port}`, stateDir: state, timeoutMs: 25_000 })
    const configuration = await client.configuration()
    const { project, machine, human } = CRITERIA(configuration)
    let sequence = 0
    const commandId = (kind) => `e4-${kind}-${++sequence}`

    cases.push(
      await runCase(
        {
          id: 'E4-BOUNDED-CYCLES',
          title: 'Bounded mixed execution cycles keep resources and writer identity stable',
          layer: LAYERS.CONTROLLED,
          evidence: {},
          limitations: [
            'Bounded local soak: mixed controlled cycles, not a long-running production soak.',
            'RSS/FD/disk are observations of this instance only; absence of a process leak is not proven by ports.',
            'Physical writer proof for real vendors is B-owned evidence and is not claimed here.',
          ],
        },
        async ({ assert, evidence, note }) => {
          const cyclic = Math.min(Math.max(4, cycles), MAX_CYCLES)
          const startedAt = Date.now()
          const deadline = startedAt + MAX_DURATION_MS
          const baseline = processSnapshot(server.child.pid)
          const baselineReceipts = countReceipts(state)
          const baselineRuntime = readRuntimeState(state, root)
          const seenAttempts = new Set((baselineRuntime?.attempts ?? []).map((item) => item.attemptId))
          const seenTickets = new Set((baselineRuntime?.attempts ?? []).map((item) => item.ticketId))
          const observations = []
          const failures = []
          let reopened = false

          for (let cycle = 0; cycle < cyclic && Date.now() < deadline; cycle += 1) {
            if (!reopened && cycle === Math.ceil(cyclic / 2)) {
              const before = countReceipts(state)
              const runtimeBefore = readRuntimeState(state, root)
              await server.stop()
              server = await startProduct({
                root,
                port,
                stateRoot: state,
                consoleOrigin: `http://127.0.0.1:${consolePort}`,
              })
              const afterReceipts = countReceipts(state)
              const runtimeAfter = readRuntimeState(state, root)
              assert(
                'REOPEN_NO_NEW_NATIVE_WRITE',
                afterReceipts === before,
                `receipts ${before} -> ${afterReceipts} across a reopen`,
              )
              if (runtimeBefore && runtimeAfter)
                assert(
                  'REOPEN_NO_NEW_BEGIN',
                  runtimeAfter.begins === runtimeBefore.begins &&
                    runtimeAfter.attempts.length === runtimeBefore.attempts.length,
                  `begins ${runtimeBefore.begins}->${runtimeAfter.begins}, attempts ${runtimeBefore.attempts.length}->${runtimeAfter.attempts.length}`,
                )
              else note('runtime begin/attempt observation is UNKNOWN across the reopen')
              reopened = true
            }
            const mode = ['pass', 'question', 'fail', 'slow'][cycle % 4]
            const startedCycle = Date.now()
            const payload = {
              commandId: commandId(`cycle-${mode}`),
              conversationId: 'conv-e4',
              kind: 'create_work',
              projectId: project.id,
              profileId: `profile-fixture-${mode}`,
              goal: `E4 cycle ${cycle} ${mode}`,
              scope: project.scope,
              criteria: mode === 'question' ? [machine, human] : [machine],
            }
            const created = await client.dispatch(payload)
            if (created.receipt.status !== 'recorded') {
              failures.push({ cycle, step: 'create', receipt: created.receipt })
              break
            }
            const workId = created.receipt.workId
            try {
              if (mode === 'question') {
                let view = await waitWork(client, workId, (work) => work.openQuestionIds.length === 1)
                const question = (await client.snapshot({ workId })).questions[0]
                const answered = await client.dispatch({
                  commandId: commandId('answer'),
                  conversationId: 'conv-e4',
                  kind: 'answer_question',
                  questionId: question.id,
                  expectedVersion: question.version,
                  answer: { kind: 'choices', optionIds: ['allow'] },
                })
                assert('ANSWER', answered.receipt.status === 'recorded', JSON.stringify(answered.receipt))
                view = await waitWork(client, workId, (work) => work.actions.available.includes('accept_candidate'))
                await client.dispatch({
                  commandId: commandId('accept'),
                  conversationId: 'conv-e4',
                  kind: 'accept_candidate',
                  candidate: view.actions.currentCandidate,
                })
                await waitWork(client, workId, (work) => work.phase === 'delivered')
              } else if (mode === 'pass') {
                const view = await waitWork(client, workId, (work) =>
                  work.actions.available.includes('accept_candidate'),
                )
                const accepted = await client.dispatch({
                  commandId: commandId('accept'),
                  conversationId: 'conv-e4',
                  kind: 'accept_candidate',
                  candidate: view.actions.currentCandidate,
                })
                assert('ACCEPT', accepted.receipt.status === 'recorded', JSON.stringify(accepted.receipt))
                await waitWork(client, workId, (work) => work.phase === 'delivered')
              } else if (mode === 'fail') {
                const view = await waitWork(
                  client,
                  workId,
                  (work) => work.actions.currentVerificationId !== undefined || ['ended', 'uncertain'].includes(work.phase),
                )
                const verification = await client.verification(view.actions.currentVerificationId)
                assert(
                  'MACHINE_FAIL',
                  verification.results.some((item) => item.outcome === 'FAIL'),
                  JSON.stringify(verification.results),
                )
                assert('FAIL_NOT_DELIVERED', view.phase !== 'delivered')
              } else {
                // Wait until the attempt is actually registered, then stop while it is still in its
                // 1.5s write window, instead of stopping a work that never started.
                const attemptsBefore = seenAttempts.size
                const bindDeadline = Date.now() + 2_000
                while (Date.now() < bindDeadline) {
                  const observed = readRuntimeState(state, root)
                  if (observed && observed.attempts.length > attemptsBefore) break
                  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
                }
                const stopped = await client.dispatch({
                  commandId: commandId('stop'),
                  conversationId: 'conv-e4',
                  kind: 'stop_work',
                  workId,
                })
                assert('STOP', stopped.receipt.status === 'recorded', JSON.stringify(stopped.receipt))
                await waitWork(client, workId, (work) =>
                  ['ended', 'stopping', 'delivered', 'needs_user', 'uncertain'].includes(work.phase),
                )
              }

              const view = await client.work(workId)
              const runtime = readRuntimeState(state, root)
              const newAttempts = (runtime?.attempts ?? []).filter((item) => !seenAttempts.has(item.attemptId))
              assert(
                'AT_MOST_ONE_ATTEMPT_PER_CYCLE',
                runtime === null || newAttempts.length <= 1,
                `cycle ${cycle} created ${newAttempts.length} attempts`,
              )
              for (const attempt of newAttempts) {
                assert('UNIQUE_TICKET', !seenTickets.has(attempt.ticketId), `ticket ${attempt.ticketId} reused`)
                seenAttempts.add(attempt.attemptId)
                seenTickets.add(attempt.ticketId)
              }
              const snapshot = processSnapshot(server.child.pid)
              observations.push({
                cycle,
                mode,
                phase: view.phase,
                resourceStatus: view.resourceStatus,
                hadAttempt: newAttempts.length === 1,
                attempt: newAttempts[0]?.attemptId ?? null,
                durationMs: Date.now() - startedCycle,
                rssKb: snapshot.rssKb,
                openFds: snapshot.openFds,
                children: snapshot.children?.length ?? null,
                receipts: countReceipts(state),
                begins: runtime?.begins ?? null,
                dispatchObserved: runtime?.observed ?? null,
                stateKb: stateSizeKb(state),
              })
            } catch (error) {
              failures.push({ cycle, mode, payload, error: String(error?.message ?? error) })
              break
            }
          }

          const finalRuntime = readRuntimeState(state, root)
          const withAttempt = observations.filter((item) => item.hadAttempt).length
          evidence.cycles = {
            requested: cyclic,
            completed: observations.length,
            durationMs: Date.now() - startedAt,
            baseline,
            baselineReceipts,
            baselineRuntime,
            observations,
            failures,
            attemptCount: finalRuntime ? finalRuntime.attempts.length : null,
            finalReceipts: countReceipts(state),
            finalBegins: finalRuntime?.begins ?? null,
            finalObserved: finalRuntime?.observed ?? null,
            finalStateKb: stateSizeKb(state),
          }
          assert('NO_CYCLE_FAILURE', failures.length === 0, JSON.stringify(failures))
          assert('ALL_CYCLES_COMPLETED', observations.length === cyclic)
          assert('ATTEMPTS_RECORDED', withAttempt >= 1, 'no cycle produced a physical attempt')
          if (!baselineRuntime || !finalRuntime) {
            note('runtime attempt/begin observation is UNKNOWN (schema unavailable)')
          } else {
            const newAttempts = finalRuntime.attempts.length - baselineRuntime.attempts.length
            const newBegins = finalRuntime.begins - baselineRuntime.begins
            assert('ATTEMPTS_MATCH_CYCLES', newAttempts === withAttempt, `${newAttempts} attempts for ${withAttempt} started works`)
            // A work stopped before begin may register a binding without a begin ACK; completed
            // cycles must each have one, and no attempt may receive more than one begin.
            const completedAttempts = observations.filter((item) => item.mode !== 'slow' && item.hadAttempt).length
            assert(
              'BEGINS_AT_LEAST_COMPLETED',
              newBegins >= completedAttempts,
              `${newBegins} begin ACKs for ${completedAttempts} completed attempts`,
            )
            assert(
              'BEGINS_NOT_MORE_THAN_ATTEMPTS',
              newBegins <= newAttempts,
              `${newBegins} begin ACKs for ${newAttempts} attempts`,
            )
            // dispatch.observed also covers deliver/answer/cancel, so it must be at least one per
            // attempt; equality with attempts would be an incorrect assumption.
            assert(
              'DISPATCH_OBSERVED_AT_LEAST_ATTEMPTS',
              finalRuntime.observed - baselineRuntime.observed >= newAttempts,
              `${finalRuntime.observed - baselineRuntime.observed} dispatch facts for ${newAttempts} attempts`,
            )
          }

          const last = observations.at(-1)
          assert('PROCESS_ALIVE', last !== null && last.rssKb !== null && last.rssKb !== undefined)
          assert(
            'CHILDREN_BOUNDED',
            (last.children ?? 0) <= (baseline.children?.length ?? 0) + 1,
            `children ${last.children} vs baseline ${baseline.children?.length ?? 0}`,
          )
          assert(
            'FD_BOUNDED',
            last.openFds === null || last.openFds <= (baseline.openFds ?? 0) + 80,
            `fds ${last.openFds} vs baseline ${baseline.openFds}`,
          )
          assert('RECEIPTS_MONOTONIC', last.receipts >= baselineReceipts)
          assert('STATE_PERSISTED', last.stateKb !== null && last.stateKb > 0)
          const durations = observations.map((item) => item.durationMs).sort((a, b) => a - b)
          note(
            `cycles ${observations.length}/${cyclic}; latency median ${durations[Math.floor(durations.length / 2)]}ms; ` +
              `receipts ${baselineReceipts}->${last.receipts}; rss ${baseline.rssKb}->${last.rssKb} kB; fds ${baseline.openFds}->${last.openFds}`,
          )
        },
      ),
    )
  } finally {
    await server?.stop()
    artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
  }

  cases.push(
    await runCase(
      {
        id: 'E4-PORTABILITY-CHECKLIST',
        title: 'Portability checklist rules accept a complete bundle and refuse an incomplete one',
        layer: LAYERS.READONLY,
        evidence: {},
        limitations: [
          'Acceptance-side checklist only; D has not published a real bundle manifest yet.',
          'No installation, first-run, backup or rollback was executed.',
        ],
      },
      async ({ assert, evidence }) => {
        const complete = loadFixture(join(fixturesRoot, 'portability/bundle-checklist.json'), 'bundle-checklist')
        const noRollback = loadFixture(
          join(fixturesRoot, 'portability/bundle-checklist-no-rollback.json'),
          'bundle-checklist',
        )
        assert('COMPLETE_ACCEPTED', portabilityDecision(complete.data, { requireRollback: true }).ok === true)
        const refusal = portabilityDecision(noRollback.data, { requireRollback: true })
        assert('ROLLBACK_REQUIRED', refusal.ok === false && refusal.reason === 'rollback_unsupported', refusal.reason)
        const driftDocs = structuredClone(complete.data)
        driftDocs.files[0].verifiedSha256 = '9'.repeat(64)
        const drift = portabilityDecision(driftDocs, { requireRollback: true })
        assert('SAME_SIZE_DRIFT_REJECTED', drift.ok === false && drift.reason === 'content_drift', drift.reason)

        const corrupt = mkdtempSync(join(tmpdir(), 'pa-bundle-'))
        try {
          const path = join(corrupt, 'checklist.json')
          writeFileSync(
            path,
            JSON.stringify({
              protocol: FIXTURE_PROTOCOL,
              id: 'bundle-checklist',
              type: 'bundle-checklist',
              data: {
                version: '0.1.0',
                files: [{ path: '../escape', sha256: 'f'.repeat(64), bytes: 1 }],
                rollback: { supported: true, restoresVersion: '0.0.1' },
              },
            }),
          )
          let refused
          try {
            loadFixture(path, 'bundle-checklist')
          } catch (error) {
            refused = error
          }
          assert('CORRUPT_REFUSED', refused !== undefined)
        } finally {
          rmSync(corrupt, { recursive: true, force: true })
        }
        evidence.fixture = { id: complete.id, path: complete.path, sha256: complete.sha256 }
        evidence.portability = {
          complete: portabilityDecision(complete.data, { requireRollback: true }),
          noRollback: portabilityDecision(noRollback.data, { requireRollback: true }),
          installation,
        }
      },
    ),
  )

  for (const [id, title] of [
    ['E4-INSTALL-FIRST-RUN', 'Install into a fresh directory/account and complete first-run'],
    ['E4-BACKUP-RESTORE', 'Full backup, restore and path mapping on a new location'],
    ['E4-UPGRADE-ROLLBACK', 'Upgrade and roll back a local installation'],
  ]) {
    cases.push(
      notTested(
        {
          id,
          title,
          layer: LAYERS.NOT_TESTED,
          limitations: [
            'Agent D owns apps/launcher, tools/distribution and packages/portability; they are absent here.',
            'Declared NOT_TESTED rather than inferred from developer launcher behaviour.',
          ],
        },
        `No portable distribution exists in this checkout (missing: ${missing.join(', ') || 'none'}). ` +
          'The developer workbench launcher is not an installation path.',
      ),
    )
    cases.at(-1).evidence.installation = installation
  }

  return { cases, artifacts }
}

function countReceipts(stateRoot) {
  try {
    const directory = join(stateRoot, 'receipts')
    if (!existsSync(directory)) return 0
    return readdirSync(directory).length
  } catch {
    return 0
  }
}
