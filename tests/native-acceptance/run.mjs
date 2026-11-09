#!/usr/bin/env node
/**
 * Native MVP acceptance entry (external Agent B).
 *
 * Read-only by default. The real native lane requires `--run-native` and refuses to substitute a
 * fixture profile. See README.md for scope and ownership.
 */
import { ApiClient, CaseLog, environmentIdentity, parseArgs, writeReport } from './harness.mjs'
import { runNativeCases, runReadOnlyCases } from './cases.mjs'

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  process.stdout.write(
    [
      'Usage: node tests/native-acceptance/run.mjs [options]',
      '',
      '  --url <url>          product API base (default http://127.0.0.1:8796)',
      '  --state <dir>        private state directory holding the API credential',
      '  --run-native         enable the real native lane (requires an admitted native profile)',
      '  --record <file>      write the JSON report to this path',
      '  --timeout-ms <n>     per-request timeout (default 30000)',
      '',
      'Without --run-native only read-only configuration checks execute.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const log = new CaseLog()
const { client, bearerAvailable } = ApiClient.fromState({
  url: options.url,
  stateDir: options.state,
  timeoutMs: options.timeoutMs,
})

log.begin('HARNESS-AUTH', 'the acceptance harness can authenticate against the running product', 'read-only')
// Prefer a real session: the browser path the product supports.
const bootstrapToken = ApiClient.bootstrapTokenFrom(options.state)
let sessionEstablished = false
if (bootstrapToken) {
  const session = await client.session(bootstrapToken).catch(() => ({ status: 0 }))
  sessionEstablished = session.status === 200 || session.status === 204
  if (sessionEstablished) log.note('session established from the private bootstrap token')
}
if (bearerAvailable || sessionEstablished) {
  const health = await client.request('GET', '/v1/health', { anonymous: true }).catch(error => ({ status: 0, text: String(error) }))
  if (health.status === 200) log.pass(`GET /v1/health ${health.status}`)
  else log.fail(`GET /v1/health returned ${health.status}: ${String(health.text).slice(0, 200)}`)
} else {
  log.fail('no API credential or bootstrap token found; pass --state <product state dir>')
}

let readOnly = { configuration: undefined, selection: { available: false, reason: 'not attempted' } }
if (bearerAvailable || sessionEstablished) {
  readOnly = await runReadOnlyCases({ client, log, options })
} else {
  for (const [id, title] of [
    ['CONFIG-READ', 'GET /v1/configuration is available and never cached'],
    ['CONFIG-NATIVE-ADMISSION', 'the configuration states exactly which profiles may dispatch'],
    ['CONFIG-NO-RAW-IDENTITY', 'the configuration never exposes executable/argv/native config'],
    ['CONFIG-FIXTURE-NOT-NATIVE', 'fixture profiles are never presented as tested vendors'],
  ]) {
    log.begin(id, title, 'read-only')
    log.skip('no credential; cannot read the authenticated configuration')
  }
}

const native = await runNativeCases({ client, log, options, selection: readOnly.selection })

const environment = environmentIdentity({
  apiUrl: options.url,
  nativeLaneExecuted: native.executed,
  nativeLaneReason: native.executed ? 'executed' : native.reason,
  configurationRevision: readOnly.configuration?.revision,
})

const report = writeReport(
  {
    cases: log.cases,
    environment,
    extra: {
      lane: options.runNative ? 'read-only + native' : 'read-only',
      profileIds: (readOnly.configuration?.profiles ?? []).map(profile => ({ id: profile.id, kind: profile.kind, readiness: profile.readiness })),
    },
  },
  options.record,
)

for (const item of report.cases) {
  process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(26)} ${item.detail.join(' | ')}\n`)
}
process.stdout.write(
  `\n${report.totals.cases} cases: ${Object.entries(report.totals)
    .filter(([key]) => key !== 'cases')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')}\n`,
)
if (options.record) process.stdout.write(`report: ${options.record}\n`)

const failed = report.cases.filter(item => item.status === 'FAIL')
process.exit(failed.length === 0 ? 0 : 1)
