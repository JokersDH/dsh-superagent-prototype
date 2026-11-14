/**
 * Package machinecheck: combine the trial-kit preflight with the package's own checked commands and
 * the main-published readiness observation. Each section keeps its own authority:
 *   - preflight verifies the frozen bytes against the package manifests;
 *   - package `doctor` verifies the package's console/assets/dependency/ABI closure at runtime;
 *   - readiness reports configuration facts only (never a grant or package identity).
 * Nothing here is a release verdict; E re-derives its own assertions from the raw material.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { LIMITS } from './limits.mjs'
import { fail, pass, unknown, warn } from './output.mjs'
import { preflight } from './package-preflight.mjs'
import { EXPECTED_WARN_DOCTOR_CHECKS, REQUIRED_DOCTOR_CHECKS, runPackageCommands } from './package-cli.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function evaluateDoctor(doctorSection) {
  const checks = []
  if (doctorSection.value === null) {
    checks.push(fail('package_cli.doctor_json', { exit: doctorSection.exit, stderr: doctorSection.rawStderr }))
    return checks
  }
  const byId = new Map((doctorSection.value.checks ?? []).map((entry) => [entry.id, entry]))
  const missing = REQUIRED_DOCTOR_CHECKS.filter((id) => !byId.has(id))
  const failed = REQUIRED_DOCTOR_CHECKS.filter((id) => byId.get(id)?.status === 'FAIL')
  checks.push(missing.length === 0 && failed.length === 0 ? pass('package_cli.doctor_required', { required: REQUIRED_DOCTOR_CHECKS })
    : fail('package_cli.doctor_required', { missing, failed, statuses: REQUIRED_DOCTOR_CHECKS.map((id) => `${id}:${byId.get(id)?.status ?? 'missing'}`) }))
  const unexpectedWarn = (doctorSection.value.checks ?? [])
    .filter((entry) => entry.status === 'WARN' && !EXPECTED_WARN_DOCTOR_CHECKS.includes(entry.id))
    .map((entry) => entry.id)
  checks.push(unexpectedWarn.length === 0 ? pass('package_cli.doctor_expected_warns') : warn('package_cli.doctor_expected_warns', { unexpected: unexpectedWarn }))
  return checks
}

function evaluateWrites(writes) {
  const allowed = new Set(['roots/config/release.json', 'fixture/codex-fixture', 'fixture/executors.json'])
  const unexpected = writes.unexpected.filter((entry) => !allowed.has(entry.path))
  return unexpected.length === 0 ? pass('package_cli.no_state_writes', { allowed: [...allowed] })
    : fail('package_cli.no_state_writes', { unexpected: unexpected.slice(0, 10) })
}

/** Whitelist the documented pa-support/1 fields; anything else is dropped, not guessed. */
export function sanitizeSupport(bundlePath) {
  let raw
  try { raw = readFileSync(bundlePath) } catch { return { ok: false, reason: 'unreadable' } }
  if (raw.byteLength > LIMITS.maxManifestBytes) return { ok: false, reason: 'too_large' }
  let value
  try { value = JSON.parse(raw.toString('utf8')) } catch { return { ok: false, reason: 'invalid_json' } }
  if (value?.protocol !== 'pa-support/1') return { ok: false, reason: 'protocol_mismatch', protocol: value?.protocol ?? null }
  const picked = {
    protocol: value.protocol, generatedAt: value.generatedAt ?? null, productSchema: value.productSchema ?? null,
    platform: value.platform ?? null, install: value.install ?? null, release: value.release ?? null,
    roots: value.roots ?? null, state: value.state ?? null, instance: value.instance ?? null, journal: value.journal ?? null,
    redaction: value.redaction ?? null,
  }
  return { ok: true, digest: sha256(raw), bytes: raw.byteLength, bundle: picked, droppedKeys: Object.keys(value).filter((key) => !(key in picked)).slice(0, 20) }
}

export async function machinecheck({ preflightInput, readinessResult = null, supportReference = null, withPackageCli = true }) {
  const checks = []
  const unknowns = []
  // Keep the extraction until the package commands have run; it is removed before returning.
  const report = await preflight({ ...preflightInput, keepExtract: true })
  checks.push(...report.checks)
  unknowns.push(...report.unknowns)

  const installRoot = preflightInput.kind === 'tar'
    ? join(preflightInput.out, 'extract', report.method?.extraction?.prefix ?? '')
    : resolve(preflightInput.installPath)
  const cliAvailable = withPackageCli && existsSync(join(installRoot, 'bin/pa'))

  let packageCli = null
  if (cliAvailable) {
    packageCli = runPackageCommands({ installRoot, out: preflightInput.out })
    checks.push(packageCli.help.exit === 0 ? pass('package_cli.help', { exit: 0, firstLine: packageCli.help.firstLine }) : fail('package_cli.help', { exit: packageCli.help.exit }))
    const statusValue = packageCli.status.value
    const statusShapeOk = statusValue !== null && ['STOPPED', 'RUNNING', 'UNVERIFIED', 'BLOCKED'].includes(statusValue.status)
    checks.push(statusShapeOk ? pass('package_cli.status', { status: statusValue.status, exit: packageCli.status.exit })
      : fail('package_cli.status', { exit: packageCli.status.exit, stderr: packageCli.status.rawStderr }))
    checks.push(...evaluateDoctor(packageCli.doctor))
    checks.push(evaluateWrites(packageCli.writes))
    if (statusValue?.status === 'RUNNING') checks.push(warn('package_cli.own_roots_running', { note: 'an instance was already running under the explicit roots; H never started or stopped it' }))
    if (!existsSync(join(preflightInput.out, 'roots', 'data', 'state.sqlite'))) checks.push(pass('package_cli.no_database_created', { note: 'doctor/status must not create a product database' }))
    else checks.push(fail('package_cli.no_database_created', { path: 'roots/data/state.sqlite' }))
  }

  if (readinessResult !== null) {
    checks.push(...readinessResult.checks.map((entry) => ({ ...entry, id: `readiness.${entry.id}` })))
  } else {
    checks.push(unknown('readiness.not_requested', { note: 'pass --readiness <loopback-url> with an explicit token to observe readiness' }))
    unknowns.push('readiness')
  }

  if (supportReference !== null) {
    const sanitized = supportReference
    checks.push(sanitized.ok ? pass('support.reference', { digest: sanitized.digest, droppedKeys: sanitized.droppedKeys })
      : fail('support.reference', { reason: sanitized.reason, protocol: sanitized.protocol ?? null }))
  } else {
    checks.push(unknown('support.reference', {
      note: 'pa support is not invoked automatically: it opens the product database with write-capable pragmas when one exists. Run it yourself on a copy, or against an empty own root, then pass --support <file>.',
    }))
    unknowns.push('support')
  }

  if (preflightInput.kind === 'tar' && preflightInput.keepExtract !== true) {
    await rm(join(preflightInput.out, 'extract'), { recursive: true, force: true })
    checks.push(pass('extraction_cleanup', { removed: 'extract' }))
  }

  const failures = checks.filter((entry) => entry.status === 'FAIL')
  const result = failures.length > 0 ? 'REFUSED'
    : checks.some((entry) => ['WARN', 'UNKNOWN'].includes(entry.status)) ? 'DEGRADED' : 'OK'
  return {
    checks,
    unknowns: [...new Set(unknowns)],
    result,
    exitCode: result === 'OK' ? 0 : result === 'DEGRADED' ? 1 : 2,
    sections: {
      preflight: {
        result: report.result,
        observed: report.observed,
        unknowns: report.unknowns,
        commandCounts: report.checks.reduce((acc, entry) => { acc[entry.status] = (acc[entry.status] ?? 0) + 1; return acc }, {}),
        commands: report.method?.commands ?? [],
        limits: report.method?.limits ?? null,
      },
      packageCli: packageCli === null ? null : {
        commands: packageCli.commands,
        help: packageCli.help,
        status: { exit: packageCli.status.exit, status: packageCli.status.value?.status ?? null, roots: packageCli.status.value?.roots ?? null },
        doctor: {
          exit: packageCli.doctor.exit,
          status: packageCli.doctor.value?.status ?? null,
          checks: (packageCli.doctor.value?.checks ?? []).map((entry) => ({ id: entry.id, status: entry.status, detail: entry.id === 'support_matrix' || entry.status === 'PASS' ? undefined : entry.detail })),
        },
        fixture: packageCli.fixture,
        releaseCopy: packageCli.releaseCopy,
        writes: { unexpected: packageCli.writes.unexpected.map((entry) => entry.path) },
      },
      readiness: readinessResult === null ? null : { metadata: readinessResult.meta, readiness: readinessResult.readiness, checks: readinessResult.checks },
      support: supportReference,
    },
  }
}
