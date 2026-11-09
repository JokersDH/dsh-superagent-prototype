import { ApplicationConfigurationSchema, CONFIGURATION_PROTOCOL } from '@personal-agent/contracts'
import type { ApplicationConfiguration, Criterion, ExecutionProfileView, Scope } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/storage'
import { scopeWithin } from '@personal-agent/questions'

type Project = {
  id: string
  displayName?: string
  scope: Scope
  defaultScope?: Scope
  defaultCriteria: readonly Criterion[]
  profileIds?: readonly string[]
}
type Profile = Omit<ExecutionProfileView, 'dispatchAllowed' | 'blockedReason'> & {
  blockedReason?: ExecutionProfileView['blockedReason']
}
export interface ConfigurationSource {
  projects: readonly Project[]
  profiles: readonly Profile[]
  checks: ApplicationConfiguration['checks']
  enabledProfileIds: readonly string[]
}

/** The runtime supplies the actual admission list; a probe result alone never grants dispatch. */
export function applicationConfiguration(source: ConfigurationSource, now = Date.now()): ApplicationConfiguration {
  const admitted = new Set(source.enabledProfileIds)
  if (
    admitted.size !== source.enabledProfileIds.length ||
    [...admitted].some((id) => !source.profiles.some((profile) => profile.id === id))
  )
    throw new Error('Runtime admission must name unique configured profiles')
  const profiles = source.profiles.map((profile) => {
    const { blockedReason, ...publicProfile } = profile
    const dispatchAllowed = admitted.has(profile.id)
    return {
      ...publicProfile,
      dispatchAllowed,
      ...(dispatchAllowed ? {} : { blockedReason: blockedReason ?? ('unsupported_capability' as const) }),
    }
  })
  const enabledIds = profiles.filter((profile) => profile.dispatchAllowed).map((profile) => profile.id)
  const projects = source.projects.map((project) => {
    const scope = project.defaultScope ?? project.scope
    if (project.id !== project.scope.projectId || !scopeWithin(scope, project.scope))
      throw new Error('Published project defaults exceed the configured grant')
    const expired = [scope.expiresAt, project.scope.expiresAt].some((value) => value && Date.parse(value) <= now)
    const projectProfiles = project.profileIds
      ? enabledIds.filter((id) => project.profileIds!.includes(id))
      : enabledIds
    const dispatchAllowed = !expired && projectProfiles.length > 0
    return {
      id: project.id,
      displayName: project.displayName ?? project.id,
      scope,
      defaultCriteria: project.defaultCriteria,
      profileIds: projectProfiles,
      dispatchAllowed,
      ...(dispatchAllowed
        ? { defaultProfileId: projectProfiles[0] }
        : { blockedReason: expired ? ('stale_contract' as const) : ('unsupported_capability' as const) }),
    }
  })
  const body = { protocol: CONFIGURATION_PROTOCOL, projects, profiles, checks: source.checks }
  return ApplicationConfigurationSchema.parse({ ...body, revision: canonicalDigest(JSON.parse(JSON.stringify(body))) })
}
