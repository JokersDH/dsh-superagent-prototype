import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { AgentProfile, ExecutionOperationView } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { CompatibilityVerdict } from '../../../packages/catalog/src/compatibility.ts'
import { inspectCodexCompatibility, probeCodexSurface } from '../../../packages/drivers/codex-native/src/index.ts'
import { NativeAdmissionError, admittedNativeProfile } from './native-startup.ts'

export type NativeExecutorInspection = {
  profile: AgentProfile
  verdict: CompatibilityVerdict
  operations: readonly ExecutionOperationView[]
  identityDigest: string
  policyDigest: string
}

/** Trusted Node-only seam: tests name their own normally exiting fake CLI. Never HTTP input. */
type InspectionOptions = { executable?: string }
const pending = new Map<string, { pid: number | undefined; argv: readonly string[]; uid: number | undefined; startedAt: string }>()
/** Bounded read-only command inspection. Timeout retains the exact pending spawn, never signals it. */
async function run(executable: string, argv: readonly string[]): Promise<{ stdout: string }> {
  if (pending.has(executable)) throw new NativeAdmissionError('probe_failed')
  const child = spawn(executable, [...argv], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  const record = { pid: child.pid, argv: Object.freeze([executable, ...argv]), uid: process.getuid?.(), startedAt: new Date().toISOString() }
  pending.set(executable, record)
  child.stdin.on('error', () => undefined); child.stdin.end()
  return await new Promise((resolve, reject) => {
    let text = '', bytes = 0, overflow = false
    const timer = setTimeout(() => reject(new NativeAdmissionError('probe_failed')), 15000)
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes <= 256 * 1024) text += chunk.toString('utf8'); else overflow = true })
    child.stderr.on('data', () => undefined) // Authentication/native errors must never escape the process.
    const finished = () => { clearTimeout(timer); if (pending.get(executable) === record) pending.delete(executable) }
    child.once('error', () => { finished(); reject(new NativeAdmissionError('probe_failed')) })
    child.once('close', (code, signal) => {
      finished()
      if (signal || overflow) reject(new NativeAdmissionError('probe_failed'))
      else if (code !== 0) reject(Object.assign(new Error('Inspection command refused'), { code }))
      else resolve({ stdout: text })
    })
  })
}
const hashExecutable = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))

/** The explicitly named product configuration, distinct from the operator's native resolved config. */
function policyTemplate(profile: AgentProfile) {
  return {
    protocol: 'codex-product-policy-template/1',
    profile,
    initialize: { clientInfo: { name: 'personal_agent', version: '0.1.0' }, capabilities: { experimentalApi: true } },
    thread: {
      cwd: 'current-assignment-worktree', approvalPolicy: 'on-request', approvalsReviewer: 'user',
      sandbox: 'workspace-write', ephemeral: true,
      config: {
        mcp_servers: {}, features: { apps: false },
        sandbox_workspace_write: { network_access: false, exclude_slash_tmp: true, exclude_tmpdir_env_var: true },
      },
    },
    nativeResolvedConfiguration: 'unobserved',
    enforcerSourceDigests: Object.fromEntries([
      ['driver', new URL('../../../packages/drivers/codex-native/src/native.ts', import.meta.url)],
      ['attemptGuard', new URL('./native-attempt.ts', import.meta.url)],
      ['execution', new URL('./execution.ts', import.meta.url)],
      ['startupAdmission', new URL('./inspected-startup.ts', import.meta.url)],
      ['trialConsent', new URL('./executor-trial.ts', import.meta.url)],
      ['inspection', new URL('./native-inspection.ts', import.meta.url)],
      ['resourceBarrier', new URL('../resource-barrier.ts', import.meta.url)],
    ].map(([name, url]) => [String(name), createHash('sha256').update(readFileSync(url as URL)).digest('hex')])),
    requiredBeforeBusiness: ['current-contract', 'native-applied-policy', 'fresh-answer-guard', 'original-owned-resource-barrier'],
    controlledConsumerSources: ['packages/drivers/codex-native/test/native.test.ts', 'tests/integration/original-native-callback-flow.case.mjs'],
  }
}
export function nativeInspectionPolicyDigest(profile: AgentProfile, executableDigest: string): string {
  return digest({ protocol: 'native-inspection-policy/1', profile, executableDigest, productRequestTemplateDigest: digest(policyTemplate(profile)),
    nativeResolvedConfiguration: 'unobserved' })
}

/** A restored source only proposes a fresh target profile; this observation grants no execution. */
export async function inspectRecoveryExecutor(options: {
  admit?: () => AgentProfile; inspect?: () => Promise<NativeExecutorInspection>
} = {}): Promise<AgentProfile | undefined> {
  try { return (options.admit ?? admittedNativeProfile)() }
  catch (error) {
    if (!(error instanceof NativeAdmissionError)) throw error
    if (!['incompatible_version', 'not_admitted'].includes(error.reason)) return undefined
  }
  try {
    const inspection = await (options.inspect ?? inspectNativeExecutor)()
    return inspection.verdict.class === 'compatible_unverified' && inspection.operations.some(operation =>
      operation.operation === 'begin' && operation.supported === true && ['controlled', 'native'].includes(operation.validation))
      ? inspection.profile : undefined
  } catch (error) { if (error instanceof NativeAdmissionError) return undefined; throw error }
}

/**
 * Inspect an installed Codex without a session/prompt or native home/credential-file reads. It does
 * not consume an admission receipt. Protocol compatibility covers this product's immutable request
 * template, not all native settings. The original Driver must still confirm actual policy before a
 * business turn, and explicit trial consent never becomes native verification.
 */
export async function inspectNativeExecutor(options: InspectionOptions = {}): Promise<NativeExecutorInspection> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new NativeAdmissionError('unsupported_platform')
  let executable: string
  try {
    const located = options.executable ?? (await run('/usr/bin/which', ['codex'])).stdout.trim()
    if (!isAbsolute(located)) throw new Error('Executor location is not absolute')
    executable = realpathSync(located)
    const stat = statSync(executable)
    if (!stat.isFile() || !(stat.mode & 0o111)) throw new Error('Executor is not executable')
  } catch { throw new NativeAdmissionError('not_installed') }

  let version: string, executableDigest: string
  try {
    executableDigest = hashExecutable(executable)
    version = (await run(executable, ['--version'])).stdout.trim()
    // Version is product metadata; arbitrary CLI output (including possible credentials) is not.
    if (!/^codex-cli [0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Unrecognized Codex version')
  } catch { throw new NativeAdmissionError('probe_failed') }

  try {
    // Authentication output stays private in this process. Do not include it in errors or evidence.
    await run(executable, ['login', 'status'])
  } catch (error) {
    const failure = error as { code?: number | string; signal?: string }
    if (failure.code === 1 && !failure.signal) throw new NativeAdmissionError('needs_auth')
    throw new NativeAdmissionError('probe_failed')
  }

  const profile: AgentProfile = {
    id: 'profile-codex-native', revision: 1, driverId: 'codex-native', driverApiMajor: 1,
    driverRelease: '0.1.0-native-mvp', executable,
    argv: ['app-server', '--disable', 'apps', '-c', 'mcp_servers={}', '-c', 'web_search="disabled"'],
    expectedVersion: version, nativeConfigRef: 'codex-product-request-policy-v1',
    permissionPolicyRevision: 'codex-worktree-1', requiredFeatures: [],
  }
  const templateDigest = digest(policyTemplate(profile))
  const { verdict } = await inspectCodexCompatibility(profile, {
    async inspectExecutable() { return { version, digest: executableDigest, evidenceRef: `executable-sha256:${executableDigest}` } },
    async inspectConfig(reference) {
      if (reference !== 'codex-product-request-policy-v1') throw new Error('Unknown product request configuration')
      // This reference names only the immutable product template. Native applied settings remain
      // unobserved here and must pass the original policy.prepared gate before any prompt is sent.
      return { fingerprint: templateDigest, stability: 'frozen' as const }
    },
  }, {
    probeSurface: async current => {
      const observation = await probeCodexSurface({ executable: current.executable, argv: current.argv,
        version: version.replace(/^codex-cli\s+/i, ''), runCommand: run })
      // Failed CLI command messages can embed stderr. Only fixed failure labels cross this module.
      return observation.status === 'observed' ? observation : { ...observation,
        reason: `schema_probe_${observation.status}`, evidenceRefs: [] }
    },
  })
  try {
    if (realpathSync(executable) !== executable || hashExecutable(executable) !== executableDigest)
      throw new Error('Executable changed during inspection')
  } catch { throw new NativeAdmissionError('probe_failed') }
  const facts: CompatibilityVerdict = {
    ...verdict,
    evidenceRefs: [...new Set([...verdict.evidenceRefs, `product-request-template:${templateDigest}`, 'native-resolved-config:unobserved'])],
    reasons: [...verdict.reasons, 'only_product_request_template_fingerprinted', 'native_resolved_configuration_unobserved'],
  }
  const protocolCompatible = verdict.class === 'compatible_unverified' || verdict.class === 'verified'
  const operations: readonly ExecutionOperationView[] = (['begin', 'answer', 'steer', 'cancel', 'resume'] as const)
    .map(operation => protocolCompatible && operation !== 'resume'
      ? { operation, supported: true, validation: 'controlled', enabled: false }
      : { operation, supported: null, validation: 'unobserved', enabled: false })
  return {
    profile, verdict: facts, operations,
    identityDigest: digest(facts.identity ?? { protocol: 'native-inspection-unverified-identity/1', profile, executableDigest,
      productRequestTemplateDigest: templateDigest }),
    policyDigest: nativeInspectionPolicyDigest(profile, executableDigest),
  }
}
