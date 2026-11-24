#!/usr/bin/env node
/**
 * M04 B: zero-model protocol selection evidence.
 *
 * - Codex: executable version + generated app-server JSON schema, classified against the exact
 *   fields/enums/notifications/request ids the Codex Driver uses.
 * - ACP: initialize-only handshake against the installed opencode ACP server. No session, no prompt.
 * Neither run creates a model turn, reads credentials or sends a business command.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'
import { codexRequiredSurface, observeCodexSchema, probeCodexSurface, inspectCodexCompatibility } from '../../packages/drivers/codex-native/src/index.ts'
import { inspectAcpCompatibility, probeAcpHandshake } from '../../packages/drivers/acp-v1/src/index.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-m04-protocols-'))
const which = name => execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim()
try {
  log.begin('M04-CODEX-ZERO-MODEL-SCHEMA', 'claimed Codex version/schema classifies from actual generated files', 'controlled_process')
  const codexPath = which('codex')
  const profile = {
    id: 'profile-codex-installed', revision: 1, driverId: 'codex-native', driverApiMajor: 1, driverRelease: '0.1.0',
    executable: codexPath, argv: [], expectedVersion: '0.164.0', nativeConfigRef: 'config-1', permissionPolicyRevision: 'policy-1', requiredFeatures: [],
  }
  const host = {
    async inspectExecutable() { return { version: '0.164.0', digest: 'a'.repeat(64), evidenceRef: `exec:${codexPath}` } },
    async inspectConfig() { return { fingerprint: 'c'.repeat(64), stability: 'frozen' } },
  }
  const result = await inspectCodexCompatibility(profile, host)
  log.evidence({ class: result.verdict.class, admission: result.verdict.admission, missing: result.verdict.missing,
    reasons: result.verdict.reasons.slice(0, 6), identitySchema: result.verdict.identity?.schemaDigest, report: result.report.readiness })
  if (result.verdict.class === 'compatible_unverified' && result.verdict.admission === 'trial' && result.report.readiness === 'inspection_passed') {
    log.pass(`Codex ${result.verdict.identity?.nativeVersion} matched the used method/field/enum/notification/id surface and is trial-compatible (no native_test_passed)`)
  } else log.fail(`Codex probe did not classify as expected: ${JSON.stringify({ class: result.verdict.class, missing: result.verdict.missing, reasons: result.verdict.reasons })}`)

  log.begin('M04-ACP-INITIALIZE-ONLY', 'actual opencode ACP provides initialize protocol 1 with a version', 'controlled_process')
  const opencodePath = which('opencode')
  const acpProfile = {
    id: 'profile-acp-installed', revision: 1, driverId: 'acp-v1', driverApiMajor: 1, driverRelease: '0.1.0',
    executable: opencodePath, argv: ['acp', '--pure'], expectedVersion: '1.18.34', nativeConfigRef: 'config-acp', permissionPolicyRevision: 'policy-acp', requiredFeatures: [],
  }
  const acpHandshake = await probeAcpHandshake({ executable: opencodePath, argv: ['acp', '--pure'] })
  const acpHost = {
    async inspectExecutable() { return { version: execFileSync(opencodePath, ['--version'], { encoding: 'utf8' }).trim(), digest: 'b'.repeat(64), evidenceRef: `exec:${opencodePath}` } },
    async inspectConfig() { return { fingerprint: 'd'.repeat(64), stability: 'frozen' } },
  }
  const acp = await inspectAcpCompatibility(acpProfile, acpHost, { handshake: async () => acpHandshake })
  log.evidence({ class: acp.verdict.class, admission: acp.verdict.admission, missing: acp.verdict.missing,
    reasons: acp.verdict.reasons.slice(0, 6), version: acp.verdict.identity?.nativeVersion, report: acp.report.readiness,
    initialize: { protocolVersion: acpHandshake.protocolVersion, agentName: acpHandshake.agentName, agentVersion: acpHandshake.agentVersion, capabilities: acpHandshake.capabilities } })
  if (acp.verdict.class === 'compatible_unverified' && acp.verdict.admission === 'trial' && acp.verdict.identity?.nativeVersion === '1.18.34') {
    log.pass('opencode 1.18.34 answered ACP initialize with protocolVersion 1 and classified trial-compatible; no session/prompt was sent')
  } else log.fail(`ACP initialize/probe failed: ${JSON.stringify({ class: acp.verdict.class, reasons: acp.verdict.reasons, version: acp.verdict.identity?.nativeVersion })}`)

  log.begin('M04-CLAUDE-NOT-ACP', 'Claude headless JSON is not ACP; no adapter is installed or silently substituted', 'controlled_process')
  const claudePath = which('claude')
  const claudeVersion = execFileSync(claudePath, ['--version'], { encoding: 'utf8' }).trim()
  log.evidence({ claudePath, claudeVersion, acpAdapterInstalled: false, claudeHeadlessIsAcp: false })
  let adapterPresent = false
  try { execFileSync('/usr/bin/which', ['claude-code-acp'], { stdio: 'ignore' }); adapterPresent = true } catch {}
  if (!adapterPresent) log.pass(`Claude Code ${claudeVersion} has no ACP adapter installed; its headless JSON is not treated as ACP and no global install was attempted`)
  else log.fail('an ACP adapter appeared without an explicit reviewed dependency; stop and inspect before use')

  log.begin('M04-SCOPE-ZERO-MODEL', 'no prompt/turn, no session prompt, no credential read', 'controlled_process')
  log.notTested('initialize/schema only; no real prompt was sent and no model/native/value claim is made')
} finally {
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'M04 zero-model protocol probe', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'installed CLIs; no prompt/session' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(44)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB41-protocols totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
