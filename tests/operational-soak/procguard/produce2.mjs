#!/usr/bin/env node
/**
 * Wave-29 safe-process v2 evidence.
 *
 *   node tests/operational-soak/procguard/produce2.mjs --out <new-directory> [--json]
 *
 * All pure controls run before any live signal. Only registered own-probe handles can be signalled;
 * root/config/operation are compared to the exact spawn arguments and the child's own birth report;
 * UNKNOWN ps observations are never treated as gone.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOptions } from '../../../tools/trial-kit/lib/args.mjs'
import { EXIT, nowIso } from '../../../tools/trial-kit/lib/output.mjs'
import { homeDir, redactValue } from '../../../tools/trial-kit/lib/redact.mjs'
import { classifyFixtures, pureControls, signalFresh, spawnOwnProbe, unregister, waitGone } from './guard2.mjs'

const USAGE = `produce2 — registered birth/exact args/UNKNOWN/fresh signal 证据
用法: node tests/operational-soak/procguard/produce2.mjs --out <新目录> [--json]
退出: 0 全部按预期, 1 有未预期差异, 2 参数拒绝, 3 INTERNAL
`

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), { out: 'string', json: 'boolean', help: 'boolean' }) } catch (error) {
    process.stderr.write(`produce2: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { process.stdout.write(`${USAGE}\n`); return EXIT.OK }
  if (values.out === undefined) { process.stderr.write('produce2: REFUSED usage: --out <new-directory> is required\n'); return EXIT.REFUSED }
  const out = resolve(values.out)
  try { mkdirSync(out, { mode: 0o700, recursive: false }) } catch (error) {
    process.stderr.write(`produce2: REFUSED ${error?.code === 'EEXIST' ? 'output_exists' : 'output_unavailable'}: ${out}\n`)
    return EXIT.REFUSED
  }
  let signalsSent = 0
  let foreignSignals = 0
  try {
    const normal = await spawnOwnProbe({ root: join(out, 'normal'), operation: 'wave29-procguard-normal' })
    const controls = pureControls(normal.handle)
    const controlsOk = controls.every((entry) => entry.expected === undefined
      ? entry.signal?.sent === false && entry.signal?.refused === entry.expectedRefusal
      : entry.result?.ok === entry.expected)
    // Pure controls must pass before any signal.
    if (!controlsOk) {
      const report = { protocol: 'procguard-v2/1', generatedAt: nowIso(), controls, checks: { pureControls: false }, ok: false, signalsSent, foreignSignals }
      writeFileSync(join(out, 'report.json'), `${JSON.stringify(redactValue(report, { home: homeDir() }), null, 2)}\n`, { mode: 0o600 })
      process.stderr.write('produce2: REFUSED pure controls failed; no signal sent\n')
      unregister(normal.handle)
      return EXIT.REFUSED
    }
    const term = signalFresh({ handle: normal.handle, signal: 'SIGTERM' })
    if (term.sent) signalsSent += 1
    const normalGone = await waitGone(normal.handle)

    const stubborn = await spawnOwnProbe({ root: join(out, 'stubborn'), operation: 'wave29-procguard-stubborn', ignoreTerm: true })
    const firstTerm = signalFresh({ handle: stubborn.handle, signal: 'SIGTERM' })
    if (firstTerm.sent) signalsSent += 1
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
    const stillAlive = (await waitGone(stubborn.handle, 50)).gone === false
    const kill = signalFresh({ handle: stubborn.handle, signal: 'SIGKILL' })
    if (kill.sent) signalsSent += 1
    const stubbornGone = await waitGone(stubborn.handle)

    const sibling = await spawnOwnProbe({ root: join(out, 'sibling'), operation: 'wave29-procguard-sibling' })
    const plainForged = { ...normal.record, pid: sibling.record.pid }
    const forgedResult = signalFresh({ handle: plainForged, signal: 'SIGTERM' })
    if (forgedResult.sent) foreignSignals += 1
    const siblingAlive = (await waitGone(sibling.handle, 50)).gone === false
    const siblingTerm = signalFresh({ handle: sibling.handle, signal: 'SIGTERM' })
    if (siblingTerm.sent) signalsSent += 1
    const siblingGone = await waitGone(sibling.handle)

    // ps UNKNOWN is not gone: a live registered probe with an unreadable observer stays not-gone.
    const unknownProbe = await spawnOwnProbe({ root: join(out, 'unknown'), operation: 'wave29-procguard-unknown' })
    const unknownGone = await waitGone(unknownProbe.handle, 100, () => ({ state: 'unknown', reason: 'ps_failed' }))
    const unknownSignal = signalFresh({ handle: unknownProbe.handle, signal: 'SIGTERM', observer: () => ({ state: 'unknown', reason: 'ps_failed' }) })
    if (unknownSignal.sent) foreignSignals += 1
    const unknownTerm = signalFresh({ handle: unknownProbe.handle, signal: 'SIGTERM' })
    if (unknownTerm.sent) signalsSent += 1
    const unknownRealGone = await waitGone(unknownProbe.handle)

    const checks = {
      birthComplete: ['pid', 'ppid', 'uid', 'start', 'command', 'root', 'config', 'operation', 'argv', 'birth'].every((field) => normal.record[field] !== undefined && normal.record[field] !== null),
      exactArgs: normal.record.birth.argv.every((value, index) => value === normal.record.argv[index]) && normal.record.birth.argv.length === normal.record.argv.length,
      birthRootConfigOperation: normal.record.birth.root === normal.record.root && normal.record.birth.config === normal.record.config && normal.record.birth.operation === normal.record.operation,
      pureControls: controlsOk,
      termSent: term.sent === true,
      normalGone: normalGone.gone === true,
      stubbornIgnoredTerm: stillAlive === true,
      killFreshSent: kill.sent === true,
      stubbornGone: stubbornGone.gone === true,
      plainRecordRejected: forgedResult.refused === 'not_registered' && forgedResult.sent === false,
      siblingUnaffected: siblingAlive === true,
      siblingCleaned: siblingGone.gone === true,
      unknownNotGone: unknownGone.gone === false && unknownGone.unknown === true,
      unknownSignalRefused: unknownSignal.sent === false && unknownSignal.refused === 'unknown_observation',
      unknownRealGone: unknownRealGone.gone === true,
      noForeignSignals: foreignSignals === 0,
      psClassification: classifyFixtures().gone.state === 'gone' && classifyFixtures().unknownPermission.state === 'unknown' && classifyFixtures().unknownParse.state === 'unknown',
    }
    const report = {
      protocol: 'procguard-v2/1', generatedAt: nowIso(),
      births: { normal: normal.record, stubborn: stubborn.record, sibling: sibling.record, unknown: unknownProbe.record },
      controls,
      proofs: { term, firstTerm, kill, forgedResult, siblingTerm, unknownGone, unknownSignal, unknownTerm },
      waits: { normalGone, stubbornGone, siblingGone, unknownGone, unknownRealGone },
      psClassification: classifyFixtures(),
      counts: { signalsSent, foreignSignals },
      checks, ok: Object.values(checks).every(Boolean),
      notReached: ['product/B daemon lifecycle', 'product/B runner SIGKILL', 'global discovery'],
      limits: ['only registered probes spawned by this run are signalled', 'UNKNOWN ps observation never becomes gone', 'exact argv/root/config/operation and fresh re-read before every signal'],
    }
    const redacted = redactValue(report, { home: homeDir() })
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(redacted, null, 2)}\n`, { mode: 0o600 })
    if (values.json === true) process.stdout.write(`${JSON.stringify(redacted, null, 2)}\n`)
    else process.stdout.write([
      `procguard2-produce: ${report.ok ? 'OK' : 'UNEXPECTED'}`,
      `  birth: pid=${normal.record.pid} ppid=${normal.record.ppid} uid=${normal.record.uid} start="${normal.record.start}"`,
      `  exact args: ${checks.exactArgs}; birth root/config/op: ${checks.birthRootConfigOperation}`,
      `  controls: ${controls.map((entry) => `${entry.id}=${entry.expected ?? entry.signal?.refused}`).join(' ')}`,
      `  signals: own=${signalsSent} foreign=${foreignSignals}; unknownNotGone=${checks.unknownNotGone}`,
      `  root: ${out.replace(homeDir(), '~')}`,
    ].join('\n'))
    return report.ok ? EXIT.OK : EXIT.DEGRADED
  } catch (error) {
    process.stderr.write(`produce2: REFUSED ${String(error?.code ?? error?.message ?? error)}\n`)
    return EXIT.DEGRADED
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`produce2: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = EXIT.INTERNAL
})
