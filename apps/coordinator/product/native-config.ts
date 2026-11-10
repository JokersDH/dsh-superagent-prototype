import type { AgentProfile } from '@personal-agent/contracts'
import type { CheckDefinition } from '@personal-agent/verification'
import type { ProjectEnvironmentPolicy } from './environments.ts'

export interface NativeProductConfiguration {
  profile: AgentProfile
  projects: readonly { id: string; path: string; check: CheckDefinition; environment?: ProjectEnvironmentPolicy }[]
  approvalPolicy: 'untrusted' | 'on-request'
  model?: string
}
