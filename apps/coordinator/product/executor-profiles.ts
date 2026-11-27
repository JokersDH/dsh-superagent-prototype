import { AgentProfileSchema, ExecutionProfileViewSchema, DigestSchema, JsonSchema } from '@personal-agent/contracts'
import type { ExecutionProfileRef, ExecutionOperationView } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { NativeCodexSettingsSchema } from '../../../packages/drivers/codex-native/src/native.ts'
import type { NativeProductConfiguration, ProductExecutorConfiguration } from './native-config.ts'

const digest = (value: unknown) => canonicalDigest(JsonSchema.parse(value))

/** Preserve the existing Codex composition while removing its policy knowledge from execution. */
function legacyCodex(input: NativeProductConfiguration): ProductExecutorConfiguration {
  const profile = AgentProfileSchema.parse(structuredClone(input.profile))
  if (profile.driverId !== 'codex-native') throw new TypeError('A non-Codex executor needs an explicit registered policy adapter')
  const policy = { approvalPolicy: input.approvalPolicy,
    ...(input.collaborationMode ? { collaborationMode: input.collaborationMode } : {}),
    ...(input.model ? { model: input.model } : {}) }
  return {
    profile,
    profileView: input.profileView ?? { id: profile.id, revision: profile.revision,
      displayName: `Codex · 本机开发 · ${profile.expectedVersion}`, driverId: profile.driverId,
      kind: 'native', readiness: 'native_test_passed', dispatchAllowed: true },
    admissionCurrent: input.admissionCurrent ?? (() => true), projects: input.projects,
    policyIdentity: digest({ protocol: 'codex-policy-adapter/1', profile, policy }),
    settings: ({ workspacePath, scope }) => JsonSchema.parse(NativeCodexSettingsSchema.parse({
      kind: 'codex-native-settings/1', workspacePath, scope, ...policy, timeoutMs: 600000,
    })),
  }
}

/** Configuration registry, not a scheduler or a second Catalog. Views consume original facts. */
export function executorProfiles(native?: NativeProductConfiguration, additional: readonly ProductExecutorConfiguration[] = []): readonly ProductExecutorConfiguration[] {
  const entries = [...(native ? [legacyCodex(native)] : []), ...additional].map(entry => {
    const profile = AgentProfileSchema.parse(structuredClone(entry.profile))
    const profileView = ExecutionProfileViewSchema.parse(structuredClone(entry.profileView))
    if (profileView.id !== profile.id || profileView.revision !== profile.revision ||
        profileView.driverId !== profile.driverId || profileView.kind !== 'native' || !profileView.dispatchAllowed)
      throw new TypeError('Executor view must match its trusted admitted profile')
    if (typeof entry.admissionCurrent !== 'function' || typeof entry.settings !== 'function')
      throw new TypeError('Executor composition needs trusted admission and policy functions')
    const projects = structuredClone(entry.projects)
    if (new Set(projects.map(project => project.id)).size !== projects.length)
      throw new TypeError('Executor project identities must be unique')
    return Object.freeze({ ...entry, profile, profileView, projects, policyIdentity: DigestSchema.parse(entry.policyIdentity) })
  })
  if (new Set(entries.map(entry => entry.profile.id)).size !== entries.length)
    throw new TypeError('Execution profile identities must be unique')
  const projects = new Map<string, string>()
  for (const entry of entries) for (const project of entry.projects) {
    const identity = digest(JSON.parse(JSON.stringify(project)))
    const existing = projects.get(project.id)
    if (existing !== undefined && existing !== identity)
      throw new TypeError('Profiles cannot assign conflicting paths, checks or environments to the same project')
    projects.set(project.id, identity)
  }
  return Object.freeze(entries)
}

export function executorProfileRef(entry: ProductExecutorConfiguration): ExecutionProfileRef {
  return { profileId: entry.profile.id, revision: entry.profile.revision,
    identityDigest: digest({ profile: entry.profile, policyIdentity: entry.policyIdentity }) }
}

export function executorAdmissionCurrent(entry: ProductExecutorConfiguration): boolean {
  try { return entry.admissionCurrent() === true } catch { return false }
}

export function executorOperationAllowed(entry: ProductExecutorConfiguration | undefined, operation: ExecutionOperationView['operation']): boolean {
  if (!entry || operation === 'begin' && !executorAdmissionCurrent(entry)) return false
  const facts = entry.profileView.compatibility
  // Only the legacy, already-native-verified lane lacks per-operation compatibility facts.
  return facts ? facts.operations.some(item => item.operation === operation && item.enabled)
    : entry.profileView.readiness === 'native_test_passed'
}
