#!/usr/bin/env node
/**
 * Wave-31 B1: the signal tool is driven by an immutable SPAWN INTENT, not a ps snapshot.
 *
 * Every negative below runs with fully mocked spawn/ps/pgrep/kill and asserts the kill spy count: a
 * refused handle may not produce even one signal. One limited live positive then exercises the same code
 * with the real /bin/ps on a probe-owned fixture.
 */
import { spawn as realSpawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { adoptSpawn, confirmExit, configureSignalGuard, escalate, resetSignalGuard, signalOwned, spawnOwned, verify } from './signal-guard.mjs'

const log = new CaseLog()
const FIXTURE = fileURLToPath(new URL('./signal-child-fixture.mjs', import.meta.url))
const RUNNER = 'fake-runner.mjs'
const ARGV = [RUNNER, '--root=/tmp/w31-root', '--config=/tmp/w31-root/config.json', '--operation=run']
const META = { root: '--root=/tmp/w31-root', config: '--config=/tmp/w31-root/config.json', operation: '--operation=run' }
const second = () => new Promise(resolve => setTimeout(resolve, 40))

/** A deterministic mock world: pid -> live snapshot, ppid -> children, and a kill spy. */
function mockWorld() {
  const world = { nextPid: 4100, procs: new Map(), children: new Map(), kills: [], psCalls: 0 }
  world.add = (pid, argv, extra = {}) => world.procs.set(pid, { state: 'live', pid, uid: 501, ppid: 1, start: extra.start ?? 'Sat Nov 15 10:00:00 2026', argv: argv.join(' '), ...extra })
  configureSignalGuard({
    // A real ChildProcess carries its own spawnfile/spawnargs; the mock must too, because the tool now
    // takes authority from that object and refuses a numeric pid outright.
    spawn: (executable, args) => ({ pid: world.nextPid++, spawnfile: executable, spawnargs: [executable, ...args] }),
    ps: (pid) => { world.psCalls += 1; return world.procs.get(pid) ?? { state: 'gone', reason: 'silent_absence' } },
    pgrep: (pid) => world.children.get(pid) ?? { state: 'ok', children: [] },
    kill: (pid, signal) => { world.kills.push([pid, signal]) },
  })
  return world
}
/** Pre-register the pid the mock spawner will hand out, then register the spawn intent. */
function mockSpawn(world, args, intent) {
  world.add(world.nextPid, [process.execPath, ...args])
  return spawnOwned(process.execPath, args, intent)
}

try {
  // ---------------------------------------------------------------- mocked negatives / positives
  log.begin('B31-SIGNAL-SPAWN-INTENT-POSITIVE', 'the spawner intent alone authorises exactly one owned pid', 'pure_mock')
  {
    const world = mockWorld()
    const spawned = mockSpawn(world, ['--root=/tmp/w31-root'], { root: '--root=/tmp/w31-root', expectedChildren: [700] })
    world.children.set(spawned.child.pid, { state: 'ok', children: [700] })
    const sent = signalOwned(spawned.handle, 'SIGKILL')
    log.evidence({ sent, kills: world.kills.length, psCalls: world.psCalls })
    if (sent.sent && world.kills.length === 1 && world.kills[0][0] === spawned.child.pid) log.pass(`one owned pid was signalled once (ps read ${world.psCalls}x, including the fresh check)`)
    else log.fail(`the owned positive did not signal exactly once: ${JSON.stringify({ sent, kills: world.kills })}`)
  }

  log.begin('B31-SIGNAL-SECOND-CHILD-REFUSED', 'an unregistered second direct child gets zero signals', 'pure_mock')
  {
    const world = mockWorld()
    const owned = mockSpawn(world, ['--root=/tmp/w31-root'], { root: '--root=/tmp/w31-root', expectedChildren: [] })
    const impostor = world.nextPid++
    world.add(impostor, [process.execPath, '--root=/tmp/w31-root']) // same argv, same parent: still not owned
    const noHandle = signalOwned(null, 'SIGKILL')
    const forged = adoptSpawn(impostor, { expectedChildren: [] })
    const forgedSent = forged.ok ? signalOwned(forged.handle, 'SIGKILL') : { sent: false, refused: true, unknown: forged.unknown }
    log.evidence({ refusedNoHandle: noHandle.refused, forged: forgedSent })
    if (noHandle.refused && !forged.ok && (forged.unknown === 'numeric_pid_not_accepted' || forged.unknown === 'not_a_child_process') && world.kills.length === 0) log.pass('a bare pid (and a plain object) for a second direct child with identical argv was refused with zero kill calls')
    else log.fail(`an unregistered sibling was signalled: ${JSON.stringify({ noHandle, forged, kills: world.kills })}`)
  }

  log.begin('B31-SIGNAL-PARTIAL-ARGV-REFUSED', 'a partial observed argv cannot satisfy the intent', 'pure_mock')
  {
    const world = mockWorld()
    const spawned = mockSpawn(world, ['--root=/tmp/w31-root'], { root: '--root=/tmp/w31-root', expectedChildren: [] })
    world.procs.set(spawned.child.pid, { ...world.procs.get(spawned.child.pid), argv: process.execPath }) // only the executable
    const sent = signalOwned(spawned.handle, 'SIGKILL')
    log.evidence({ sent, kills: world.kills.length })
    if (sent.refused && !sent.sent && (sent.unknown === 'argv_mismatch' || (sent.mismatches ?? []).includes('argv')) && world.kills.length === 0) log.pass('an observed argv that is only the node token was refused (argv mismatch) with zero signals')
    else log.fail(`a partial argv was accepted: ${JSON.stringify(sent)}`)
  }

  log.begin('B31-SIGNAL-METADATA-REFUSED', 'root/config/operation must be tokens of the spawn intent', 'pure_mock')
  {
    const world = mockWorld()
    // A plain object carrying copied spawn metadata is refused outright (wave-33 finding).
    const copiedChild = { pid: 4200, spawnfile: process.execPath, spawnargs: [process.execPath, '--root=/tmp/w31-other'] }
    const copiedAdopt = adoptSpawn(copiedChild, { expectedChildren: [] })
    // Even the tool's own spawn refuses a metadata token that is not in the argv it issued.
    const wrongRoot = spawnOwned(process.execPath, ['--root=/tmp/w31-root'], { root: '--root=/tmp/w31-other', expectedChildren: [] })
    log.evidence({ copiedAdopt: copiedAdopt.ok ? null : copiedAdopt.unknown, wrongRoot: wrongRoot.ok ? null : wrongRoot.unknown })
    if (!copiedAdopt.ok && copiedAdopt.unknown === 'not_a_child_process' && !wrongRoot.ok && wrongRoot.unknown === 'spawn_root_not_in_argv' && world.kills.length === 0) log.pass('a plain object with copied spawn metadata was refused (not_a_child_process) and a root outside the issued argv was refused before registration')
    else log.fail(`inconsistent spawn metadata was accepted: ${JSON.stringify({ copiedAdopt, wrongRoot })}`)
  }

  log.begin('B31-SIGNAL-IDENTITY-UID-START', 'uid/start changes end ownership', 'pure_mock')
  {
    const world = mockWorld()
    const spawned = mockSpawn(world, ['--root=/tmp/w31-root'], { root: '--root=/tmp/w31-root', expectedChildren: [] })
    world.procs.set(spawned.child.pid, { ...world.procs.get(spawned.child.pid), uid: 0, start: 'Mon Jan  1 00:00:00 2001' })
    const sent = signalOwned(spawned.handle, 'SIGKILL')
    log.evidence({ mismatches: sent.mismatches, kills: world.kills.length })
    if (sent.refused && !sent.sent && world.kills.length === 0 && sent.mismatches.includes('uid') && sent.mismatches.includes('start')) log.pass('a recycled pid (uid+start changed) was refused with zero signals')
    else log.fail(`a recycled identity was signalled: ${JSON.stringify(sent)}`)
  }

  log.begin('B31-SIGNAL-RESOURCE-PLAN-EVERY-SIGNAL', 'the child plan is checked on every signal and UNKNOWN refuses', 'pure_mock')
  {
    const world = mockWorld()
    const spawned = mockSpawn(world, ['--root=/tmp/w31-root'], { root: '--root=/tmp/w31-root', expectedChildren: [700] })
    world.children.set(spawned.child.pid, { state: 'ok', children: [] })
    const missing = signalOwned(spawned.handle, 'SIGKILL')
    const unknownWorld = mockWorld()
    const unknownSpawn = mockSpawn(unknownWorld, ['--root=/tmp/w31-root'], { root: '--root=/tmp/w31-root', expectedChildren: [] })
    unknownWorld.children.set(unknownSpawn.child.pid, { state: 'unknown', reason: 'children_unreadable' })
    const unknown = signalOwned(unknownSpawn.handle, 'SIGKILL')
    log.evidence({ missing, unknown })
    if (missing.refused && !missing.sent && world.kills.length === 0 && unknown.refused && unknown.unknown === 'children_unreadable') log.pass('a missing child and an unreadable child set both refused; neither produced a signal')
    else log.fail(`resource plan was skippable: ${JSON.stringify({ missing, unknown })}`)
  }

  log.begin('B31-SIGNAL-COPIES-AND-PS-UNKNOWN', 'copied handles and ps failures retain material', 'pure_mock')
  {
    const world = mockWorld()
    const spawned = mockSpawn(world, ['--root=/tmp/w31-root'], { root: '--root=/tmp/w31-root', expectedChildren: [] })
    const copiedId = signalOwned({ ...spawned.handle, handleId: 'copied' }, 'SIGKILL')
    const copied = copiedId
    const retargeted = signalOwned({ handleId: spawned.handle.handleId, record: { ...spawned.handle.record, pid: process.pid } }, 'SIGKILL')
    world.procs.set(spawned.child.pid, { state: 'unknown', reason: 'ps_failed' })
    const unreadable = signalOwned(spawned.handle, 'SIGKILL')
    const exit = await confirmExit(spawned.child.pid, 80)
    log.evidence({ copied: copied.unknown, retargeted: retargeted.unknown, unreadable: unreadable.unknown, exit, kills: world.kills.length })
    if (copied.refused && retargeted.refused && unreadable.refused && unreadable.unknown === 'ps_failed' && exit.exited === false && typeof exit.unknown === 'string' && world.kills.length === 0) log.pass('a copied handle, a retargeted record and an unreadable ps all refused; UNKNOWN was not reported as exit and no material was cleared')
    else log.fail(`copies/unknown were not fail-closed: ${JSON.stringify({ copied, retargeted, unreadable, exit })}`)
  }

  log.begin('B31-SIGNAL-MOCK-ESCALATION-SPY', 'TERM then fresh check then KILL only for a still-matching intent', 'pure_mock')
  {
    const world = mockWorld()
    const spawned = mockSpawn(world, ['--root=/tmp/w31-root'], { root: '--root=/tmp/w31-root', expectedChildren: [] })
    const result = await escalate(spawned.handle, { termWaitMs: 60 })
    log.evidence({ kills: world.kills, result: { term: result.term.sent, kill: result.kill?.sent ?? null } })
    if (world.kills.length === 2 && world.kills[0][1] === 'SIGTERM' && world.kills[1][1] === 'SIGKILL') log.pass('a TERM-ignoring mock received exactly one TERM and one fresh-verified KILL (spy counts)')
    else log.fail(`mock escalation signals were wrong: ${JSON.stringify(world.kills)}`)
  }

  resetSignalGuard()
  const live = []
  try {
    log.begin('B31-SIGNAL-LIVE-OWN-POSITIVE', 'one limited real positive on a probe-owned fixture', 'controlled_process')
    const args = ['--root=/tmp/w31-live', '--config=/tmp/w31-live/config.json', '--operation=run']
    const spawned = spawnOwned(process.execPath, [FIXTURE, ...args], { root: '--root=/tmp/w31-live', config: '--config=/tmp/w31-live/config.json', operation: '--operation=run', expectedChildren: [] })
    live.push(spawned.handle)
    await second()
    const sent = signalOwned(spawned.handle, 'SIGKILL')
    const exited = await confirmExit(spawned.child.pid, 5000)
    log.evidence({ pid: spawned.child.pid, sent: sent.sent, exited: exited.exited })
    if (sent.sent && exited.exited) log.pass(`live spawn-intent ${spawned.child.pid} matched /bin/ps, was killed once and confirmed GONE`)
    else log.fail(`live own positive failed: ${JSON.stringify({ sent, exited })}`)

    log.begin('B31-SIGNAL-LIVE-UNREADABLE-NOT-GONE', 'a live ps failure is UNKNOWN, not exit', 'controlled_process')
    const exit = await confirmExit(999999999, 300)
    log.evidence({ exit })
    if (exit.exited === false && typeof exit.unknown === 'string') log.pass(`an unreadable pid was retained as UNKNOWN (${exit.unknown}) rather than reported as exited`)
    else log.fail(`an unreadable pid was reported as exit: ${JSON.stringify(exit)}`)

    log.begin('B31-SCOPE-NOT-NATIVE', 'fixture lane; no installed agent or gateway', 'controlled_process')
    log.notTested('no installed agent executed and no gateway contacted')
  } finally {
    for (const handle of live) { try { signalOwned(handle, 'SIGKILL') } catch {} }
    resetSignalGuard()
  }
} finally {
  resetSignalGuard()
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-31 spawn-intent signal tool', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'pure mocks + one limited live own fixture; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(42)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB31-signal totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
