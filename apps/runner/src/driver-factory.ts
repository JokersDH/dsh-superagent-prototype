/** Installation-time registry. Unregistered IDs never fall back to a CLI or a fixture. */
import type { AgentDriverV1 } from '../../../packages/contracts/src/ports.ts'
import type { RunnerCommand } from '../../../packages/contracts/src/types.ts'
import { CodexProductDriver } from '../../../packages/drivers/codex-native/src/native.ts'
import { AcpDriver, type AcpPolicyHost } from '../../../packages/drivers/acp-v1/src/index.ts'
import { createDshAcpPolicyHost } from '../../../packages/drivers/acp-v1/native-policies/dsh-policy-host.mjs'
import type { ProcessHost } from './process-host.ts'

export const REAL_DRIVER_IDS = ['codex-native', 'acp-v1'] as const
export type RealDriverId = typeof REAL_DRIVER_IDS[number]
export function isRealDriverId(id: string): id is RealDriverId { return (REAL_DRIVER_IDS as readonly string[]).includes(id) }
export function createRealDriver(id: string, hooks: { beforeAnswerWrite(command: RunnerCommand): Promise<void>; isBusinessOpen?: () => boolean;
  ownedRuntime?: Pick<ProcessHost, 'originalIdentity'>; acpPolicyHost?: AcpPolicyHost }): AgentDriverV1 {
  switch (id) {
    case 'codex-native': return new CodexProductDriver({ beforeAnswerWrite: hooks.beforeAnswerWrite })
    case 'acp-v1': return new AcpDriver({ beforeAnswerWrite: hooks.beforeAnswerWrite, businessOpen: hooks.isBusinessOpen,
      ...(hooks.acpPolicyHost ? { policyHost: hooks.acpPolicyHost } : hooks.ownedRuntime ? { policyHost: createDshAcpPolicyHost({ runtime: hooks.ownedRuntime }) } : {}) })
    default: throw new TypeError(`Unregistered native Driver: ${id}`)
  }
}
