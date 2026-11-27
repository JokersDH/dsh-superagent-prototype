import type { AgentProfile, AttemptRef, ExecutionProfileView, Json, Scope } from '@personal-agent/contracts'
import type { CheckDefinition } from '@personal-agent/verification'
import type { ProjectEnvironmentPolicy } from './environments.ts'

export interface NativeProductConfiguration {
  profile: AgentProfile
  /** Public facts from main's shared projection; supplying a view is not runtime authorization. */
  profileView?: ExecutionProfileView
  /** Trusted synchronous admission check before new native work; never supplied by HTTP/profile text. */
  admissionCurrent?: () => boolean
  projects: readonly { id: string; path: string; check: CheckDefinition; environment?: ProjectEnvironmentPolicy }[]
  approvalPolicy: 'untrusted' | 'on-request'
  collaborationMode?: 'plan' | 'default'
  model?: string
}

/** Trusted local composition only; HTTP/profile documents cannot supply these functions. */
export interface ProductExecutorConfiguration {
  profile: AgentProfile
  profileView: ExecutionProfileView
  admissionCurrent: () => boolean
  projects: NativeProductConfiguration['projects']
  /** Digest of the immutable, non-secret policy/configuration and its enforcing implementation. */
  policyIdentity: string
  /** Pure request-template construction. Native policy.prepared remains required before begin. */
  settings(context: { attempt: AttemptRef; workspacePath: string; scope: Scope }): Json
}
