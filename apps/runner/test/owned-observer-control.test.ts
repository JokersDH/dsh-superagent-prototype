import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTargetedProcessObserver, MAC_PROCESS_ARGUMENTS_READER, type ObservationCommand } from '../src/owned-process-observer.ts'

const bytes = (value: string) => new TextEncoder().encode(value)
test('Mac inspection uses only the selected PID/group and keeps exact argv boundaries including empty args', () => {
  const calls: Array<{ executable: string; argv: readonly string[] }> = []
  const command: ObservationCommand = (executable, argv) => {
    calls.push({ executable, argv })
    let stdout = ''
    if (executable === '/bin/ps') stdout = '41001 30000 41001 501 Fri Nov 27 10:00:00 2026 S\n'
    else if (executable === '/usr/bin/python3') stdout = JSON.stringify({ executable: '/trusted/node', argv0: '/trusted/node', argv: ['a b', '', '--literal=$x'] })
    else if (executable === '/usr/sbin/lsof') stdout = 'p41001\0\nfcwd\0n/private/workspace with spaces\0\n'
    else if (executable === '/usr/bin/pgrep') stdout = '41001\n'
    else assert.fail('Unexpected observer executable')
    return { status: 0, stdout: bytes(stdout), stderr: bytes('') }
  }
  const observer = createTargetedProcessObserver({ platform: 'darwin', command }), process = observer.process(41001)
  assert.equal(process.kind, 'observed')
  if (process.kind === 'observed') { assert.deepEqual(process.process.argv, ['a b', '', '--literal=$x']); assert.equal(process.process.cwd, '/private/workspace with spaces') }
  assert.deepEqual(observer.group(41001), { kind: 'observed', pids: [41001] })
  assert.ok(calls.every(call => !call.argv.includes('-A') && !call.argv.includes('-e')))
  assert.ok(calls.filter(call => call.executable === '/bin/ps').every(call => call.argv[0] === '-p' && call.argv[1] === '41001'))
  assert.ok(calls.filter(call => call.executable === '/usr/bin/pgrep').every(call => JSON.stringify(call.argv) === JSON.stringify(['-g', '41001'])))
  assert.ok(MAC_PROCESS_ARGUMENTS_READER.includes('args[1:]'))
  assert.ok(!MAC_PROCESS_ARGUMENTS_READER.includes('raw[pos:]'), 'Environment suffix must never be emitted')
})

test('only documented empty pgrep result is empty; failed, timed out, malformed or duplicate listings remain unknown', () => {
  const result = (status: number | null, stdout: string, stderr = '', failed = false) =>
    createTargetedProcessObserver({ platform: 'darwin', command: () => ({ status, stdout: bytes(stdout), stderr: bytes(stderr), failed }) }).group(41001)
  assert.deepEqual(result(1, ''), { kind: 'observed', pids: [] })
  for (const observation of [result(null, '', '', true), result(2, ''), result(1, '', 'permission denied'), result(0, ''), result(0, 'not-a-pid\n'), result(0, '41001\n41001\n')])
    assert.equal(observation.kind, 'unknown')
})

test('an incomplete exact-PID identity is unknown, with no ps-text argv fallback', () => {
  let kernels = 0
  const command: ObservationCommand = (executable) => {
    if (executable === '/usr/bin/python3') kernels++
    return executable === '/bin/ps'
      ? { status: 0, stdout: bytes('41001 30000 41001 501 Fri Nov 27 10:00:00 2026 S\n'), stderr: bytes('') }
      : { status: null, stdout: bytes(''), stderr: bytes(''), failed: true }
  }
  assert.equal(createTargetedProcessObserver({ platform: 'darwin', command }).process(41001).kind, 'unknown')
  assert.equal(kernels, 2)
})
