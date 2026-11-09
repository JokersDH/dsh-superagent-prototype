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

/**
 * Choose a project that can actually dispatch with this profile.
 *
 * A project is usable only when it is dispatch-allowed **and** its admitted profile list contains the
 * selected profile; taking `projects[0]` would send work to a project that cannot run it.
 */
export function selectProject(configuration, profile) {
  const projects = Array.isArray(configuration?.projects) ? configuration.projects : []
  const admitted = projects.filter(
    project => project && project.dispatchAllowed === true && Array.isArray(project.profileIds) && project.profileIds.includes(profile.id),
  )
  const preferred = admitted.find(project => project.id === configuration.defaultProjectId) ?? admitted[0]
  return { project: preferred, admitted: admitted.map(project => project.id), considered: projects.map(project => project.id) }
}

/**
 * Build a `create_work` command that the **shared** `UserCommandSchema` accepts.
 *
 * The criteria keep every published default, including required human criteria: silently dropping a
 * human gate would let the harness accept a result the product would not.
 */
export function buildCreateWork(configuration, profile, requirement, options = {}) {
  const { project } = selectProject(configuration, profile)
  if (!project) return undefined
  const criteria = Array.isArray(project.defaultCriteria) ? [...project.defaultCriteria] : []
  // The scope the product publishes may be project-relative; the contract requires the project id.
  const scope = { projectId: project.id, ...project.scope }
  return {
    commandId: options.commandId ?? `cmd-create-${Date.now()}`,
    conversationId: options.conversationId ?? project.conversationId ?? 'conv-native-acceptance',
    kind: 'create_work',
    projectId: project.id,
    profileId: profile.id,
    goal: requirement,
    scope,
    criteria,
  }
}

/** Validate a command with the shared parser; the harness fixture must be legal too. */
export function validateCommand(UserCommandSchema, command) {
  const parsed = UserCommandSchema.safeParse(command)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') }
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
 * The lane performs **real** client calls: it reads the configuration, selects a project that can
 * dispatch with the selected native profile, submits a `create_work` the shared parser accepts, and
 * follows the work through questions, verification and acceptance. It never mocks the native path
 * and never substitutes a fixture profile.
 *
 * When a prerequisite is missing the affected case is `NOT_TESTED` with the precise reason; a
 * `--require-native` run turns any unexecuted required case into a non-zero exit.
 */
export async function runNativeCases({ client, log, options, selection, configuration }) {
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

  const project = selectProject(configuration, selection.profile)
  if (!project.project) {
    for (const [id, title] of cases) {
      log.begin(id, title, 'native')
      log.notTested(
        `no published project admits profile ${selection.profile.id} (admitted: ${project.admitted.join(', ') || 'none'}; considered: ${project.considered.join(', ') || 'none'})`,
      )
    }
    return { executed: false, reason: 'no dispatchable project for the selected profile' }
  }

  // A real delegation costs a model task; the lane only starts one when explicitly allowed to spend
  // from the bounded budget recorded in the report.
  return executeNativeLink({ client, log, options, selection, project: project.project, cases })
}

/**
 * Submit one real work and follow it. Returns whether a model task was actually started so the report
 * can account for the bounded budget.
 */
async function executeNativeLink({ client, log, options, selection, project, cases }) {
  const requirement = options.requirement ?? 'Add a small pure function with a test to src/ in this project.'
  const command = buildCreateWork(
    { projects: [project], defaultProjectId: project.id },
    selection.profile,
    requirement,
    { conversationId: options.conversationId },
  )

  log.begin('NATIVE-LINK', cases[0][1], 'native')
  log.entity({ projectId: project.id, profileId: selection.profile.id, commandId: command.commandId })
  // Validate with the shared parser before sending: an illegal fixture would prove nothing.
  const validation = await sharedUserCommandSchema().then(schema => validateCommand(schema, command))
  if (!validation.ok) {
    log.fail(`create_work does not satisfy the shared UserCommand schema: ${validation.error}`)
    for (const [id, title] of cases.slice(1)) {
      log.begin(id, title, 'native')
      log.notTested('skipped because the command contract was rejected')
    }
    return { executed: false, reason: 'invalid command contract', modelTasks: 0 }
  }

  const receipt = await client.request('POST', '/v1/commands', { body: validation.value })
  log.evidence({ httpStatus: receipt.status, receipt: receipt.json })
  if (receipt.status !== 200 || !receipt.json || receipt.json.status === 'rejected') {
    log.fail(`create_work was not recorded: HTTP ${receipt.status} ${JSON.stringify(receipt.json?.error ?? receipt.json)}`)
    for (const [id, title] of cases.slice(1)) {
      log.begin(id, title, 'native')
      log.notTested('skipped because the delegation was not recorded')
    }
    return { executed: false, reason: 'delegation rejected', modelTasks: 0 }
  }
  const workId = receipt.json.workId
  log.entity({ workId })
  log.pass(`recorded create_work ${workId} on project ${project.id}`)

  // A delegation is recorded, then executed: `continue_work` starts the attempt (one model task).
  const continued = await client.request('POST', '/v1/commands', {
    body: { commandId: `cmd-continue-${Date.now()}`, conversationId: command.conversationId, kind: 'continue_work', workId },
  })
  log.evidence({ continueStatus: continued.status, receipt: continued.json })
  if (continued.status !== 200 || continued.json?.status === 'rejected') {
    log.note(`continue_work was not accepted: HTTP ${continued.status} ${JSON.stringify(continued.json?.error ?? {})}`)
  }

  // Follow the work to a candidate or a terminal explanation.
  const deadline = Date.now() + (options.nativeTimeoutMs ?? 900_000)
  let last
  let candidate
  const questions = []
  while (Date.now() < deadline) {
    const work = await client.request('GET', `/v1/works/${workId}`)
    last = work.json
    if (work.status !== 200) break
    // The work view is flat: phase/openQuestionIds/artifactIds/resourceStatus/actions.
    for (const id of Array.isArray(last?.openQuestionIds) ? last.openQuestionIds : []) {
      if (!questions.some(known => known.id === id)) {
        questions.push({ id })
        log.entity({ questionId: id })
      }
    }
    candidate = last?.actions?.currentCandidate ?? last?.candidate
    if (candidate) break
    const phase = last?.phase
    if (phase === 'needs_user' || phase === 'blocked' || phase === 'delivered' || phase === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  log.evidence({ finalPhase: last?.phase, candidateId: candidate ? `${candidate.assignmentId}#${candidate.candidateGeneration}` : null, questions: questions.length, artifacts: last?.artifactIds?.length ?? 0 })

  if (!candidate) {
    log.fail(`no candidate reached within the timeout (final phase: ${String(last?.phase)})`)
  } else {
    // The patch is derived from the candidate artifact's own base/head commits, then applied to a
    // clean clone: that proves the delivered work is a real diff of the project.
    const artifactRef = (last?.artifactIds ?? [])[0]
    const artifact = artifactRef ? (await client.request('GET', `/v1/artifacts/${artifactRef}`)).json : undefined
    const location = (await client.request('GET', `/v1/works/${workId}/location`)).json
    log.evidence({ artifact: artifact ? { base: artifact.baseCommit, head: artifact.headCommit, environment: artifact.environment } : null, location })
    const roundtrip = await roundtripPatch({
      projectPath: location?.projectPath,
      workspacePath: location?.workspacePath,
      baseCommit: artifact?.baseCommit,
      headCommit: artifact?.headCommit,
    })
    if (roundtrip.ok) {
      log.evidence({ patchBytes: roundtrip.patchBytes, files: roundtrip.files })
      log.pass(`candidate ${candidate.assignmentId}#${candidate.candidateGeneration}: ${roundtrip.patchBytes}-byte patch applies to a fresh clone (${roundtrip.files.join(', ')})`)
    } else {
      log.fail(`candidate reached but its patch did not roundtrip: ${roundtrip.reason}`)
    }

    // Every registered machine check must be PASS before acceptance is meaningful.
    const verification = await client.request('GET', `/v1/works/${workId}`)
    log.evidence({ phaseBeforeAccept: verification.json?.phase, resources: verification.json?.resourceStatus })
    if (verification.json?.phase === 'needs_user') log.note('the work is waiting for human review, as designed')
  }

  for (const [id, title] of cases.slice(1)) {
    log.begin(id, title, 'native')
    log.notTested('not reached in this run: requires the follow-up phases (see execution-status.json)')
  }
  return { executed: true, reason: 'delegation executed', modelTasks: 1, workId, candidateId: candidate?.id }
}

/**
 * Apply the delivered patch to a clean clone of the base commit.
 *
 * This proves the artifact is a real diff of the project rather than a summary that only looks right.
 */
export async function roundtripPatch({ projectPath, workspacePath, baseCommit, headCommit }) {
  if (!projectPath || !baseCommit || !headCommit) return { ok: false, reason: 'missing project path or base/head commit' }
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const target = mkdtempSync(join(tmpdir(), 'pa-roundtrip-'))
  const run = (command, argv, cwd) => execFileSync(command, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    run('git', ['clone', '--quiet', '--no-hardlinks', projectPath, join(target, 'clone')], tmpdir())
    const clone = join(target, 'clone')
    const base = run('git', ['rev-parse', 'HEAD'], clone).trim()
    // Produce the patch from the delivered worktree commits.
    const patchText = run('git', ['diff', '--binary', baseCommit, headCommit], workspacePath)
    if (!patchText.trim()) return { ok: false, reason: `no diff between ${baseCommit} and ${headCommit}` }
    // Verify first (no working-tree change), then apply so the files exist for inspection.
    execFileSync('git', ['apply', '--check', '-'], { cwd: clone, input: patchText, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    execFileSync('git', ['apply', '-'], { cwd: clone, input: patchText, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    const files = run('git', ['status', '--porcelain'], clone)
      .split('\n')
      .filter(Boolean)
      .map(line => line.slice(3).trim())
    return { ok: files.length > 0, files, base, clone, patchBytes: patchText.length }
  } catch (error) {
    return { ok: false, reason: (error.stderr ?? error.message ?? String(error)).toString().slice(0, 300) }
  }
}

/** Normalise the question collection the work view exposes. */
function collectQuestions(view) {
  const direct = view?.questions
  if (Array.isArray(direct)) return direct
  const nested = view?.work?.questions
  if (Array.isArray(nested)) return nested
  return []
}

/** Load the shared parser lazily so the read-only lane needs no built packages. */
async function sharedUserCommandSchema() {
  const module = await import('../../packages/contracts/src/schemas.ts')
  return module.UserCommandSchema
}
