import { STATUS, LAYERS } from './status.mjs'
import { isFresh } from './evidence.mjs'

export const REPORT_SCHEMA = 'product-acceptance/1'
export const RELEASE_SCHEMA = 'product-acceptance-release/1'

const HEX = /^[a-f0-9]{64}$/
const COMMIT = /^[0-9a-f]{7,64}$/
const KNOWN_LAYERS = new Set(Object.values(LAYERS))

const fail = (code, detail, caseId) => ({ code, detail, ...(caseId ? { caseId } : {}) })

/** An evidence reference must carry content: `{}`, `[]` and `''` are not evidence. */
export function isSubstantive(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length > 0 && value.some(isSubstantive)
  if (typeof value === 'object') return Object.values(value).some(isSubstantive)
  return false
}

function evidenceIssues(caseResult, keys) {
  const evidence = caseResult.evidence ?? {}
  return keys.filter((key) => !isSubstantive(evidence[key]))
}

/**
 * Patch evidence is only accepted when the downloaded bytes are digested, the recorded and verified
 * digests agree, a positive byte count exists and the patch actually applied at a baseline commit.
 */
export function patchIssues(patch) {
  if (!patch || typeof patch !== 'object') return ['missing']
  const issues = []
  if (!HEX.test(String(patch.sha256 ?? '')) || !HEX.test(String(patch.verifiedSha256 ?? '')))
    issues.push('digest_malformed')
  else if (patch.sha256 !== patch.verifiedSha256) issues.push('digest_mismatch')
  if (!Number.isSafeInteger(patch.bytes) || patch.bytes <= 0) issues.push('bytes_missing')
  if (patch.format !== undefined && !['git-patch', 'unified-diff'].includes(patch.format))
    issues.push('format_unknown')
  if (patch.apply?.ok !== true) issues.push('not_applied')
  if (!COMMIT.test(String(patch.apply?.targetCommit ?? ''))) issues.push('target_commit_missing')
  if (!isSubstantive(patch.apply?.projectPath)) issues.push('baseline_path_missing')
  return issues
}

export function downloadIssues(download) {
  if (!download || typeof download !== 'object') return ['missing']
  const issues = []
  if (!HEX.test(String(download.sha256 ?? '')) || !HEX.test(String(download.verifiedSha256 ?? '')))
    issues.push('digest_malformed')
  else if (download.sha256 !== download.verifiedSha256) issues.push('digest_mismatch')
  if (!Number.isSafeInteger(download.bytes) || download.bytes <= 0) issues.push('bytes_missing')
  if (!isSubstantive(download.filename)) issues.push('filename_missing')
  return issues
}

/**
 * Native evidence is accepted only when a real vendor agent executed it. A case cannot grant itself
 * this layer: the requirement names `actual-native`, and this proof must be present, complete and
 * bound to the same source commit.
 */
export function nativeIssues(native, sourceCommit) {
  if (!native || typeof native !== 'object') return ['missing']
  const issues = []
  if (native.executed !== true) issues.push('not_executed')
  if (!isSubstantive(native.version)) issues.push('version_missing')
  if (!isSubstantive(native.attemptId) || !isSubstantive(native.commandId)) issues.push('identity_missing')
  if (!Array.isArray(native.evidenceRefs) || native.evidenceRefs.length === 0) issues.push('evidence_refs_missing')
  if (!Number.isSafeInteger(native.modelTasks) || native.modelTasks < 1) issues.push('model_tasks_missing')
  if (native.sourceCommit !== undefined && native.sourceCommit !== sourceCommit) issues.push('source_mismatch')
  return issues
}

/** Installation evidence must come from a staged bundle running outside the development checkout. */
export function installationIssues(installation) {
  if (!installation || typeof installation !== 'object') return ['missing']
  const issues = []
  if (installation.status !== 'installed') issues.push('not_installed')
  if (!isSubstantive(installation.bundleVersion)) issues.push('version_missing')
  if (!HEX.test(String(installation.bundleDigest ?? ''))) issues.push('digest_missing')
  if (!isSubstantive(installation.stagedPath)) issues.push('staged_path_missing')
  if (!Array.isArray(installation.steps) || installation.steps.length === 0) issues.push('steps_missing')
  else if (installation.steps.some((step) => step?.status !== STATUS.PASS)) issues.push('step_not_pass')
  if (installation.originalCheckoutAvailable === true) issues.push('not_independent_of_checkout')
  return issues
}

function cycleIssues(cycles) {
  if (!cycles || typeof cycles !== 'object') return ['missing']
  const issues = []
  if (!Number.isSafeInteger(cycles.completed) || cycles.completed < 1) issues.push('no_cycles')
  if (!Number.isSafeInteger(cycles.attemptCount) || cycles.attemptCount < 1) issues.push('no_attempts')
  if (!Array.isArray(cycles.failures) || cycles.failures.length > 0) issues.push('cycle_failure')
  return issues
}

/**
 * Fail-closed aggregation.
 *
 * A requirement is satisfied only by a case that ran here, passed, carried assertions, bound itself
 * to the same source commit and layer the requirement names, and supplied substantive evidence of
 * the exact kind required. Everything else — absence, unknown status, uncertain acceptance,
 * unverified patch/download, unexecuted native, empty evidence, stale report, mismatched fixture —
 * becomes a named failure. There is no option that turns a declared gap into a release PASS.
 */
export function evaluateRelease({
  report,
  requirement,
  expectedSource,
  now = Date.now(),
  resolveFixture,
  allowAnySource = false,
}) {
  const failures = []
  const requirements = []

  if (!report || typeof report !== 'object') {
    return { ok: false, failures: [fail('report_invalid', 'No report object')], requirements, checkedAt: new Date(now).toISOString() }
  }
  if (report.schema !== REPORT_SCHEMA)
    failures.push(fail('report_schema_invalid', `Expected ${REPORT_SCHEMA}`))
  if (!report.source || !COMMIT.test(String(report.source.commit ?? '')))
    failures.push(fail('report_source_missing', 'Report has no bound source commit'))
  if (requirement?.requireCleanSource === true && report.source?.dirty === true)
    failures.push(fail('source_dirty', 'Release evidence requires a clean source worktree'))
  if (!Array.isArray(report.cases)) {
    failures.push(fail('report_cases_invalid', 'Report has no case list'))
    return { ok: false, failures, requirements, checkedAt: new Date(now).toISOString() }
  }

  const maxAgeMs = requirement?.maxAgeMs ?? 6 * 60 * 60 * 1000
  if (!isFresh(report.checkedAt, now, maxAgeMs))
    failures.push(
      fail('stale_report', `Report checkedAt is older than ${maxAgeMs}ms or unparseable: ${String(report.checkedAt)}`),
    )

  if (expectedSource && !allowAnySource && report.source?.commit !== expectedSource)
    failures.push(
      fail('source_mismatch', `Evidence from ${report.source?.commit} but current source is ${expectedSource}`),
    )

  const allowedLayers = new Set(requirement?.allowedLayers ?? [LAYERS.CONTROLLED, LAYERS.READONLY])
  const requireCaseSource = requirement?.requireCaseSource === true
  const byId = new Map()
  for (const item of report.cases) {
    if (!item || typeof item.id !== 'string') {
      failures.push(fail('case_invalid', 'A case has no string id'))
      continue
    }
    if (byId.has(item.id)) failures.push(fail('duplicate_case_id', `Case ${item.id} appears more than once`, item.id))
    byId.set(item.id, item)
    if (!Object.values(STATUS).includes(item.status))
      failures.push(fail('unknown_status', `Unknown status ${String(item.status)}`, item.id))
    if (!KNOWN_LAYERS.has(item.layer))
      failures.push(fail('unknown_layer', `Unknown evidence layer ${String(item.layer)}`, item.id))
    if (item.layer === LAYERS.NATIVE && item.status === STATUS.PASS && item.evidence?.native?.executed !== true)
      failures.push(
        fail('unexecuted_native', 'A native case cannot PASS unless the vendor agent actually executed', item.id),
      )
    if (item.status === STATUS.PASS && !Array.isArray(item.assertions))
      failures.push(fail('vacuous_pass', 'A PASS case has no assertion list', item.id))
    if (item.status === STATUS.PASS && Array.isArray(item.assertions) && item.assertions.length === 0)
      failures.push(fail('vacuous_pass', 'A PASS case asserted nothing', item.id))
    if (item.status === STATUS.PASS && (item.assertions ?? []).some((assertion) => assertion.ok !== true))
      failures.push(fail('assertion_failed', 'A PASS case contains a failed assertion', item.id))
    // A case cannot change the commit its own evidence belongs to; mixing runs must be visible.
    if (item.source?.commit && item.source.commit !== report.source?.commit)
      failures.push(fail('stale_case_evidence', 'Case evidence binds a different source commit', item.id))

    const acceptance = item.evidence?.acceptance
    if (item.status === STATUS.PASS && acceptance?.uncertain === true)
      failures.push(fail('uncertain_acceptance', 'Acceptance was uncertain and must not be reported as PASS', item.id))
    if (item.status === STATUS.PASS && acceptance?.accepted === true && !isSubstantive(acceptance?.candidateRef))
      failures.push(fail('missing_candidate', 'Acceptance claims a candidate it never recorded', item.id))
    if (item.status === STATUS.PASS && Number(item.evidence?.responses?.invalid ?? 0) > 0)
      failures.push(fail('invalid_response_tolerated', 'A case consumed an unknown/invalid response', item.id))

    if (item.status === STATUS.PASS && item.evidence?.patch) {
      for (const issue of patchIssues(item.evidence.patch)) failures.push(fail('bad_patch', `Patch ${issue}`, item.id))
    }
    if (item.status === STATUS.PASS && item.evidence?.download) {
      for (const issue of downloadIssues(item.evidence.download))
        failures.push(fail('bad_download', `Download ${issue}`, item.id))
    }

    const fixture = item.evidence?.fixture
    if (item.status === STATUS.PASS && fixture && typeof resolveFixture === 'function') {
      let actual
      try {
        actual = resolveFixture(fixture)
      } catch (error) {
        failures.push(fail('fixture_unreadable', String(error?.message ?? error), item.id))
      }
      if (actual !== undefined && actual !== fixture.sha256)
        failures.push(fail('fixture_digest_mismatch', 'Fixture bytes changed after the case ran', item.id))
    }
  }

  for (const entry of requirement?.cases ?? []) {
    const result = byId.get(entry.id)
    const record = { id: entry.id, required: entry.required !== false, status: result?.status ?? 'MISSING' }
    requirements.push(record)
    if (entry.required === false) continue
    if (!result) {
      failures.push(fail('missing_required_case', `Required case ${entry.id} is absent`, entry.id))
      continue
    }
    if (result.status !== STATUS.PASS)
      failures.push(fail('case_not_pass', `Required case ${entry.id} is ${result.status}`, entry.id))
    if (!allowedLayers.has(result.layer))
      failures.push(fail('layer_not_allowed', `Layer ${result.layer} is not admitted by ${requirement?.tier}`, entry.id))
    // An exact layer requirement cannot be satisfied by a case that labels itself differently.
    if (entry.layers && !entry.layers.includes(result.layer))
      failures.push(
        fail('layer_not_allowed', `Case ${entry.id} ran as ${result.layer}, expected ${entry.layers.join('|')}`, entry.id),
      )
    if (requireCaseSource && result.source?.commit !== report.source?.commit)
      failures.push(fail('case_source_unbound', `Case ${entry.id} is not bound to the report source`, entry.id))
    for (const key of evidenceIssues(result, entry.evidence ?? []))
      failures.push(fail('required_evidence_missing', `Case ${entry.id} has no substantive evidence.${key}`, entry.id))

    if (result.status === STATUS.PASS) {
      if (entry.evidence?.includes('native')) {
        for (const issue of nativeIssues(result.evidence?.native, report.source?.commit))
          failures.push(fail('native_evidence_invalid', `Native proof ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('installation')) {
        for (const issue of installationIssues(result.evidence?.installation))
          failures.push(fail('installation_evidence_invalid', `Installation proof ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('cycles')) {
        for (const issue of cycleIssues(result.evidence?.cycles))
          failures.push(fail('cycle_evidence_invalid', `Cycle proof ${issue}`, entry.id))
      }
    }
  }

  if (report.claim?.status === STATUS.PASS && failures.length > 0)
    failures.push(
      fail('self_declared_pass_rejected', 'Report declares release PASS while the gate found blocking evidence'),
    )

  const verdict = failures.length ? STATUS.FAIL : STATUS.PASS
  return {
    schema: RELEASE_SCHEMA,
    tier: requirement?.tier ?? 'unnamed',
    status: verdict,
    ok: verdict === STATUS.PASS,
    checkedAt: new Date(now).toISOString(),
    source: report.source ?? null,
    expectedSource: expectedSource ?? null,
    requirements,
    failures,
    claimedBy: report.claim ?? null,
    notes: [
      'Controlled fixture, SDK mock, readonly and installed evidence never substitute for actual-native execution.',
      'A NOT_TESTED or BLOCKED gap is honest only when the release claim excludes that capability; there is no allow-gap switch.',
    ],
  }
}

/** Writes the gate result as the report's release verdict; never mutates case evidence. */
export function applyReleaseVerdict(report, verdict) {
  return {
    ...report,
    release: verdict,
    claim: {
      status: verdict.status,
      tier: verdict.tier,
      decidedAt: verdict.checkedAt,
      failureCodes: verdict.failures.map((item) => item.code),
    },
  }
}
