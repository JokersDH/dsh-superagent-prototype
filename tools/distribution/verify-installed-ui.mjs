#!/usr/bin/env node
/** Static presence of the main wave-24 opt-in source-scope diagnostics UI/back-end in the exact install. */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = resolve(values.install), result = { protocol: 'wave24-installed-ui/1', status: 'FAIL', steps: [] }
try {
  const assets = readdirSync(join(root, 'app/apps/console/dist/assets')).filter((name) => name.endsWith('.js'))
  const asset = assets.map((name) => readFileSync(join(root, 'app/apps/console/dist/assets', name), 'utf8')).join('\n')
  const required = ['scopeReview===!0?`?scopeReview=1`', 'withheldSourceCount', 'scopeReview.reasons']
  const missing = required.filter((needle) => !asset.includes(needle))
  if (missing.length > 0) throw new Error(`installed console is missing UI diagnostics: ${missing.join(', ')}`)
  const contracts = readFileSync(join(root, 'app/packages/contracts/dist/context-records.js'), 'utf8')
  if (!contracts.includes('context-scope-review/1')) throw new Error('installed back-end contract lacks context-scope-review/1')
  result.steps.push({ id: 'installed-opt-in-ui-and-backend', status: 'PASS', detail: { assets: assets.length, optInQuery: true, withheldSourceCount: true, reasons: true, backendProtocol: true } })
  result.status = 'PASS'
} catch (error) { result.error = String(error?.stack ?? error) }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.status === 'PASS' ? 0 : 1
