import type { AgentProfile, ExecutionProfileView } from '@personal-agent/contracts'
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
