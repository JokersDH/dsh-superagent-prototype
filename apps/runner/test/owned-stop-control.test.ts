/** No OS child, observer command or signal is executed in this control suite. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { ProcessHost } from '../src/process-host.ts'
import type { OwnedProcessObserver, ProcessSnapshot } from '../src/owned-process-observer.ts'

function fixture() {
  let pid = 41000, now = 1000
  const snapshots = new Map<number, ProcessSnapshot>(), groups = new Map<number, number[]>(), children = new Map<number, EventEmitter>()
  const signals: Array<{ pid: number; signal: 'SIGTERM' | 'SIGKILL' }> = []
  let onSignal: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void = target => exit(target)
  const exit = (target: number, members: number[] = []) => {
    groups.set(target, members); children.get(target)!.emit('exit', 0, null)
  }
  const observer: OwnedProcessObserver = {
    process(target) { const snapshot = snapshots.get(target); return snapshot ? { kind: 'observed', process: structuredClone(snapshot) } : { kind: 'unknown', reason: 'controlled-unobserved' } },
    group(target) { const pids = groups.get(target); return pids ? { kind: 'observed', pids: [...pids] } : { kind: 'unknown', reason: 'controlled-group-unobserved' } },
  }
  const fakeSpawn = ((executable: string, argv: string[], options: { cwd: string }) => {
    const target = ++pid, child = new EventEmitter() as EventEmitter & { pid: number; stdin: PassThrough; stdout: PassThrough; stderr: PassThrough }
    child.pid = target; child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
    snapshots.set(target, { pid: target, parentPid: process.pid, groupId: target, uid: process.geteuid!(),
      startMarker: `birth-${target}`, executable: realpathSync(executable), argv0: executable, argv: [...argv], cwd: realpathSync(options.cwd), state: 'S' })
    groups.set(target, [target]); children.set(target, child)
    queueMicrotask(() => child.emit('spawn'))
    return child
  }) as unknown as typeof spawn
  const host = new ProcessHost({ observer, spawnProcess: fakeSpawn, now: () => now, killGraceMs: 40,
    wait: async ms => { now += ms }, signalProcess: (target, signal) => { assert.ok(target > 0, 'Only an exact original PID may be signalled'); signals.push({ pid: target, signal }); onSignal(target, signal) } })
  return { host, observer, snapshots, groups, signals, children, exit,
    now: () => now, onSignal: (callback: typeof onSignal) => { onSignal = callback },
    spawn: (argv: string[] = ['--controlled', 'two words', '']) => host.spawn({ executable: process.execPath, argv, cwdRef: 'original-workspace', environmentRef: 'original-config' }) }
}

test('an immutable original singleton plan receives TERM and releases only after original exit plus empty group', async () => {
  const h = fixture(), resource = await h.spawn()
  assert.ok(Object.isFrozen(resource.identity)); assert.ok(Object.isFrozen(resource.identity.argv))
  assert.equal(resource.identity.uid, process.geteuid!()); assert.equal(resource.identity.cwd, realpathSync(process.cwd()))
  assert.equal(resource.identity.cwdRef, 'original-workspace'); assert.equal(resource.identity.environmentRef, 'original-config')
  assert.throws(() => { (resource.identity as { uid: number }).uid = 0 }, TypeError)
  const stopped = await h.host.stopOwned(resource.resourceRef, 40)
  assert.equal(stopped.quiescence, 'confirmed')
  assert.deepEqual(h.signals, [{ pid: resource.identity.pid, signal: 'SIGTERM' }])
  assert.equal(h.host.resources().length, 0)
  assert.equal(h.host.inventory()[0]!.writer, 'quiescent')
  assert.ok(stopped.evidenceRefs.includes('original-complete-group-barrier'))
})

test('UID, birth, argv boundaries, argv0, executable, cwd, parent or group drift sends zero signals', async () => {
  const cases: Array<(snapshot: ProcessSnapshot) => void> = [
    snapshot => { snapshot.uid++ }, snapshot => { snapshot.startMarker = 'another-birth' },
    snapshot => { snapshot.argv = ['--controlled', 'two', 'words', ''] },
    snapshot => { snapshot.argv0 = '/foreign/node' }, snapshot => { snapshot.executable = '/foreign/node' },
    snapshot => { snapshot.cwd = '/foreign/workspace' }, snapshot => { snapshot.parentPid++ }, snapshot => { snapshot.groupId++ },
  ]
  for (const mutate of cases) {
    const h = fixture(), resource = await h.spawn(); mutate(h.snapshots.get(resource.identity.pid)!)
    const stopped = await h.host.stopOwned(resource.resourceRef, 40)
    assert.equal(stopped.quiescence, 'indeterminate'); assert.equal(h.signals.length, 0)
    assert.deepEqual(h.host.resources(), [resource.resourceRef]); assert.equal(h.host.inventory()[0]!.writer, 'indeterminate')
  }
})

test('missing identity, timeout-like unknown group, or an unregistered child is UNKNOWN without signals', async () => {
  for (const mutate of [
    (h: ReturnType<typeof fixture>, pid: number) => { h.snapshots.delete(pid) },
    (h: ReturnType<typeof fixture>, pid: number) => { h.groups.delete(pid) },
    (h: ReturnType<typeof fixture>, pid: number) => { h.groups.set(pid, [pid, pid + 99]) },
  ]) {
    const h = fixture(), resource = await h.spawn(); mutate(h, resource.identity.pid)
    assert.equal((await h.host.stopOwned(resource.resourceRef, 40)).quiescence, 'indeterminate')
    assert.equal(h.signals.length, 0); assert.equal(h.host.resources().length, 1)
  }
})

test('an original exit with a surviving group member cannot authorize signalling the group number', async () => {
  const h = fixture(), resource = await h.spawn()
  h.exit(resource.identity.pid, [resource.identity.pid + 99])
  assert.equal((await h.host.stopOwned(resource.resourceRef, 40)).quiescence, 'indeterminate')
  assert.equal(h.signals.length, 0); assert.equal(h.host.resources().length, 1)
})

test('an empty query alone cannot replace the original exit event', async () => {
  const h = fixture(), resource = await h.spawn()
  h.groups.set(resource.identity.groupId, [])
  assert.equal((await h.host.stopOwned(resource.resourceRef, 40)).quiescence, 'indeterminate')
  assert.equal(h.signals.length, 0)
  h.exit(resource.identity.pid)
  assert.equal((await h.host.stopOwned(resource.resourceRef, 40)).quiescence, 'confirmed')
  assert.equal(h.signals.length, 0)
})

test('the whole stopAll plan is checked before the first signal', async () => {
  const h = fixture(), first = await h.spawn(), second = await h.spawn()
  h.snapshots.get(second.identity.pid)!.uid++
  assert.equal((await h.host.stopAll(40)).quiescence, 'indeterminate')
  assert.equal(h.signals.length, 0); assert.equal(h.host.resources().length, 2)
  assert.ok(h.host.resources().includes(first.resourceRef))
})

test('the remaining plan is revalidated before signalling the next original resource', async () => {
  const h = fixture(), first = await h.spawn(), second = await h.spawn()
  h.onSignal(pid => { h.exit(pid); h.snapshots.get(second.identity.pid)!.uid++ })
  assert.equal((await h.host.stopAll(40)).quiescence, 'indeterminate')
  assert.deepEqual(h.signals, [{ pid: first.identity.pid, signal: 'SIGTERM' }])
  assert.equal(h.host.inventory().find(item => item.ref === second.resourceRef)!.writer, 'indeterminate')
})

test('an admission-close spawn race retains the original handle for the explicit complete stop plan', async () => {
  const h = fixture(), spawning = h.spawn()
  const stopping = h.host.stopAll(40)
  await assert.rejects(spawning, error => (error as { reason?: string }).reason === 'admission_closed')
  assert.equal((await stopping).quiescence, 'confirmed')
  assert.equal(h.signals.length, 1)
  assert.equal(h.host.inventory().length, 1)
  assert.equal(h.host.inventory()[0]!.writer, 'quiescent')
})

test('identity changes between initial validation and the TERM delivery refuse the signal', async () => {
  const h = fixture(), resource = await h.spawn(), observe = h.observer.process
  let reads = 0
  h.observer.process = pid => {
    const result = observe(pid)
    if (++reads === 2 && result.kind === 'observed') result.process.uid++
    return result
  }
  assert.equal((await h.host.stopOwned(resource.resourceRef, 40)).quiescence, 'indeterminate')
  assert.equal(h.signals.length, 0)
})

test('escalation revalidates the complete identity; drift at the final KILL preflight prevents KILL', async () => {
  const h = fixture(), resource = await h.spawn(), observe = h.observer.process
  const termDeadline = h.now() + 40
  let atDeadline = 0
  h.onSignal(() => { /* controlled process ignores TERM */ })
  h.observer.process = pid => {
    const result = observe(pid)
    if (h.signals.length > 0 && h.now() >= termDeadline && ++atDeadline >= 2 && result.kind === 'observed') result.process.startMarker = 'reused-before-escalation'
    return result
  }
  assert.equal((await h.host.stopOwned(resource.resourceRef, 40)).quiescence, 'indeterminate')
  assert.deepEqual(h.signals.map(signal => signal.signal), ['SIGTERM'])
  assert.equal(h.host.resources().length, 1)
})

test('a fresh unchanged singleton can escalate, but still needs the original exit and group barrier', async () => {
  const h = fixture(), resource = await h.spawn()
  h.onSignal((pid, signal) => { if (signal === 'SIGKILL') h.exit(pid) })
  assert.equal((await h.host.stopOwned(resource.resourceRef, 40)).quiescence, 'confirmed')
  assert.deepEqual(h.signals.map(signal => signal.signal), ['SIGTERM', 'SIGKILL'])
})

test('a new child after TERM keeps occupancy and prevents escalation', async () => {
  const h = fixture(), resource = await h.spawn()
  h.onSignal(pid => { h.groups.set(pid, [pid, pid + 77]) })
  assert.equal((await h.host.stopOwned(resource.resourceRef, 40)).quiescence, 'indeterminate')
  assert.deepEqual(h.signals.map(signal => signal.signal), ['SIGTERM'])
  assert.equal(h.host.inventory()[0]!.writer, 'indeterminate')
})

test('delivery failure is UNKNOWN, never a missing-process proof', async () => {
  const h = fixture(), resource = await h.spawn()
  h.onSignal(() => { throw Object.assign(new Error('controlled ESRCH'), { code: 'ESRCH' }) })
  assert.equal((await h.host.stopOwned(resource.resourceRef, 40)).quiescence, 'indeterminate')
  assert.deepEqual(h.signals.map(signal => signal.signal), ['SIGTERM'])
})
