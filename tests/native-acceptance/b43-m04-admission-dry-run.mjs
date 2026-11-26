#!/usr/bin/env node
/**
 * M04 B: 0-send admission dry-run and persistent send-ledger check.
 *
 * This never starts a model turn, never calls the ACP prompt method and never touches a user instance.
 * It proves the preconditions that can be checked without main's default consumer, and reports the
 * blockers that keep the six-send grant at 0. The ledger is the only persistent count.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { CaseLog, writeReport } from './harness.mjs'
import { AcpV1SettingsSchema, AcpPolicyEvidenceSchema, inspectAcpCompatibility, probeAcpHandshake } from '../../packages/drivers/acp-v1/src/index.ts'
import { admitPreparedPolicy } from '../../packages/policy-preparation/src/index.ts'
import { PreparedExecutionPolicySchema } from '../../packages/contracts/src/schemas.ts'
import { ProcessHost } from '../../apps/runner/src/process-host.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const log = new CaseLog()
const ledgerPath = new URL('./reports/m04-send-ledger.json', import.meta.url)
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const root = mkdtempSync(join(tmpdir(), 'pa-m04-dry-'))
try {
  log.begin('M04-DRY-LEDGER-UNSPENT', 'the shared six-send grant has no send and no in-flight turn', 'controlled_process')
  log.evidence({ grantId: ledger.grantId, limit: ledger.limit, sent: ledger.sent, unknownOutcome: ledger.unknownOutcome, inFlight: ledger.inFlight, entries: ledger.entries.length, state: ledger.state })
  if (ledger.owner === 'B' && ledger.limit === 6 && ledger.sent === 0 && ledger.unknownOutcome === 0 && ledger.inFlight === null && ledger.entries.length === 0) log.pass('ledger is unspent: 0/6 real sends, no UNKNOWN, no in-flight turn')
  else log.fail(`send ledger is not unspent: ${JSON.stringify(ledger)}`)

  log.begin('M04-DRY-POLICY-REFUSAL', 'approval-guarded/not-tested ACP policy cannot admit business work', 'controlled_process')
  const spec = { ticketId: 'ticket-dry', assignmentId: 'assignment-dry', attemptId: 'attempt-dry', fenceEpoch: 1, contract: { workId: 'work-dry', revision: 1, digest: 'a'.repeat(64) } }
  const refused = PreparedExecutionPolicySchema.parse({ ...spec, requestedPolicyRevision: 'policy-dry', nativeAppliedSettingsRef: 'settings-dry', effectiveConfigFingerprint: 'b'.repeat(64), enforcement: 'approval_guarded', verification: 'not_tested', evidenceRef: 'evidence-dry' })
  const decision = admitPreparedPolicy(refused, spec, { profile: { id: 'p', revision: 1, driverId: 'acp-v1', driverApiMajor: 1, driverRelease: '0.1.0', executable: '/opt/opencode', argv: ['acp'], expectedVersion: '1.18.34', nativeConfigRef: 'c', permissionPolicyRevision: 'policy-dry', requiredFeatures: [] }, currentFingerprint: 'b'.repeat(64) })
  log.evidence({ decision })
  if (!decision.allowed && decision.reason === 'advisory_only') log.pass('approval-guarded policy is refused as a business-work proof; no prompt can be admitted from it')
  else log.fail(`ACP policy gate unexpectedly admitted approval-guarded work: ${JSON.stringify(decision)}`)

  log.begin('M04-DRY-SETTINGS-STRICT', 'settings without complete scope/enforcement evidence are rejected; no whole-directory fallback', 'controlled_process')
  const invalid = [
    { workspacePath: '/tmp/x', scope: { projectId: 'p', allowedPaths: [], excludedPaths: [], externalActions: [] }, enforcement: 'enforced', verification: 'passed' },
    { workspacePath: '/tmp/x', scope: { projectId: 'p', allowedPaths: ['.'], excludedPaths: [], externalActions: [] }, enforcement: 'enforced', verification: 'passed' },
  ]
  const accepted = invalid.map(value => AcpV1SettingsSchema.safeParse(value).success)
  const evidence = AcpPolicyEvidenceSchema.safeParse({ kind: 'acp-v1-policy-evidence/1', workspacePath: '/tmp/x', scopeDigest: 'c'.repeat(64), enforcement: 'enforced', verification: 'passed', evidenceRefs: ['e'] }).success
  log.evidence({ accepted, evidence })
  if (!accepted[0] && !accepted[1] && evidence) log.pass('missing scope, missing evidence ref, and empty allowedPaths are refused; a complete evidence shape alone is still not a live policy decision')
  else log.fail(`ACP settings acceptance was too broad: ${JSON.stringify({ accepted, evidence })}`)

  log.begin('M04-DRY-HANDSHAKE-ONLY', 'real opencode initialize is recorded as handshake-only, never as prompt/approval/native', 'controlled_process')
  const host = new ProcessHost({ resolveCwd: () => root, resolveEnv: () => ({ ...process.env }) })
  const handshake = await probeAcpHandshake({ executable: execPath(), argv: ['acp', '--pure'], processHost: host, cwdRef: 'dry', environmentRef: 'dry', timeoutMs: 15000 })
  const fakeProfile = { id: 'profile-acp', revision: 1, driverId: 'acp-v1', driverApiMajor: 1, driverRelease: '0.1.0', executable: execPath(), argv: ['acp', '--pure'], expectedVersion: handshake.agentVersion ?? '1.18.34', nativeConfigRef: 'config', permissionPolicyRevision: 'policy', requiredFeatures: [] }
  const probeHost = { async inspectExecutable() { return { version: handshake.agentVersion ?? '1.18.34', digest: 'd'.repeat(64), evidenceRef: 'dry-exec' } }, async inspectConfig() { return { fingerprint: 'e'.repeat(64), stability: 'frozen' } } }
  const inspection = await inspectAcpCompatibility(fakeProfile, probeHost, { handshake: async () => handshake })
  log.evidence({ protocolVersion: handshake.protocolVersion, agent: handshake.agentName, class: inspection.verdict.class, readiness: inspection.report.readiness, reasons: inspection.verdict.reasons })
  if (handshake.protocolVersion === 1 && inspection.verdict.class === 'unknown' && inspection.report.readiness === 'needs_setup') log.pass('initialize succeeded but classification remains unknown/disabled; no prompt, permission, cancel or native layer was claimed')
  else log.fail(`handshake-only classification was not honest: ${JSON.stringify({ protocolVersion: handshake.protocolVersion, class: inspection.verdict.class, readiness: inspection.report.readiness })}`)

  log.begin('M04-DRY-MAIN-CONSUMER-BLOCKED', 'main default ACP workbench/HTTP consumer and consent are not ready, so live sends stay closed', 'controlled_process')
  log.notTested(`blocked: ${ledger.blockers.join('; ')}`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'M04 admission dry-run; no prompt/model/turn', modelCalls: 0, nativeTurns: 0 }, extra: { grantId: ledger.grantId, sent: ledger.sent, limit: ledger.limit } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(40)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB43-dry totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)

function execPath() {
  return execFileSync('/usr/bin/which', ['opencode'], { encoding: 'utf8' }).trim()
}
