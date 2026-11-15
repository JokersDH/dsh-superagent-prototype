#!/usr/bin/env node
/**
 * Produce the wave-28 safe-process package.
 *
 *   node tests/operational-soak/procguard/produce.mjs --out <new-directory> [--json]
 *
 * Spawns only probes owned by this run, records PID/parent/UID/start/full argv/root/config/operation,
 * refuses every forged/foreign/sibling/recycled record with zero signals, and sends TERM/KILL only
 * after a fresh whole-record re-read immediately before that signal. Unknown resources are retained.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOptions } from '../../../tools/trial-kit/lib/args.mjs'
import { EXIT, nowIso } from '../../../tools/trial-kit/lib/output.mjs'
import { homeDir, redactPath, redactValue } from '../../../tools/trial-kit/lib/redact.mjs'
import { observeProcess, pureControls, signalFresh, spawnOwnProbe, waitGone } from './guard.mjs'

const USAGE = `produce — 自有进程出生/fresh signal 证据
用法: node tests/operational-soak/procguard/produce.mjs --out <新目录> [--json]
输出: report.json
退出: 0 全部按预期, 1 有未预期差异, 2 参数拒绝, 3 INTERNAL
`

function redactRecord(record) {
  return { ...record, root: redactPath(record.root, homeDir()), config: redactPath(record.config, homeDir()), argv: record.argv.map((entry) => redactPath(entry, homeDir())) }
}

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), { out: 'string', json: 'boolean', help: 'boolean' }) } catch (error) {
    process.stderr.write(`produce: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { process.stdout.write(`${USAGE}\n`); return EXIT.OK }
  if (values.out === undefined) { process.stderr.write('produce: REFUSED usage: --out <new-directory> is required\n'); return EXIT.REFUSED }
  const out = resolve(values.out)
  try { mkdirSync(out, { mode: 0o700, recursive: false }) } catch (error) {
    process.stderr.write(`produce: REFUSED ${error?.code === 'EEXIST' ? 'output_exists' : 'output_unavailable'}: ${out}\n`)
    return EXIT.REFUSED
  }
  let signalsSent = 0
  let foreignSignals = 0
  try {
    // 1. normal own probe: TERM only after a fresh whole-record check.
    const normal = await spawnOwnProbe({ root: join(out, 'normal'), operation: 'wave28-procguard-normal' })
    const controls = pureControls(normal.record)
    const controlsOk = controls.filter((entry) => entry.id !== 'own_matches').every((entry) => entry.expected.ok === false)
      && controls.find((entry) => entry.id === 'own_matches').expected.ok === true
    const term = signalFresh({ record: normal.record, signal: 'SIGTERM' })
    if (term.sent === true) signalsSent += 1
    const normalGone = await waitGone(normal.record.pid)
    const normalBirth = redactRecord(normal.record)

    // 2. probe that ignores TERM: KILL requires its own fresh re-read.
    const stubborn = await spawnOwnProbe({ root: join(out, 'stubborn'), operation: 'wave28-procguard-stubborn', ignoreTerm: true })
    const firstTerm = signalFresh({ record: stubborn.record, signal: 'SIGTERM' })
    if (firstTerm.sent === true) signalsSent += 1
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
    const stillAlive = observeProcess(stubborn.record.pid).alive === true
    const secondTermReplay = signalFresh({ record: stubborn.record, signal: 'SIGKILL' })
    if (secondTermReplay.sent === true) signalsSent += 1
    const stubbornGone = await waitGone(stubborn.record.pid)

    // 3. sibling: a forged record pointing at another live owned probe must send nothing.
    const sibling = await spawnOwnProbe({ root: join(out, 'sibling'), operation: 'wave28-procguard-sibling' })
    const forged = { ...normal.record, pid: sibling.record.pid }
    const forgedResult = signalFresh({ record: forged, signal: 'SIGTERM' })
    if (forgedResult.sent === true) foreignSignals += 1
    const siblingAlive = observeProcess(sibling.record.pid).alive === true
    const siblingTerm = signalFresh({ record: sibling.record, signal: 'SIGTERM' })
    if (siblingTerm.sent === true) signalsSent += 1
    const siblingGone = await waitGone(sibling.record.pid)

    // 4. pre-record/unknown pid: refused and material retained (no root deletion).
    const unknownRecord = { ...normal.record, pid: 999999, operation: 'wave28-procguard-unknown' }
    const unknownResult = signalFresh({ record: unknownRecord, signal: 'SIGTERM' })

    const checks = {
      ownBirthComplete: ['pid', 'ppid', 'uid', 'start', 'command', 'root', 'config', 'operation'].every((field) => normalBirth[field] !== undefined && normalBirth[field] !== null),
      ownMatches: controls.find((entry) => entry.id === 'own_matches').expected.ok === true,
      pureRefusals: controlsOk,
      termFreshSent: term.sent === true,
      termGone: normalGone.gone === true,
      stubbornIgnoredTerm: stillAlive === true,
      killFreshSent: secondTermReplay.sent === true,
      stubbornGone: stubbornGone.gone === true,
      siblingRefused: forgedResult.sent === false && forgedResult.refused === 'identity_not_fresh',
      siblingUnaffected: siblingAlive === true,
      siblingCleaned: siblingGone.gone === true,
      unknownRefused: unknownResult.sent === false,
      noForeignSignals: foreignSignals === 0,
    }
    const report = {
      protocol: 'procguard-report/1', generatedAt: nowIso(), root: redactPath(out, homeDir()),
      births: { normal: normalBirth, stubborn: redactRecord(stubborn.record), sibling: redactRecord(sibling.record) },
      controls: controls.map((entry) => ({ id: entry.id, ok: entry.expected.ok, issues: entry.expected.issues })),
      proofs: { term, firstTerm, secondTermReplay, forgedRefused: forgedResult, siblingTerm, unknownRefused: unknownResult },
      waits: { normalGone, stubbornGone, siblingGone },
      counts: { signalsSent, foreignSignals },
      checks, ok: Object.values(checks).every(Boolean),
      notReached: ['product/B daemon lifecycle stop/upgrade', 'SIGKILL of a product/B runner', 'global process/socket discovery'],
      limits: ['only probes spawned by this run are signalled; no product or user process is touched', 'TERM/KILL each require a fresh whole-record match; unknown material is retained'],
    }
    report.births = redactValue(report.births, { home: homeDir() })
    report.proofs = redactValue(report.proofs, { home: homeDir() })
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    if (values.json === true) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else process.stdout.write([
      `procguard-produce: ${report.ok ? 'OK' : 'UNEXPECTED'}`,
      `  birth: pid=${normalBirth.pid} ppid=${normalBirth.ppid} uid=${normalBirth.uid} start="${normalBirth.start}"`,
      `  signals: ${signalsSent} own (TERM/KILL), foreign=${foreignSignals}`,
      `  controls: ${controls.map((entry) => `${entry.id}=${entry.expected.ok}`).join(' ')}`,
      `  root: ${redactPath(out, homeDir())}`,
    ].join('\n'))
    return report.ok ? EXIT.OK : EXIT.DEGRADED
  } catch (error) {
    process.stderr.write(`produce: REFUSED ${String(error?.code ?? error?.message ?? error)}\n`)
    return EXIT.DEGRADED
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`produce: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = EXIT.INTERNAL
})
