/**
 * Process-group quiescence and start-marker identity negatives (G1 review: B-PROCESS-GROUP,
 * B-START-MARKER). These spawn real short-lived fixtures and clean up their own groups.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { ProcessHost } from '../src/process-host.ts'

const nodePath = process.execPath

/** A parent that spawns a descendant which ignores SIGTERM and never exits on its own. */
const PARENT_WITH_STUBBORN_DESCENDANT = `
import { spawn } from 'node:child_process';
const descendant = 'process.on("SIGTERM", () => {}); process.stdout.write("ready\\\\n"); setInterval(() => {}, 1000);';
const child = spawn(process.execPath, ['-e', descendant], { stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.once('data', () => process.stdout.write(JSON.stringify({ descendantPid: child.pid }) + '\\n'));
setInterval(() => {}, 1000);
`

function processState(pid: number): string | undefined {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined
  } catch {
    return undefined
  }
}

function groupAlive(groupId: number): boolean {
  try {
    const text = execFileSync('ps', ['-o', 'pid=,stat=', '-g', String(groupId)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return text
      .split('\n')
      .map(line => line.trim().split(/\s+/))
      .filter(([, state]) => state && !state.replace('+', '').startsWith('Z'))
      .length > 0
  } catch {
    return false
  }
}

function killGroup(groupId: number): void {
  try {
    process.kill(-groupId, 'SIGKILL')
  } catch {
    // already gone
  }
}

test('B-PROCESS-GROUP: a parent exit is not quiescence while a same-group descendant lives', async () => {
  const host = new ProcessHost()
  const resource = await host.spawn({
    executable: nodePath,
    argv: ['--input-type=module', '-e', PARENT_WITH_STUBBORN_DESCENDANT],
    cwdRef: 'fixture',
    environmentRef: 'fixture',
  })
  let descendantPid = 0
  try {
    const ready = (async () => {
      let text = ''
      for await (const chunk of resource.stdout) {
        text += new TextDecoder().decode(chunk)
        const newline = text.indexOf('\n')
        if (newline !== -1) return JSON.parse(text.slice(0, newline)) as { descendantPid: number }
      }
      throw new Error('no descendant readiness')
    })()
    const descendant = await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('descendant readiness timeout')), 5000)),
    ])
    descendantPid = descendant.descendantPid

    // Short deadline: SIGTERM is ignored by the descendant, so escalation must happen fast.
    const stopped = await host.stopOwned(resource.resourceRef, 100)
    const state = processState(descendantPid)
    const stillActive = state !== undefined && !state.startsWith('Z')

    assert.equal(stillActive, false, `descendant ${descendantPid} survived the stop with state ${state}`)
    assert.equal(stopped.quiescence, 'confirmed', JSON.stringify(stopped.evidenceRefs))
    assert.ok(stopped.evidenceRefs.includes('sigkill-group'), `expected group escalation, got ${JSON.stringify(stopped.evidenceRefs)}`)
    assert.equal(groupAlive(resource.identity.groupId), false, 'the whole group must be gone')
  } finally {
    killGroup(resource.identity.groupId)
    if (descendantPid > 0) {
      try {
        process.kill(descendantPid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
    await host.stopAll(500)
  }
})

test('B-PROCESS-GROUP: a group that cannot be emptied stays indeterminate', async () => {
  // Simulate an unstoppable member by marking the identity's start marker as drifted *after* spawn:
  // the host must refuse to claim the group is quiescent.
  let reads = 0
  const host = new ProcessHost({
    readStartMarker: () => (reads++ === 0 ? 'Thu Nov  7 20:00:00 2026' : 'Thu Nov  7 21:00:00 2026'),
  })
  const resource = await host.spawn({
    executable: nodePath,
    argv: ['--input-type=module', '-e', 'setInterval(() => {}, 1000)'],
    cwdRef: 'fixture',
    environmentRef: 'fixture',
  })
  try {
    const stopped = await host.stopOwned(resource.resourceRef, 100)
    assert.equal(stopped.quiescence, 'indeterminate')
    assert.deepEqual([...stopped.evidenceRefs], ['identity-mismatch'])
  } finally {
    killGroup(resource.identity.groupId)
    try {
      process.kill(resource.identity.pid, 'SIGKILL')
    } catch {
      // already gone
    }
    await resource.exited
  }
})

test('B-START-MARKER: a missing start marker fails closed and sends no signal', async () => {
  // The marker cannot be read at spawn time: identity is unprovable.
  const host = new ProcessHost({ readStartMarker: () => null })
  const resource = await host.spawn({
    executable: nodePath,
    argv: ['--input-type=module', '-e', 'setInterval(() => {}, 1000)'],
    cwdRef: 'fixture',
    environmentRef: 'fixture',
  })
  try {
    const stopped = await host.stopOwned(resource.resourceRef, 500)
    assert.equal(stopped.quiescence, 'indeterminate', 'an unconfirmed identity must not report confirmed')
    assert.ok(
      stopped.evidenceRefs.some(ref => ref.startsWith('identity-unconfirmed')),
      JSON.stringify(stopped.evidenceRefs),
    )
    // Fail closed: the process must still be running, i.e. we did not signal an unproven group.
    assert.equal(resource.identity.pid > 0, true)
    const state = processState(resource.identity.pid)
    assert.ok(state !== undefined && !state.startsWith('Z'), `process should still be alive, state=${state}`)
  } finally {
    killGroup(resource.identity.groupId)
    try {
      process.kill(resource.identity.pid, 'SIGKILL')
    } catch {
      // already gone
    }
    await resource.exited
  }
})

test('B-START-MARKER: a marker that drifts between spawn and stop refuses to signal', async () => {
  let reads = 0
  const host = new ProcessHost({ readStartMarker: () => (reads++ === 0 ? 'marker-a' : 'marker-b') })
  const resource = await host.spawn({
    executable: nodePath,
    argv: ['--input-type=module', '-e', 'setInterval(() => {}, 1000)'],
    cwdRef: 'fixture',
    environmentRef: 'fixture',
  })
  try {
    const stopped = await host.stopOwned(resource.resourceRef, 100)
    assert.equal(stopped.quiescence, 'indeterminate')
    assert.deepEqual([...stopped.evidenceRefs], ['identity-mismatch'])
  } finally {
    killGroup(resource.identity.groupId)
    try {
      process.kill(resource.identity.pid, 'SIGKILL')
    } catch {
      // already gone
    }
    await resource.exited
  }
})

test('a clean single-process stop still confirms quickly', async () => {
  const host = new ProcessHost()
  const resource = await host.spawn({
    executable: nodePath,
    argv: ['--input-type=module', '-e', 'setInterval(() => {}, 1000)'],
    cwdRef: 'fixture',
    environmentRef: 'fixture',
  })
  try {
    const started = Date.now()
    const stopped = await host.stopOwned(resource.resourceRef, 2000)
    const elapsed = Date.now() - started
    assert.equal(stopped.quiescence, 'confirmed')
    assert.ok(stopped.evidenceRefs.includes('group-quiescent'), JSON.stringify(stopped.evidenceRefs))
    assert.ok(elapsed < 2000, `stop took ${elapsed}ms`)
  } finally {
    killGroup(resource.identity.groupId)
    await host.stopAll(500)
  }
})
