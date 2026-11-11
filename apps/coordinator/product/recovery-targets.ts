import { JsonSchema, RecoveryTargetPreparationSchema } from '@personal-agent/contracts'
import type { RecoveryActivationCommit, RecoveryTargetConfiguration, RecoveryTargetPreparation } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ApplicationFault } from '@personal-agent/application'

/** Bind inert target inputs before any filesystem work. Actual source and resource authority stay with main. */
export function bindRecoveryTargetConfiguration(source: RecoveryActivationCommit, configuration: RecoveryTargetConfiguration): RecoveryTargetPreparation {
  const input = RecoveryTargetPreparationSchema.parse({ protocol: 'recovery-target-preparation/1', source, configuration, startupAvailable: false })
  if (canonicalDigest(JsonSchema.parse(input.configuration)) !== input.source.intent.target.configurationDigest)
    throw new ApplicationFault('conflict', 'Target configuration differs from the confirmed recovery intent')
  return input
}
