import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { AgentProfile, ExecutionOperationView } from '@personal-agent/contracts'
import { ProcessHost } from '../../runner/src/process-host.ts'
import { inspectAcpCompatibility, probeAcpHandshake } from '../../../packages/drivers/acp-v1/src/index.ts'
import type { AcpHandshake } from '../../../packages/drivers/acp-v1/src/index.ts'
import { inspectDshAcpProfile } from '../../../packages/drivers/acp-v1/native-policies/dsh-policy-installation.mjs'
import { listAcpConnections } from './acp-connections.ts'
import { NativeAdmissionError } from './native-startup.ts'
import type { NativeExecutorInspection } from './native-inspection.ts'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))
const pending = new Map<string, { pid: number; resourceRef: string; evidenceRoot: string }>()

/** Source/configuration identity only. Neither this hash nor standard conformance grants a turn. */
export function acpInspectionPolicyDigest(profile: AgentProfile): string {
  const metadata = inspectDshAcpProfile(profile)
  const sources = Object.fromEntries([
    ['driver', new URL('../../../packages/drivers/acp-v1/src/index.ts', import.meta.url)],
    ['codec', new URL('../../../packages/drivers/acp-v1/src/protocol.ts', import.meta.url)],
    ['catalog', new URL('../../../packages/catalog/src/compatibility.ts', import.meta.url)],
    ['runner', new URL('../../runner/src/runner-service.ts', import.meta.url)],
    ['host', new URL('../../runner/src/process-host.ts', import.meta.url)],
    ['observer', new URL('../../runner/src/owned-process-observer.ts', import.meta.url)],
    ['factory', new URL('../../runner/src/driver-factory.ts', import.meta.url)],
    ['application', new URL('../../../packages/application/src/service.ts', import.meta.url)],
    ['execution', new URL('./execution.ts', import.meta.url)],
    ['attempt', new URL('./native-attempt.ts', import.meta.url)],
    ['profiles', new URL('./executor-profiles.ts', import.meta.url)],
    ['inspection', new URL('./acp-inspection.ts', import.meta.url)],
    ['startup', new URL('./acp-startup.ts', import.meta.url)],
    ['connections', new URL('./acp-connections.ts', import.meta.url)],
    ['consent', new URL('./executor-trial.ts', import.meta.url)],
  ].map(([name, path]) => [String(name), createHash('sha256').update(readFileSync(path as URL)).digest('hex')]))
  return digest({ protocol: 'standard-acp-product-policy/1', profile, nativePolicyIdentity: metadata.policyIdentity,
    scopeSupport: { allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [], expiry: false },
    sources, requiredBeforeBusiness: ['original-profile-consent', 'current-contract', 'native-guard-activation', 'fresh-answer-guard', 'original-resource-barrier'] })
}

/** Exactly initialize then normal EOF, with an original owned spawn. No session, prompt or signals. */
async function ownedHandshake(stateRoot: string, profile: AgentProfile): Promise<AcpHandshake> {
  if (pending.has(profile.id)) throw new NativeAdmissionError('probe_failed')
  const parent = join(stateRoot, 'agent-inspections')
  try { mkdirSync(parent, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const parentIdentity = lstatSync(parent)
  if (!parentIdentity.isDirectory() || parentIdentity.isSymbolicLink() || parentIdentity.mode & 0o077 ||
      process.getuid && parentIdentity.uid !== process.getuid()) throw new NativeAdmissionError('probe_failed')
  const evidenceRoot = mkdtempSync(join(parent, 'acp-')), workspace = join(evidenceRoot, 'workspace')
  mkdirSync(workspace, { mode: 0o700 })
  const host = new ProcessHost({ resolveCwd: () => workspace })
  const child = await host.spawn({ executable: profile.executable, argv: [...profile.argv], cwdRef: 'acp-inspection-workspace', environmentRef: 'acp-inspection' })
  const original = host.originalIdentity(child.resourceRef)
  const record = { pid: child.identity.pid, resourceRef: child.resourceRef, evidenceRoot }
  pending.set(profile.id, record)
  void child.exited.then(() => { if (pending.get(profile.id) === record) pending.delete(profile.id) })
  try {
    if (!original) throw new NativeAdmissionError('probe_failed')
    writeFileSync(join(evidenceRoot, 'original-spawn.json'), JSON.stringify({ protocol: 'owned-acp-inspection/1', profile,
      original, resourceRef: child.resourceRef, workspace }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    void (async () => { for await (const _ of child.stderr) { /* Native diagnostics and account material stay private. */ } })().catch(() => undefined)
    return await probeAcpHandshake({ transport: { resourceRef: child.resourceRef, stdout: child.stdout,
      write: bytes => host.write(child.resourceRef, bytes), closeInput: () => host.closeInput(child.resourceRef) } })
  } finally {
    try { await host.closeInput(child.resourceRef) } catch { /* Observation below is authoritative for exit only. */ }
    const exit = await Promise.race([child.exited, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 2500))])
    if (!exit || exit.code !== 0 || exit.signal !== null) throw new NativeAdmissionError('probe_failed')
    // Retain private probe/activation records; a leader exit does not prove full-group quiescence.
  }
}

export async function inspectAcpConnection(stateRoot: string, profileId: string, options: {
  /** Trusted zero-model consumer seam; never configurable by HTTP or a connection file. */
  handshake?: (profile: AgentProfile) => Promise<AcpHandshake>
} = {}): Promise<NativeExecutorInspection> {
  const entry = listAcpConnections(stateRoot).find(entry => entry.id === profileId)
  if (!entry?.connection || entry.readiness === 'invalid') throw new NativeAdmissionError('not_admitted')
  if (entry.readiness === 'needs_auth') throw new NativeAdmissionError('needs_auth')
  const profile = entry.connection.profile
  try {
    const before = inspectDshAcpProfile(profile)
    const { verdict } = await inspectAcpCompatibility(profile, {
      async inspectExecutable() { return { version: before.nativeVersion, digest: before.executableDigest, evidenceRef: `executable-sha256:${before.executableDigest}` } },
      async inspectConfig(reference) {
        if (reference !== profile.nativeConfigRef) throw new Error('Unknown ACP configuration reference')
        return { fingerprint: before.configFingerprint, stability: 'frozen' }
      },
    }, { handshake: options.handshake ?? (current => ownedHandshake(stateRoot, current)) })
    if (inspectDshAcpProfile(profile).policyIdentity !== before.policyIdentity) throw new NativeAdmissionError('probe_failed')
    const compatible = verdict.class === 'compatible_unverified'
    const operations: readonly ExecutionOperationView[] = (['begin', 'answer', 'steer', 'cancel', 'resume'] as const).map(operation =>
      compatible && ['begin', 'answer', 'cancel'].includes(operation)
        ? { operation, supported: true, validation: 'controlled', enabled: false }
        : { operation, supported: compatible ? false : null, validation: compatible ? 'controlled' : 'unobserved', enabled: false })
    return { profile, displayName: `${entry.displayName} · ${entry.connection.modelId}`.slice(0, 160), verdict, operations,
      identityDigest: digest(verdict.identity ?? { profile, classification: verdict.class }), policyDigest: acpInspectionPolicyDigest(profile) }
  } catch (error) { if (error instanceof NativeAdmissionError) throw error; throw new NativeAdmissionError('probe_failed') }
}
