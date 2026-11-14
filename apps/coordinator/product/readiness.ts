import { ApplicationConfigurationSchema, AssistantProviderStatusSchema, TrialReadinessSchema } from '@personal-agent/contracts'
import type { ApplicationConfiguration, AssistantProviderStatus, TrialReadiness } from '@personal-agent/contracts'

/** No project names, paths, provider endpoint, account or credential material enters this projection. */
export function projectTrialReadiness(configuration: ApplicationConfiguration, provider: AssistantProviderStatus | undefined,
  observation: { mode: TrialReadiness['mode']; startupMode: TrialReadiness['startupMode']; observedAt: string }): TrialReadiness {
  const config = ApplicationConfigurationSchema.parse(configuration)
  const assistant = provider === undefined ? undefined : AssistantProviderStatusSchema.parse(provider)
  const readonly = observation.startupMode === 'recovery_readonly'
  const native = config.profiles.filter(profile => profile.kind === 'native'), controlled = config.profiles.filter(profile => profile.kind === 'controlled_fixture')
  const admittedNative = readonly ? 0 : native.filter(profile => profile.dispatchAllowed).length
  const admittedControlled = readonly ? 0 : controlled.filter(profile => profile.dispatchAllowed).length
  const projects = config.projects.filter(project => !project.discussionOnly)
  const dispatchable = readonly ? 0 : projects.filter(project => project.dispatchAllowed).length
  const nativeProject = projects.some(project => project.dispatchAllowed && native.some(profile => profile.id === project.defaultProfileId && profile.dispatchAllowed))
  const execution = readonly ? { state: 'unavailable' as const, reason: 'recovery_readonly' as const } : config.executionAvailability ?? { state: 'unknown' as const }
  const development = readonly ? 'readonly' : observation.mode === 'fixture' || (execution.state === 'available' && execution.kind === 'controlled_fixture')
    ? 'fixture_only' : execution.state === 'unknown' ? 'unknown' : execution.state === 'unavailable' ? 'blocked'
      : admittedNative && nativeProject ? 'configuration_present' : 'needs_project'
  const discussion = !assistant ? 'unknown' : assistant.state === 'error' ? 'provider_error'
    : assistant.configured && assistant.model?.trim() && assistant.state !== 'not_configured' ? 'configuration_present' : 'not_configured'
  return TrialReadinessSchema.parse({ protocol: 'trial-readiness/1', ...observation, configurationRevision: config.revision,
    discussion, execution, development, projects: { development: projects.length, discussion: config.projects.length - projects.length, dispatchable },
    profiles: { native: native.length, controlled: controlled.length, admittedNative, admittedControlled },
    capabilities: { contextHistory: config.contextHistoryAvailable === true, contextSources: config.contextSourcesAvailable === true,
      decisions: !readonly && config.decisionsAvailable === true, proposals: !readonly && config.proposalsAvailable === true }, authorization: 'none' })
}
