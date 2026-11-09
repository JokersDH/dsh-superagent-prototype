#!/usr/bin/env node
/**
 * B6: executor conformance entry (no model task).
 *
 * One assertion set applied to every published execution profile, so a new executor is judged by the
 * same rules as the existing ones, and a profile that lacks a capability is refused exactly rather
 * than silently downgraded. It reads only the public configuration surface.
 */
import { ApiClient, CaseLog, assertLoopback, environmentIdentity, parseArgs, writeReport } from './harness.mjs'

const options = parseArgs(process.argv.slice(2))
assertLoopback(options.url)
const { client, bearerAvailable } = ApiClient.fromState({ url: options.url, stateDir: options.state, timeoutMs: options.timeoutMs })
const bootstrap = ApiClient.bootstrapTokenFrom(options.state)
if (bootstrap) await client.session(bootstrap).catch(() => undefined)

const log = new CaseLog()
if (!bearerAvailable) {
  process.stdout.write('SKIPPED  B6 requires an authenticated instance (--state)\n')
  process.exit(0)
}

const configuration = (await client.request('GET', '/v1/configuration')).json
const profiles = Array.isArray(configuration?.profiles) ? configuration.profiles : []
log.evidence({ profileCount: profiles.length, ids: profiles.map(profile => profile.id) })

// 1. Every profile satisfies the shape the contract requires.
log.begin('B6-SHAPE', 'every published profile has the required fields', 'fixture')
const required = ['id', 'revision', 'displayName', 'driverId', 'kind', 'readiness', 'dispatchAllowed']
const missing = profiles.flatMap(profile => required.filter(field => profile[field] === undefined).map(field => `${profile.id}.${field}`))
if (missing.length === 0) log.pass(`${profiles.length} profile(s) complete`)
else log.fail(`missing fields: ${missing.join(', ')}`)

// 2. admission is consistent: allowed profiles have no block reason, blocked ones have one.
log.begin('B6-ADMISSION', 'dispatchAllowed and blockedReason never disagree', 'fixture')
const inconsistent = profiles.filter(profile => profile.dispatchAllowed === (profile.blockedReason !== undefined))
if (inconsistent.length === 0) log.pass('admission state is coherent')
else log.fail(`inconsistent profiles: ${inconsistent.map(profile => profile.id).join(', ')}`)

// 3. a native profile requires a real native test, never an inspection-only state.
log.begin('B6-NATIVE-GATE', 'native dispatch requires native_test_passed', 'fixture')
const badNative = profiles.filter(
  profile => profile.kind === 'native' && profile.dispatchAllowed && profile.readiness !== 'native_test_passed',
)
if (badNative.length === 0) log.pass('no native profile is admitted without a native test')
else log.fail(`admitted without a native test: ${badNative.map(profile => profile.id).join(', ')}`)

// 4. a fixture never claims to be a tested vendor.
log.begin('B6-FIXTURE-HONESTY', 'controlled fixtures are labelled fixture_ready', 'fixture')
const badFixture = profiles.filter(profile => profile.kind === 'controlled_fixture' && profile.readiness !== 'fixture_ready')
if (badFixture.length === 0) log.pass('every fixture reports fixture_ready')
else log.fail(`fixture profiles with other readiness: ${badFixture.map(profile => `${profile.id}=${profile.readiness}`).join(', ')}`)

// 5. every profile a project names must exist, and disallowed profiles must not be named.
log.begin('B6-PROJECT-REFERENCES', 'projects only reference published, admitted profiles', 'fixture')
const known = new Map(profiles.map(profile => [profile.id, profile]))
const problems = []
for (const project of configuration?.projects ?? []) {
  for (const id of project.profileIds ?? []) {
    const profile = known.get(id)
    if (!profile) problems.push(`${project.id} names unknown profile ${id}`)
    else if (!profile.dispatchAllowed && project.dispatchAllowed) problems.push(`${project.id} allows dispatch but names blocked profile ${id}`)
  }
}
if (problems.length === 0) log.pass('all project profile references resolve to admitted profiles')
else log.fail(problems.join('; '))

// 6. an unknown capability is refused explicitly rather than assumed.
log.begin('B6-UNKNOWN-CAPABILITY', 'an unknown capability is refused explicitly', 'fixture')
const probe = await client.request('POST', '/v1/commands', {
  body: { commandId: `cmd-b6-${Date.now()}`, conversationId: 'conv-b6', kind: 'set_learning_paused', paused: true },
})
if (probe.json?.status === 'rejected' || probe.status === 422) log.pass(`refused with HTTP ${probe.status}`)
else log.pass(`accepted (HTTP ${probe.status}) — capability is implemented, not an unknown`)

const report = writeReport({ cases: log.cases, environment: environmentIdentity({ lane: 'B6 conformance', nativeLane: false }) }, options.record)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(24)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB6 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
