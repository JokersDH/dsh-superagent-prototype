#!/usr/bin/env node
/**
 * Read-only probe for an installed Codex (wave-02 item 4).
 *
 * Runs only: `<codex> --version`, `<codex> --help`, `<codex> app-server --help` and
 * `<codex> app-server generate-json-schema --out <temp>`. It never logs in, never starts a model
 * turn, never writes to the native home and never reads a credential.
 *
 * Output: a JSON record with the pinned version, the method set the installed protocol actually
 * exposes, the `RequestId` shape, and the digest of the generated schema files. Model behaviour stays
 * NOT_TESTED.
 *
 *   node packages/drivers/codex-native/scripts/probe-installed.mjs [--executable <path>]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const executableIndex = args.indexOf('--executable')
const candidates =
  executableIndex >= 0 ? [args[executableIndex + 1]] : ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', 'codex']

const run = (command, argv) =>
  execFileSync(command, argv, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })

const executable = candidates.find(candidate => {
  try {
    run(candidate, ['--version'])
    return true
  } catch {
    return false
  }
})

if (!executable) {
  console.log(JSON.stringify({ status: 'NOT_INSTALLED', candidates, modelCalls: 'NOT_TESTED' }, null, 2))
  process.exit(0)
}

const report = {
  status: 'PROBE_OK',
  inspectedAt: new Date().toISOString(),
  executable,
  version: run(executable, ['--version']).trim(),
  hasAppServer: false,
  requestId: null,
  methods: [],
  protocolSchema: { files: 0, bytes: 0, digest: '' },
  modelCalls: 'NOT_TESTED',
  credentialsRead: false,
  nativeHomeModified: false,
}

const help = run(executable, ['--help'])
report.hasAppServer = /\bapp-server\b/.test(help)
if (!report.hasAppServer) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const appHelp = run(executable, ['app-server', '--help'])
report.appServerCommands = [...appHelp.matchAll(/^\s{2}([a-z-]+)\s/gm)].map(match => match[1])

// Export the installed protocol schema into a throwaway directory (read-only with respect to Codex).
const out = mkdtempSync(join(tmpdir(), 'codex-schema-'))
try {
  run(executable, ['app-server', 'generate-json-schema', '--out', out])
  const files = readdirSync(out).filter(name => name.endsWith('.json'))
  const digest = createHash('sha256')
  let bytes = 0
  for (const name of files.sort()) {
    const content = readFileSync(join(out, name))
    bytes += content.length
    digest.update(name).update('\u0000').update(content)
  }
  report.protocolSchema = { files: files.length, bytes, digest: digest.digest('hex') }

  const requestIdPath = join(out, 'RequestId.json')
  if (existsSync(requestIdPath)) {
    const requestId = JSON.parse(readFileSync(requestIdPath, 'utf8'))
    report.requestId = (requestId.anyOf ?? []).map(entry => entry.type ?? entry.format).filter(Boolean)
  }

  const v2Path = join(out, 'codex_app_server_protocol.v2.schemas.json')
  if (existsSync(v2Path)) {
    const text = readFileSync(v2Path, 'utf8')
    const methods = new Set([...text.matchAll(/"method"\s*:\s*\{\s*"enum"\s*:\s*\[\s*"([^"]+)"/g)].map(match => match[1]))
    report.methods = [...methods].sort()
  }

  // Which of the methods our Driver relies on actually exist in this installation?
  const required = ['initialize', 'thread/start', 'turn/start', 'turn/steer', 'turn/interrupt', 'turn/completed']
  report.driverMethodsPresent = Object.fromEntries(required.map(name => [name, report.methods.includes(name)]))
  report.driverMethodsMissing = required.filter(name => !report.methods.includes(name))
  // The v2 surface has no `answer` method: approvals are resolved through `serverRequest/resolved`.
  report.approvalSurface = {
    hasServerRequestResolved: report.methods.includes('serverRequest/resolved'),
    hasAnswerMethod: report.methods.includes('answer'),
  }
} finally {
  rmSync(out, { recursive: true, force: true })
}

console.log(JSON.stringify(report, null, 2))
