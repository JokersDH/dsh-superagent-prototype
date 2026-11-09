import type { AgentProfile } from '@personal-agent/contracts'
import type { CheckDefinition } from '@personal-agent/verification'

export interface NativeProductConfiguration {
  profile: AgentProfile
  projects: readonly { id: string; path: string; check: CheckDefinition }[]
  approvalPolicy: 'untrusted' | 'on-request'
  model?: string
}
