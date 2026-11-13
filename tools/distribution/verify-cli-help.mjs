#!/usr/bin/env node
/** Help routing/discoverability only; must not create state, credentials, queues or processes. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-help-')); const result = { protocol: 'wave23-cli-help/1', status: 'FAIL', steps: [] }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
try {
  const install = resolve(values.install); const cli = join(install, 'bin/pa'); const config = join(root, 'config')
  const run = (...args) => spawnSync(cli, args, { encoding: 'utf8', timeout: 30000 })
  const before = existsSync(config) ? readdirSync(config) : []
  const top = run('--help'), sub = run('help', 'review-restored'), cmd = run('review-restored', '--help')
  if (top.status !== 0 || !top.stdout.includes('review-restored') || !top.stdout.includes('--review-restored-scope')) throw new Error('top-level help missing review entry')
  if (sub.status !== 0 || !sub.stdout.includes('prepareRestoredReview') || !sub.stdout.includes('--project')) throw new Error('subcommand help missing producer/args')
  if (cmd.status !== 0 || !cmd.stdout.includes('--state') || !cmd.stdout.includes('不覆盖')) throw new Error('command --help missing contract')
  const after = existsSync(config) ? readdirSync(config) : []
  if (before.length !== 0 || after.length !== 0) throw new Error('help created config/state material')
  step('help-discoverability', 'PASS', { top: true, sub: true, commandHelp: true, noStateCreated: true })
  result.status = 'PASS'
} catch (error) { result.error = String(error?.stack ?? error) }
finally { rmSync(root, { recursive: true, force: true }) }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.status === 'PASS' ? 0 : 1
