/**
 * Case definitions for the native MVP acceptance.
 *
 * Every case states what it proves and which failure it would catch. A case that cannot run because
 * the product has not published the prerequisite is `NOT_TESTED` — never `PASS`, and never satisfied
 * by substituting a `profile-fixture-*` profile for a native one.
 */
import { ApiClient, CaseLog, STATUS } from './harness.mjs'

/** The profile the product must publish before a native delegation is possible. */
export const NATIVE_PROFILE_ID = 'profile-codex-native'

/** Fixture profiles must never be used to satisfy a native case. */
export const FIXTURE_PROFILE_PATTERN = /^profile-fixture-/

export function isFixtureProfile(id) {
  return FIXTURE_PROFILE_PATTERN.test(id)
}

/**
 * Read the published configuration. This is the **only** legitimate source of projects, profiles,
 * scopes and checks: hard-coding them would make a fixture pass look like native evidence.
 */
export async function readConfiguration(client) {
  const response = await client.request('GET', '/v1/configuration')
  return {
    status: response.status,
    json: response.json,
    elapsedMs: response.elapsedMs,
    cacheControl: response.headers['cache-control'],
  }
}

/** Select the native profile from the configuration, or explain why there is none. */
export function selectNativeProfile(configuration) {
  if (!configuration || typeof configuration !== 'object') {
    return { available: false, reason: 'configuration response was not an object' }
  }
  const profiles = Array.isArray(configuration.profiles) ? configuration.profiles : []
  const native = profiles.filter(profile => profile && profile.kind === 'native')
  if (native.length === 0) {
    return {
      available: false,
      reason: 'the published configuration exposes no native profile',
      publishedProfiles: profiles.map(profile => ({ id: profile.id, kind: profile.kind, readiness: profile.readiness })),
    }
  }
  const admitted = native.filter(profile => profile.dispatchAllowed === true)
  if (admitted.length === 0) {
    return {
      available: false,
      reason: 'native profiles are published but none is admitted for dispatch',
      native: native.map(profile => ({ id: profile.id, readiness: profile.readiness, blockedReason: profile.blockedReason })),
    }
  }
  const preferred = admitted.find(profile => profile.id === NATIVE_PROFILE_ID) ?? admitted[0]
  return { available: true, profile: preferred, native: native.map(profile => profile.id) }
}

/** Build a create_work command from the published configuration, not from constants. */
export function buildCreateWork(configuration, profile, requirement) {
  const project = Array.isArray(configuration.projects) ? configuration.projects[0] : undefined
  if (!project) return undefined
  const criteria = Array.isArray(project.defaultCriteria) ? project.defaultCriteria : []
  const machine = criteria.filter(criterion => criterion.kind === 'machine')
  return {
    kind: 'create_work',
    workId: `work-accept-${Date.now()}`,
    projectId: project.id,
    profileId: profile.id,
    scope: project.scope,
    criteria: machine,
    text: requirement,
  }
}

// --- read-only lane ----------------------------------------------------------

export async function runReadOnlyCases({ client, log, options }) {
  log.begin('CONFIG-READ', 'GET /v1/configuration is available and never cached', 'read-only')
  const configuration = await readConfiguration(client)
  if (configuration.status === 200 && configuration.json) {
    log.evidence({ status: configuration.status, revision: configuration.json.revision, cacheControl: configuration.cacheControl })
    // A configuration that could be stale would let the console build a command the backend refuses.
    if (String(configuration.cacheControl ?? '').includes('no-store')) log.pass('authenticated read with no-store')
    else log.fail(`configuration is cacheable: cache-control=${configuration.cacheControl}`)
  } else {
    log.fail(`GET /v1/configuration returned ${configuration.status}`)
  }

  log.begin('CONFIG-NATIVE-ADMISSION', 'the configuration states exactly which profiles may dispatch', 'read-only')
  const selection = selectNativeProfile(configuration.json)
  log.evidence(selection.available ? { profile: selection.profile } : { native: selection.native ?? [], publishedProfiles: selection.publishedProfiles })
  if (selection.available) {
    log.pass(`native profile ${selection.profile.id} is admitted (readiness ${selection.profile.readiness})`)
  } else {
    // This is the honest outcome: the product has not published an admitted native profile yet.
    log.notTested(selection.reason)
  }

  log.begin('CONFIG-NO-RAW-IDENTITY', 'the configuration never exposes executable/argv/native config', 'read-only')
  const serialized = JSON.stringify(configuration.json ?? {})
  const leaked = ['executable', 'argv', 'nativeConfigRef', 'permissionPolicyRevision'].filter(field => serialized.includes(field))
  if (leaked.length === 0) log.pass('no backend-only identity fields in the response')
  else log.fail(`configuration leaks ${leaked.join(', ')}`)

  log.begin('CONFIG-FIXTURE-NOT-NATIVE', 'fixture profiles are never presented as tested vendors', 'read-only')
  const profiles = Array.isArray(configuration.json?.profiles) ? configuration.json.profiles : []
  const bad = profiles.filter(profile => isFixtureProfile(profile.id) && profile.kind === 'native')
  if (bad.length === 0) log.pass(`${profiles.filter(profile => isFixtureProfile(profile.id)).length} fixture profile(s) are declared controlled_fixture`)
  else log.fail(`${bad.length} fixture profile(s) claim kind=native`)

  return { configuration: configuration.json, selection }
}

// --- native lane -------------------------------------------------------------

/**
 * Native lane entry.
 *
 * It runs only when the product publishes an admitted native profile. Otherwise every native case is
 * NOT_TESTED with the precise reason, and the report says the lane did not execute.
 */
export async function runNativeCases({ client, log, options, selection }) {
  const cases = [
    ['NATIVE-LINK', 'delegate to the real Codex on a private scratch project and reach a verified candidate'],
    ['NATIVE-STOP', 'stop ends the actual process tree, not merely the native ACK'],
    ['NATIVE-REOPEN', 'browser/reopen does not resend begin and the executor is preserved'],
    ['NATIVE-RESTART', 'coordinator restart does not start a second physical writer'],
    ['NATIVE-STALE-CANDIDATE', 'a modified current candidate cannot be accepted'],
    ['NATIVE-CHECK-FAIL', 'a required machine FAIL cannot be bypassed by human acceptance'],
    ['NATIVE-QUESTION', 'a real question is answered per request/attempt/epoch/contract'],
  ]

  if (!options.runNative) {
    for (const [id, title] of cases) {
      log.begin(id, title, 'native')
      log.notTested('native lane was not requested (pass --run-native)')
    }
    return { executed: false, reason: 'lane not requested' }
  }

  if (!selection.available) {
    for (const [id, title] of cases) {
      log.begin(id, title, 'native')
      log.notTested(`the product published no admitted native profile: ${selection.reason}`)
    }
    return { executed: false, reason: selection.reason }
  }

  // The product boundary for native execution is not published yet. Refuse rather than substitute a
  // fixture profile, which would make a fixture run look like native evidence.
  for (const [id, title] of cases) {
    log.begin(id, title, 'native')
    log.notTested('native execution boundary is not published by the product yet (no /v1/projects or native dispatch entry)')
  }
  return { executed: false, reason: 'native execution boundary unavailable' }
}

void ApiClient
void STATUS
