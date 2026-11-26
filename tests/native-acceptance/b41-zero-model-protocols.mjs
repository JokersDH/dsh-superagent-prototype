#!/usr/bin/env node
/**
 * M04 B: zero-model protocol selection evidence with real local identities.
 *
 * Every value below is derived from this machine: resolved executable bytes, exact CLI version,
 * a hash-only fingerprint of the reviewed config file, and the actual ACP initialize response.
 * No synthetic digest, no hard-coded acceptance version, no prompt/session/model turn. Layers are
 * explicit: advertised / observed / controlled / native. A successful handshake is only a handshake.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'
import { inspectCodexCompatibility, probeCodexSurface } from '../../packages/drivers/codex-native/src/index.ts'
import { inspectAcpCompatibility, probeAcpHandshake } from '../../packages/drivers/acp-v1/src/index.ts'
import { ProcessHost } from '../../apps/runner/src/process-host.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-m04-protocols-'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const fileDigest = path => sha256(readFileSync(realpathSync(path)))
const configFingerprint = paths => {
  const entries = paths.filter(path => { try { return readFileSync(path).length > 0 } catch { return false } })
    .map(path => ({ name: path.split('/').pop(), digest: fileDigest(path) })).sort((a, b) => a.name < b.name ? -1 : 1)
  return { fingerprint: entries.length ? sha256(JSON.stringify(entries)) : null, files: entries.map(entry => entry.name) }
}
const cliVersion = command => execFileSync(command, ['--version'], { encoding: 'utf8' }).trim().split('\n').pop().trim()
try {
  log.begin('M04-CODEX-ZERO-MODEL-SCHEMA', 'real Codex executable/schema observation classified with layer facts', 'controlled_process')
  const codexPath = execFileSync('/usr/bin/which', ['codex'], { encoding: 'utf8' }).trim()
  const codexDigest = fileDigest(codexPath)
  const codexVersion = cliVersion(codexPath).replace(/^codex-cli\s+/i, '')
  const codexConfig = configFingerprint([join(process.env.HOME, '.codex/config.toml')])
  const profile = {
    id: 'profile-codex-installed', revision: 1, driverId: 'codex-native', driverApiMajor: 1, driverRelease: '0.1.0',
    executable: codexPath, argv: [], expectedVersion: codexVersion, nativeConfigRef: 'config-codex', permissionPolicyRevision: 'policy-codex', requiredFeatures: [],
  }
  const codexHost = {
    async inspectExecutable() { return { version: codexVersion, digest: codexDigest, evidenceRef: `exec-sha256:${codexDigest}` } },
    async inspectConfig() { return { fingerprint: codexConfig.fingerprint ?? '0'.repeat(64), stability: codexConfig.fingerprint ? 'frozen' : 'unverified' } },
  }
  const codex = await inspectCodexCompatibility(profile, codexHost)
  const codexSurface = await probeCodexSurface({ executable: codexPath })
  const observedSurface = codexSurface.status === 'observed' ? {
    methods: codexSurface.surface.methods,
    requestFields: codexSurface.surface.requestFields,
    notifications: codexSurface.surface.notifications,
    serverRequests: codexSurface.surface.serverRequests,
    requestIdTypes: codexSurface.surface.requestIdTypes,
    schemaDigest: codexSurface.surface.schemaDigest,
  } : { status: codexSurface.status, reason: codexSurface.reason }
  const codexLayers = {
    executable: { advertised: codexVersion, observed: { digest: codexDigest, version: codexVersion }, controlled: false, native: false },
    schema: { advertised: 'codex-app-server-json-schema', observed: observedSurface, controlled: false, native: false },
    native: false,
    config: { advertised: codexConfig.files, observed: { fingerprint: codexConfig.fingerprint }, controlled: false, native: false },
  }
  log.evidence({ class: codex.verdict.class, admission: codex.verdict.admission, identity: codex.verdict.identity, missing: codex.verdict.missing,
    reasons: codex.verdict.reasons.slice(0, 8), layers: codexLayers })
  if (codex.verdict.identity?.executableDigest === codexDigest && codex.verdict.identity?.nativeVersion === codexVersion &&
      codex.verdict.identity?.schemaDigest && codex.verdict.class === 'compatible_unverified' && codex.verdict.nativeTestPassed === false) {
    log.pass(`real Codex ${codexVersion} (${codexDigest.slice(0, 12)}…) matched the used schema surface; classification=${codex.verdict.class}, native=false`)
  } else log.fail(`Codex real-identity probe failed: ${JSON.stringify({ class: codex.verdict.class, identity: codex.verdict.identity, missing: codex.verdict.missing, reasons: codex.verdict.reasons })}`)

  log.begin('M04-ACP-INITIALIZE-ONLY', 'actual opencode ACP initialize under original owned-process identity', 'controlled_process')
  const opencodePath = execFileSync('/usr/bin/which', ['opencode'], { encoding: 'utf8' }).trim()
  const opencodeDigest = fileDigest(opencodePath)
  const opencodeVersion = cliVersion(opencodePath)
  const opencodeConfig = configFingerprint([join(process.env.HOME, '.config/opencode/opencode.json'), join(process.env.HOME, '.config/opencode/opencode.jsonc')])
  const processHost = new ProcessHost({ resolveCwd: () => root, resolveEnv: () => ({ ...process.env }) })
  const handshake = await probeAcpHandshake({
    executable: opencodePath, argv: ['acp', '--pure'], timeoutMs: 15000,
    processHost, cwdRef: 'acp-probe', environmentRef: 'acp-probe',
  })
  const acpProfile = {
    id: 'profile-acp-installed', revision: 1, driverId: 'acp-v1', driverApiMajor: 1, driverRelease: '0.1.0',
    executable: opencodePath, argv: ['acp', '--pure'], expectedVersion: opencodeVersion, nativeConfigRef: 'config-acp', permissionPolicyRevision: 'policy-acp', requiredFeatures: [],
  }
  const acpHost = {
    async inspectExecutable() { return { version: opencodeVersion, digest: opencodeDigest, evidenceRef: `exec-sha256:${opencodeDigest}` } },
    async inspectConfig() { return { fingerprint: opencodeConfig.fingerprint ?? '0'.repeat(64), stability: opencodeConfig.fingerprint ? 'frozen' : 'unverified' } },
  }
  const acp = await inspectAcpCompatibility(acpProfile, acpHost, { handshake: async () => handshake })
  const advertised = handshake.capabilities
  const layers = {
    initialize: { advertised: true, observed: { protocolVersion: handshake.protocolVersion, agentName: handshake.agentName, agentVersion: handshake.agentVersion, capabilities: advertised }, controlled: false, native: false },
    'session/new': { advertised: 'protocol', observed: false, controlled: false, native: false },
    'session/prompt': { advertised: 'protocol', observed: false, controlled: false, native: false },
    'session/request_permission': { advertised: 'protocol', observed: false, controlled: false, native: false },
    'session/cancel': { advertised: 'protocol', observed: false, controlled: false, native: false },
    'request-id-types': { advertised: 'protocol', observed: false, controlled: false, native: false },
    native: false,
  }
  log.evidence({ class: acp.verdict.class, admission: acp.verdict.admission, identity: acp.verdict.identity, missing: acp.verdict.missing,
    reasons: acp.verdict.reasons.slice(0, 8), initialize: layers.initialize.observed, config: opencodeConfig, layers })
  if (handshake.protocolVersion === 1 && handshake.agentVersion === opencodeVersion &&
      acp.verdict.identity?.executableDigest === opencodeDigest && acp.verdict.identity?.nativeVersion === opencodeVersion) {
    log.pass(`opencode ${opencodeVersion} (${opencodeDigest.slice(0, 12)}…) answered initialize protocolVersion 1 with real executable/config identity; only initialize is observed, prompt/permission/cancel/native remain unobserved`)
  } else log.fail(`ACP real-identity probe failed: ${JSON.stringify({ handshake, identity: acp.verdict.identity, reasons: acp.verdict.reasons })}`)

  log.begin('M04-CLAUDE-NOT-ACP', 'Claude headless JSON is not ACP; no adapter is installed or silently substituted', 'controlled_process')
  const claudePath = execFileSync('/usr/bin/which', ['claude'], { encoding: 'utf8' }).trim()
  const claudeVersion = cliVersion(claudePath)
  let adapterPresent = false
  try { execFileSync('/usr/bin/which', ['claude-code-acp'], { stdio: 'ignore' }); adapterPresent = true } catch {}
  log.evidence({ claudeVersion, adapterPresent, claudeHeadlessIsAcp: false, layers: { initialize: { advertised: false, observed: false, controlled: false, native: false } } })
  if (!adapterPresent) log.pass(`Claude Code ${claudeVersion} has no ACP adapter installed; headless JSON is not treated as ACP and no global install was attempted`)
  else log.fail('an ACP adapter appeared without an explicit reviewed dependency; stop and inspect before use')

  log.begin('M04-SCOPE-ZERO-MODEL', 'no prompt/turn, no session prompt, no credential content read', 'controlled_process')
  log.notTested('initialize/schema and hash-only config inspection only; no real prompt was sent and no native/value claim is made')
} finally {
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'M04 zero-model protocol probe with real executable/config identities', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'installed CLIs; no prompt/session' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(44)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB41-protocols totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
