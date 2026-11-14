import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { extractFrozen, freePort, launcher, privateRoot, startOwned, stopOwned } from '../lib/packaged-instance.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact, packagedFile } from '../lib/frozen-package.mjs'

/**
 * Wave-27 input boundaries that are not product capabilities.
 *
 * Each case states what actually exists in this checkout / frozen package and what does not. A
 * contract module or a report summary is input only: it never substitutes for an integrated channel,
 * a wired metric, or an installed UI field.
 */
export async function runInputs() {
  const cases = []
  const target = loadFrozenArtifact('target', DEFAULT_FROZEN_DIRS.target)

  cases.push(await runCase({ id: 'E9-COORDINATOR-CHANNEL-CONTRACT',
    title: 'The coordinator channel contract correlates exact requests/replies and admits native writes only for the existing answer hook',
    layer: LAYERS.READONLY, evidence: {} }, async ({ assert, evidence }) => {
    const module = await import(resolve('packages/contracts/src/coordinator-channel.ts'))
    const request = module.CoordinatorChannelRequestSchema
    const reply = module.CoordinatorChannelReplySchema
    const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
    const base = { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract, attemptId: 'attempt-1', fenceEpoch: 1 }
    const fact = { ...base, factId: 'fact-1', source: 'source-1', kind: 'dispatch.observed', payloadRef: 'payload-1' }
    const validFact = request.safeParse({ v: 1, type: 'fact', id: 'fact-1', fact })
    const mismatchedFact = request.safeParse({ v: 1, type: 'fact', id: 'other', fact })
    const validPayload = request.safeParse({ v: 1, type: 'payload-read', id: 'req-1', requestId: 'req-1', reference: 'blob-1' })
    const mismatchedPayload = request.safeParse({ v: 1, type: 'payload-read', id: 'req-1', requestId: 'req-2', reference: 'blob-1' })
    const answerWrite = request.safeParse({ v: 1, type: 'native-write-intent', id: 'w-1',
      command: { ...base, id: 'command-1', kind: 'answer', nativeBindingRef: 'binding-1', answerRef: 'answer-1' } })
    const otherWrite = request.safeParse({ v: 1, type: 'native-write-intent', id: 'w-2',
      command: { ...base, id: 'command-2', kind: 'cancel' } })
    const goodReceipt = reply.safeParse({ v: 1, type: 'receipt', id: 'fact-1', factId: 'fact-1', receipt: { factId: 'fact-1', persisted: true, seq: 1 } })
    const badReceipt = reply.safeParse({ v: 1, type: 'receipt', id: 'fact-2', factId: 'fact-1', receipt: { factId: 'fact-1', persisted: true, seq: 1 } })
    const producerMismatch = module.sameCoordinatorChannelProducer(
      { attempt: base, runnerIdentityRef: 'runner-1', source: 'source-1' },
      { attempt: base, runnerIdentityRef: 'runner-2', source: 'source-1' })
    const consumer = (() => {
      try {
        const text = readFileSync(resolve('apps/coordinator/main.ts'), 'utf8')
        return /coordinator-channel|CoordinatorChannel/u.test(text) ? 'referenced' : 'NOT_INTEGRATED'
      } catch { return 'NOT_READABLE' }
    })()
    evidence.channelContract = { module: 'packages/contracts/src/coordinator-channel.ts', validFact: validFact.success,
      mismatchedFact: mismatchedFact.success, validPayload: validPayload.success, mismatchedPayload: mismatchedPayload.success,
      answerWrite: answerWrite.success, otherWrite: otherWrite.success, goodReceipt: goodReceipt.success,
      badReceipt: badReceipt.success, producerMismatch, consumer,
      limits: module.CoordinatorChannelLimitsSchema?.safeParse?.({})?.success ?? null }
    assert('CHANNEL_FACT_CORRELATION', validFact.success === true && mismatchedFact.success === false, 'fact correlation')
    assert('CHANNEL_PAYLOAD_CORRELATION', validPayload.success === true && mismatchedPayload.success === false, 'payload correlation')
    assert('CHANNEL_ANSWER_ONLY_WRITE', answerWrite.success === true && otherWrite.success === false, 'native write admission')
    assert('CHANNEL_RECEIPT_CORRELATION', goodReceipt.success === true && badReceipt.success === false, 'reply correlation')
    assert('CHANNEL_PRODUCER_IDENTITY', producerMismatch === false, String(producerMismatch))
    assert('CHANNEL_CONSUMER_RECORDED', consumer === 'NOT_INTEGRATED' || consumer === 'referenced', consumer)
  }))

  // The packaged bytes are the only admissible installed source: a newer main source file is not one.
  const packagedTrial = (() => {
    for (const entry of assetEntries(target)) {
      const text = packagedFile(target, entry)
      if (typeof text === 'string' && text.includes('试用准备')) return { entry, text }
    }
    return null
  })()
  const mainTrial = (() => {
    try { return readFileSync(resolve('apps/console/src/trial/useTrialReadiness.ts'), 'utf8') } catch { return null }
  })()
  cases.push(notTested({ id: 'E11-TRIAL-IDENTITY-FIELDS',
    title: 'The installed trial workbench accepts a new {enabled, identity} hook and isolates stale readiness across identity switches',
    layer: LAYERS.INSTALLED, limitations: [
      'Installed claims must come from the frozen tar; a newer main source file cannot be relabelled as these bytes.',
    ], evidence: { trialIdentity: { subject: frozenArtifactSubject(target),
      packagedMarker: packagedTrial ? { entry: packagedTrial.entry, hasIdentity: /identity/u.test(packagedTrial.text) } : null,
      mainSourcePresent: mainTrial !== null,
      mainSourceIdentity: mainTrial ? /identity/u.test(mainTrial) : null } } },
    mainTrial !== null
      ? 'NOT_REACHED: main contains a newer trial readiness source, but the frozen package bytes do not carry the {enabled, identity} field; an installed identity-isolation claim needs a successor frozen package, not a source relabel.'
      : 'NOT_REACHED: no trial readiness identity source is present in this checkout.'))

  const gModule = (() => {
    try { return readFileSync(resolve('packages/usage-insights/src/index.ts'), 'utf8').slice(0, 200) } catch { return null }
  })()
  const gWired = (() => {
    try {
      const text = readFileSync(resolve('apps/console/src/App.tsx'), 'utf8')
      return /usage-insights|usageInsights/u.test(text)
    } catch { return false }
  })()
  cases.push(notTested({ id: 'E13-G-SCOPED-SUMMARY',
    title: 'A scoped G summary with project/window/coverage/unknown is shown only where main actually wires it',
    layer: LAYERS.INSTALLED, evidence: { gSummary: { modulePresent: gModule !== null, wiredToConsole: gWired } } },
    gWired
      ? 'NOT_REACHED: the console references a usage-insights module, but no installed G summary case has been recorded against frozen bytes.'
      : 'NOT_ADMITTED: G metrics are not wired into the default product UI in this checkout; no scoped summary is consumed, so no efficiency or completion claim is made from G reports.'))

  cases.push(await runCase({ ...define('E17-SUPPORT-MATERIAL', 'Package support output is owner-only, non-overwriting and carries no credential material'), evidence: {} },
    async ({ assert, evidence }) => {
      const root = privateRoot('pa-e-w27-support-')
      try {
        extractFrozen(target, root.install)
        const first = launcher(root.install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state } })
        assert('SUPPORT_FIRST_RUN', first.status === 0, JSON.stringify(first).slice(0, 300))
        const ports = [await freePort(), await freePort()]
        const started = startOwned(root, { ports, fixture: true, timeoutMs: 60_000 })
        const running = await started.value
        assert('SUPPORT_STATE_READY', running.status === 'RUNNING', JSON.stringify(running).slice(0, 300))
        const stopped = await stopOwned(root, { equivalentProof: true })
        assert('SUPPORT_STATE_STOPPED', stopped.clean === true, JSON.stringify({ reason: stopped.reason, package: stopped.packageStop?.json?.status ?? null }))
        const bundleOne = join(root.own, 'support-one.pab')
        const backup = launcher(root.install, ['backup', '--out', bundleOne, '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state } })
        assert('SUPPORT_BACKUP_CREATED', backup.status === 0 && backup.json?.status === 'CREATED', JSON.stringify(backup).slice(0, 300))
        const mode = existsSync(bundleOne) ? statSync(bundleOne).mode & 0o777 : null
        const repeated = launcher(root.install, ['backup', '--out', bundleOne, '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state } })
        const bytes = existsSync(bundleOne) ? readFileSync(bundleOne) : Buffer.alloc(0)
        const text = bytes.toString('latin1')
        const credentialLike = /"?(api[_-]?key|model[_-]?key|authorization|bootstrapToken|action\.key)"?\s*[:=]\s*"[A-Za-z0-9+/=_-]{16,}"/u.test(text)
        evidence.supportMaterial = { subject: frozenArtifactSubject(target), bundle: { path: bundleOne, bytes: bytes.byteLength, mode: mode?.toString(8) ?? null },
          repeated: { status: repeated.status, result: repeated.json?.status ?? repeated.json?.code ?? null },
          credentialLike, installManifestMode: existsSync(join(root.install, 'install.json')) ? (statSync(join(root.install, 'install.json')).mode & 0o777).toString(8) : null,
          releaseManifestMode: existsSync(join(root.config, 'release.json')) ? (statSync(join(root.config, 'release.json')).mode & 0o777).toString(8) : null }
        assert('SUPPORT_MODE_0600', mode !== null && (mode & 0o077) === 0, String(mode?.toString(8)))
        assert('SUPPORT_NO_OVERWRITE', repeated.status !== 0, JSON.stringify({ status: repeated.status, result: repeated.json?.status ?? null }))
        assert('SUPPORT_NO_CREDENTIAL', credentialLike === false, 'the bundle appears to contain a credential-shaped value')
      } finally { rmSync(root.own, { recursive: true, force: true }) }
    }))

  return { cases, artifacts: {} }
}

const define = (id, title) => ({ id, title, layer: LAYERS.INSTALLED, limitations: [
  'Runs only packaged bytes from the frozen tar in a private temporary root; no user instance or account home is read.',
] })

function assetEntries(target) {
  const listing = spawnSync('tar', ['-tzf', target.tarPath], { encoding: 'utf8', timeout: 60_000 })
  return String(listing.stdout).split('\n').filter(line => /apps\/console\/dist\/assets\/index-.*\.js$/u.test(line))
}
