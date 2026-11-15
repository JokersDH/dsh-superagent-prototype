#!/usr/bin/env node
import { strict as assert } from 'node:assert'
import { daemonArgv } from '../../apps/launcher/lib/daemon.mjs'
const base = { installRoot: '/opt/app', apiPort: 1234, state: '/private/state', consoleURL: 'http://127.0.0.1:1233', access: 'local-development' }
const cases = []
const inspect = (id, options, expected) => {
  const argv = daemonArgv({ ...base, ...options })
  const checks = {
    startupMode: argv[argv.indexOf('--startup-mode') + 1] === expected.startupMode,
    assistant: argv.includes('--assistant') === expected.assistant,
    discussionOnly: argv.includes('--discussion-only') === expected.discussionOnly,
    native: argv.includes('--native') === expected.native,
    review: (argv.indexOf('--review-restored-scope') >= 0) === expected.review,
  }
  const ok = Object.values(checks).every(Boolean)
  cases.push({ id, status: ok ? 'PASS' : 'FAIL', argv, checks })
  assert.equal(ok, true, id)
}
inspect('normal-personal-discussion', { mode: 'personal', discussionOnly: true }, { startupMode: 'normal', assistant: true, discussionOnly: true, native: false, review: false })
inspect('normal-personal-native', { mode: 'personal', discussionOnly: false }, { startupMode: 'normal', assistant: true, discussionOnly: false, native: true, review: false })
inspect('fixture-normal', { mode: 'fixture', discussionOnly: false }, { startupMode: 'normal', assistant: false, discussionOnly: false, native: false, review: false })
inspect('restored-no-review-file', { mode: 'personal', discussionOnly: true, startupMode: 'recovery_readonly' }, { startupMode: 'recovery_readonly', assistant: true, discussionOnly: true, native: false, review: false })
inspect('restored-with-review-file', { mode: 'personal', discussionOnly: true, startupMode: 'recovery_readonly', reviewRestoredScope: '/private/review.json' }, { startupMode: 'recovery_readonly', assistant: true, discussionOnly: true, native: false, review: true })
console.log(JSON.stringify({ protocol: 'wave28-startup-mode-argv/1', status: 'PASS', runtimeTurns: 0, cases }, null, 2))
