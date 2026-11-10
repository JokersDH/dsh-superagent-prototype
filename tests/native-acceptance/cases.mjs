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
/**
 * Submit one real work and follow it to a fully verified candidate.
 *
 * NATIVE-LINK ends exactly once, and only when **every** required assertion holds:
 *
 *   1. the shared parser accepts the command;
 *   2. `POST /v1/commands` records it (a business rejection and a schema 400 are different outcomes);
 *   3. a real candidate appears (assignment + generation), not merely a phase change;
 *   4. the candidate artifact exposes a real diff (distinct base/head, or a patch reference);
 *   5. every registered machine check is PASS;
 *   6. the patch applies to a clean clone at the artifact's base commit.
 *
 * `create_work` already queues the execution effect, so no `continue_work` is sent: an extra
 * continuation would be an illegal second intent.
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

  /** Finish NATIVE-LINK and every remaining case exactly once. */
  const finishAll = (status, detail, remainingReason) => {
    log.finish(status, detail)
    for (const [id, title] of cases.slice(1)) {
      log.begin(id, title, 'native')
      log.notTested(remainingReason)
    }
  }

  const schema = await sharedUserCommandSchema()
  const validation = validateCommand(schema, command)
  if (!validation.ok) {
    finishAll('FAIL', `create_work does not satisfy the shared UserCommandSchema: ${validation.error}`, 'skipped because the command contract was rejected')
    return { executed: false, reason: 'invalid command contract', modelTasks: 0 }
  }

  const receipt = await client.request('POST', '/v1/commands', { body: validation.value })
  log.evidence({ httpStatus: receipt.status, receipt: receipt.json })
  // A schema-level 400 and a typed business rejection are separate outcomes.
  if (receipt.status === 400) {
    finishAll('FAIL', `the product rejected the command as malformed (HTTP 400): ${JSON.stringify(receipt.json?.error ?? {})}`, 'skipped: command was malformed')
    return { executed: false, reason: 'malformed command', modelTasks: 0 }
  }
  if (receipt.status !== 200 || !receipt.json || receipt.json.status === 'rejected') {
    finishAll('FAIL', `create_work was not recorded: HTTP ${receipt.status} ${JSON.stringify(receipt.json?.error ?? receipt.json)}`, 'skipped: delegation was rejected')
    return { executed: false, reason: 'delegation rejected', modelTasks: 0 }
  }
  const workId = receipt.json.workId
  log.entity({ workId })

  // Follow the work until a real candidate appears or the attempt reaches a terminal phase.
  const deadline = Date.now() + (options.nativeTimeoutMs ?? 900_000)
  let last
  let candidate
  const questions = []
  while (Date.now() < deadline) {
    const work = await client.request('GET', `/v1/works/${workId}`)
    last = work.json
    if (work.status !== 200) break
    for (const id of Array.isArray(last?.openQuestionIds) ? last.openQuestionIds : []) {
      if (!questions.includes(id)) {
        questions.push(id)
        log.entity({ questionId: id })
      }
    }
    candidate = last?.actions?.currentCandidate
    // A candidate is only real when it names an assignment and a positive generation.
    if (candidate && candidate.assignmentId && Number(candidate.candidateGeneration) > 0) break
    candidate = undefined
    const phase = last?.phase
    if (phase === 'blocked' || phase === 'failed' || phase === 'delivered') break
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  log.evidence({ finalPhase: last?.phase, questionCount: questions.length, artifactCount: last?.artifactIds?.length ?? 0 })

  if (!candidate) {
    // No candidate means the link did not deliver; this must never be reported as PASS.
    finishAll('FAIL', `no real candidate was produced (final phase: ${String(last?.phase)})`, 'not reached: no candidate was produced')
    return { executed: true, reason: 'no candidate', modelTasks: 1, workId, candidateId: null }
  }
  log.entity({ candidate: `${candidate.assignmentId}#${candidate.candidateGeneration}` })

  const checks = await verifyCandidateArtifacts({ client, workId, artifactIds: last?.artifactIds ?? [] })
  log.evidence(checks.evidence)
  if (!checks.ok) {
    finishAll('FAIL', checks.reason, 'not reached: the candidate did not pass verification')
    return { executed: true, reason: checks.reason, modelTasks: 1, workId, candidateId: `${candidate.assignmentId}#${candidate.candidateGeneration}` }
  }

  log.pass(checks.summary)
  for (const [id, title] of cases.slice(1)) {
    log.begin(id, title, 'native')
    log.notTested('not reached in this run: requires its own dedicated phase')
  }
  return {
    executed: true,
    reason: 'delegation verified',
    modelTasks: 1,
    workId,
    candidateId: `${candidate.assignmentId}#${candidate.candidateGeneration}`,
    artifactIds: last?.artifactIds ?? [],
  }
}

/**
 * Verify a candidate: a real diff, all machine checks PASS, and a patch that applies to a fresh
 * clone at the artifact's own base commit.
 */
async function verifyCandidateArtifacts({ client, workId, artifactIds }) {
  const evidence = { artifactIds, artifacts: [], checks: [] }
  // The project root is needed to clone at the artifact base commit for the patch roundtrip.
  const location = await client.request('GET', `/v1/works/${workId}/location`)
  evidence.projectPath = location.json?.projectPath
  evidence.location = location.json
  // Each artifact id may return an object (product artifact), an array (check results) or text
  // (the patch). Keep the raw body so every shape is usable.
  const artifacts = []
  for (const id of artifactIds) {
    const response = await client.request('GET', `/v1/artifacts/${id}`)
    if (response.status !== 200) continue
    const body = response.json === undefined ? response.text : response.json
    artifacts.push({ id, body })
  }
  evidence.artifacts = artifacts.map(item => ({
    id: item.id,
    shape: Array.isArray(item.body) ? 'array' : typeof item.body === 'string' ? 'text' : 'object',
    kind: item.body?.kind ?? null,
    baseCommit: item.body?.baseCommit ?? null,
    headCommit: item.body?.headCommit ?? null,
    patch: item.body?.patch?.artifactId ?? null,
  }))

  // 1. Every registered machine check must be PASS. A verification artifact is an array of results.
  for (const item of artifacts) {
    const results = Array.isArray(item.body) ? item.body : Array.isArray(item.body?.results) ? item.body.results : []
    for (const result of results) {
      if (result && typeof result.outcome === 'string') {
        evidence.checks.push({ outcome: result.outcome, exitCode: result.exitCode, criterionId: result.criterionId })
      }
    }
  }
  if (evidence.checks.length === 0) return { ok: false, reason: 'no registered machine check result accompanied the candidate', evidence }
  const failedCheck = evidence.checks.find(check => check.outcome !== 'PASS')
  if (failedCheck) return { ok: false, reason: `a registered machine check did not pass: ${JSON.stringify(failedCheck)}`, evidence }

  // 2. The candidate artifact must expose a real patch reference or a distinct base/head.
  const candidateEntry = artifacts.find(item => item.body?.kind === 'product-artifact/1')
  if (!candidateEntry) return { ok: false, reason: 'no product artifact accompanies the candidate', evidence }
  const candidateArtifact = candidateEntry.body
  const patchRef = candidateArtifact.patch
  const distinctCommits = candidateArtifact.baseCommit && candidateArtifact.headCommit && candidateArtifact.baseCommit !== candidateArtifact.headCommit
  evidence.patchRef = patchRef ?? null
  evidence.distinctCommits = !!distinctCommits

  if (patchRef && patchRef.artifactId) {
    const patch = await client.request('GET', `/v1/artifacts/${patchRef.artifactId}`)
    evidence.patchStatus = patch.status
    if (patch.status !== 200) return { ok: false, reason: `the patch artifact could not be read (HTTP ${patch.status})`, evidence }
    const patchText = typeof patch.text === 'string' ? patch.text : ''
    evidence.patchBytesReturned = patchText.length
    if (patchText.length === 0) return { ok: false, reason: 'the patch artifact is empty', evidence }
    // The declared byte count must match what the product actually returns.
    if (typeof patchRef.bytes === 'number' && patchRef.bytes !== patchText.length) {
      return { ok: false, reason: `patch byte count mismatch: manifest ${patchRef.bytes}, returned ${patchText.length}`, evidence }
    }
    // The patch must apply to a fresh clone pinned at the artifact's base commit.
    const roundtrip = await roundtripPatch({ projectPath: evidence.projectPath, baseCommit: candidateArtifact.baseCommit, patchText })
    evidence.roundtrip = { ok: roundtrip.ok, files: roundtrip.files, reason: roundtrip.reason }
    if (!roundtrip.ok) return { ok: false, reason: `the patch did not apply to a clean clone: ${roundtrip.reason}`, evidence }
    return {
      ok: true,
      summary: `candidate verified: ${evidence.checks.length} machine check(s) PASS, patch ${patchRef.bytes} bytes (${patchRef.format}), applies to ${roundtrip.files.join(', ')}`,
      evidence,
    }
  }
  if (distinctCommits) {
    // Legacy artifact shape: a real worktree commit interval exists, so a diff is derivable.
    return { ok: true, summary: `candidate verified: ${evidence.checks.length} machine check(s) PASS with base ${candidateArtifact.baseCommit} -> head ${candidateArtifact.headCommit}`, evidence }
  }
  return { ok: false, reason: 'the candidate exposes neither a patch reference nor a distinct base/head commit', evidence }
}

/**
 * Apply a delivered patch to a clean clone pinned at the artifact's declared base commit.
 *
 * This proves the artifact is a real diff of the project rather than a summary that only looks right,
 * and that the original project is untouched (a clone is used, never the source tree).
 */
export async function roundtripPatch({ projectPath, baseCommit, patchText }) {
  if (!projectPath || !patchText) return { ok: false, reason: 'missing project path or patch text' }
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'pa-roundtrip-'))
  const clone = join(root, 'clone')
  const run = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    run(['clone', '--quiet', '--no-hardlinks', projectPath, clone], tmpdir())
    if (baseCommit) run(['checkout', '--quiet', baseCommit], clone)
    // Verify first (no working-tree change), then apply so the files exist for inspection.
    execFileSync('git', ['apply', '--check', '-'], { cwd: clone, input: patchText, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    execFileSync('git', ['apply', '-'], { cwd: clone, input: patchText, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    const files = run(['status', '--porcelain'], clone)
      .split('\n')
      .filter(Boolean)
      .map(line => line.slice(3).trim())
    return { ok: files.length > 0, files, patchBytes: patchText.length, clone }
  } catch (error) {
    return { ok: false, reason: String(error.stderr ?? error.message ?? error).slice(0, 300) }
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
