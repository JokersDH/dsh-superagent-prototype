import assert from 'node:assert/strict'
import { test } from 'node:test'
import { daemonArgv } from '../../apps/launcher/lib/daemon.mjs'

const base = { installRoot: '/probe/install', apiPort: 49001, state: '/probe/state', consoleURL: 'http://127.0.0.1:49002', access: 'authenticated' }
for (const [name, input, required, forbidden] of [
  ['normal personal', { mode: 'personal' }, ['--assistant', '--native'], ['--discussion-only', '--review-restored-scope']],
  ['discussion-only personal', { mode: 'personal', discussionOnly: true }, ['--assistant', '--discussion-only'], ['--native', '--review-restored-scope']],
  ['normal fixture with lazy assistant', { mode: 'fixture' }, ['--assistant'], ['--native', '--discussion-only', '--review-restored-scope']],
  ['restored personal without review file', { mode: 'personal', startupMode: 'recovery_readonly' }, ['--assistant', '--discussion-only'], ['--native', '--review-restored-scope']],
  ['restored personal with exact review file', { mode: 'personal', startupMode: 'recovery_readonly', reviewRestoredScope: '/probe/config/review.json' },
    ['--assistant', '--discussion-only', '--review-restored-scope', '/probe/config/review.json'], ['--native']],
  ['restored fixture keeps its requested mode', { mode: 'fixture', startupMode: 'recovery_readonly' }, [], ['--assistant', '--discussion-only', '--native', '--review-restored-scope']],
]) test(`actual daemon argv preserves ${name}`, () => {
  const argv = daemonArgv({ ...base, ...input })
  for (const value of required) assert.ok(argv.includes(value), value)
  for (const value of forbidden) assert.equal(argv.includes(value), false, value)
  assert.equal(argv[argv.indexOf('--state') + 1], base.state)
  assert.equal(argv[argv.indexOf('--startup-mode') + 1], input.startupMode ?? 'normal')
})
