import type { AgentProfile } from '../../../contracts/src/types.ts'

export const DSH_POLICY_PROTOCOL: 'personal-agent-dsh-installation/1'
export const DSH_POLICY_REVISION: 'dsh-workspace-enforced-v1'
export const DSH_NATIVE_VERSION: '0.2.1-rc.2'
export const DSH_PRELOAD: string
export type DshPolicyInstallation = {
  profile: AgentProfile
  policyIdentity: string
  manifestPath: string
  readiness: 'policy_installed' | 'needs_auth'
  diagnostics: string[]
}
export function installDshAcpPolicy(input: {
  connectionRoot: string
  profileId: string
  revision?: number
  nodeExecutable: string
  dshEntry: string
  moduleRoot?: string
  model: { id: string; api?: 'openai-completions' | 'openai-responses' | 'anthropic-messages'; baseURL: string; apiKey?: string }
}): Promise<DshPolicyInstallation>
export function manifestForDshProfile(profile: AgentProfile): string
export function verifyDshAcpPolicy(profile: AgentProfile): DshPolicyInstallation & { plan: Record<string, unknown> }
export function inspectDshAcpProfile(profile: AgentProfile): DshPolicyInstallation & {
  nativeVersion: string
  executableDigest: string
  configFingerprint: string
  credentialReference?: string
}
