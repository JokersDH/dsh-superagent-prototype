/**
 * Trusted Runner factory for the two reviewed real Driver implementations.
 *
 * Selection is an explicit, registered Driver id from the attempt's immutable profile/runtime
 * composition; there is no HTTP/profile/environment arbitrary factory selection and no fixture
 * fallback for an unknown id. Fixtures remain available only through the existing test scenarios.
 */
import type { AgentDriverV1 } from '../../../packages/contracts/src/ports.ts'
import type { RunnerCommand } from '../../../packages/contracts/src/types.ts'
import { CodexProductDriver } from '../../../packages/drivers/codex-native/src/native.ts'
import { AcpDriver } from '../../../packages/drivers/acp-v1/src/index.ts'

export const REAL_DRIVER_IDS = ['codex-native', 'acp-v1'] as const
export type RealDriverId = typeof REAL_DRIVER_IDS[number]

export function isRealDriverId(value: string): value is RealDriverId {
  return (REAL_DRIVER_IDS as readonly string[]).includes(value)
}

export function createRealDriver(id: RealDriverId, hooks: { beforeAnswerWrite: (command: RunnerCommand) => Promise<void> }): AgentDriverV1 {
  // Both real Drivers receive only the original AttemptIO from the Runner; they never receive a
  // Store, credential or second lifecycle. `beforeAnswerWrite` is the Runner's injected fresh guard.
  return id === 'codex-native'
    ? new CodexProductDriver({ beforeAnswerWrite: hooks.beforeAnswerWrite })
    : new AcpDriver({ beforeAnswerWrite: hooks.beforeAnswerWrite })
}
