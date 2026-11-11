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

const HEX64 = (value) => HEX.test(String(value ?? ''))

/** Advice is data: no actor, probability, larger scope or default-path activation is acceptable. */
export function routeAdviceIssues(advice) {
  if (!advice || typeof advice !== 'object') return ['missing']
  const issues = []
  const key = (ref) => `${ref?.profileId}@${ref?.revision}`
  if (advice.protocol !== 'route-advice/1') issues.push('protocol')
  if (!isSubstantive(advice.id) || !isSubstantive(advice.projectId)) issues.push('identity')
  if (!HEX64(advice.taskContextDigest) || !HEX64(advice.catalogRevision) || !isSubstantive(advice.policyRevision))
    issues.push('binding')
  const eligible = Array.isArray(advice.eligible) ? advice.eligible : []
  const excluded = Array.isArray(advice.excluded) ? advice.excluded : []
  if (new Set(eligible.map(key)).size !== eligible.length) issues.push('duplicate_eligible')
  if (new Set(excluded.map((item) => key(item?.profileRef ?? item))).size !== excluded.length)
    issues.push('duplicate_excluded')
  if (eligible.some((ref) => !HEX64(ref?.identityDigest))) issues.push('identity_digest')
  if (excluded.some((item) => eligible.some((ref) => key(ref) === key(item?.profileRef ?? item))))
    issues.push('excluded_also_eligible')
  if (advice.suggested && !eligible.some((ref) => key(ref) === key(advice.suggested))) issues.push('suggestion_not_eligible')
  const basis = advice.basis
  if (basis === 'none_eligible' && (eligible.length !== 0 || advice.suggested))
    issues.push('false_none_eligible')
  if (basis === 'only_eligible' && eligible.length !== 1) issues.push('false_only_eligible')
  if (!['none_eligible', 'only_eligible', 'operator_default', 'fixed_rule'].includes(basis)) issues.push('basis')
  if (eligible.length > 0 && (!Array.isArray(advice.evidenceRefs) || advice.evidenceRefs.length === 0))
    issues.push('advice_without_evidence')
  if (!(Date.parse(advice.expiresAt) > Date.parse(advice.createdAt))) issues.push('expired_or_invalid_window')
  if (advice.defaultPath !== false) issues.push('advisory_must_not_enter_default_path')
  if (advice.probability !== undefined || advice.confidence !== undefined) issues.push('fabricated_probability')
  return issues
}

export function reviewReportIssues(report) {
  if (!report || typeof report !== 'object') return ['missing']
  const issues = []
  if (report.protocol !== 'review-report/1') issues.push('protocol')
  if (!HEX64(report.subjectDigest)) issues.push('subject_digest')
  if (!['findings', 'no_findings', 'inconclusive'].includes(report.disposition)) issues.push('disposition')
  const findings = Array.isArray(report.findings) ? report.findings : []
  if (report.disposition === 'no_findings' && findings.length !== 0) issues.push('no_findings_with_findings')
  if (report.disposition === 'findings' && findings.length === 0) issues.push('findings_without_findings')
  for (const finding of findings) {
    if (!isSubstantive(finding?.path) || String(finding.path).startsWith('/') || finding.path.includes('..'))
      issues.push('finding_path')
    if (!['high', 'medium', 'low'].includes(finding?.severity)) issues.push('finding_severity')
    if (!isSubstantive(finding?.claim)) issues.push('finding_claim')
  }
  if (report.verdict !== undefined || report.acceptance !== undefined || report.pass !== undefined)
    issues.push('review_cannot_claim_verification')
  return issues
}

export function reviewEvidenceIssues(evidence) {
  if (!evidence || typeof evidence !== 'object') return ['missing']
  const issues = []
  const subject = evidence.subject?.candidate
  const attempt = evidence.reviewAttempt
  if (!subject || !attempt) return ['missing_subject_or_attempt']
  for (const field of ['workId', 'ticketId', 'assignmentId'])
    if (subject[field] === attempt[field]) issues.push(`reuses_author_${field}`)
  if (!HEX64(evidence.subject?.artifactDigest) || !COMMIT.test(String(evidence.subject?.baseCommit ?? '')))
    issues.push('subject_binding')
  if (!HEX64(evidence.inputDigest) || !HEX64(evidence.reportDigest)) issues.push('digests')
  if (!isSubstantive(evidence.reportArtifactRef)) issues.push('report_artifact')
  if (!isSubstantive(evidence.reviewerProfile?.profileId) || !HEX64(evidence.reviewerProfile?.identityDigest))
    issues.push('reviewer_profile')
  if (evidence.isolation?.kind !== 'sealed_copy' || !HEX64(evidence.isolation?.capsuleManifestDigest) ||
      !isSubstantive(evidence.isolation?.proofRef))
    issues.push('sealed_copy_proof')
  if (!['controlled', 'actual_native'].includes(evidence.layer)) issues.push('layer')
  if (!['findings', 'no_findings', 'inconclusive'].includes(evidence.disposition)) issues.push('disposition')
  if (evidence.humanAcceptance !== undefined) issues.push('review_is_not_acceptance')
  return issues
}

export function heterogeneousReviewIssues(entry, sourceCommit) {
  if (!entry || typeof entry !== 'object') return ['missing']
  const issues = []
  if (!isSubstantive(entry.authorProtocol) || !isSubstantive(entry.reviewerProtocol)) issues.push('protocol_missing')
  else if (entry.authorProtocol === entry.reviewerProtocol) issues.push('protocol_not_different')
  if (entry.different !== true) issues.push('difference_not_proven')
  if (entry.executed !== true) issues.push('not_executed')
  if (!isSubstantive(entry.reviewerVersion)) issues.push('version_missing')
  if (!HEX64(entry.reviewerProfileIdentityDigest)) issues.push('identity_missing')
  const budget = entry.budget ?? {}
  if (!isSubstantive(budget.grantId) || !Number.isSafeInteger(budget.maxTokens) || budget.maxTokens <= 0 ||
      !Number.isSafeInteger(budget.usedTokens) || budget.usedTokens < 0 || budget.usedTokens > budget.maxTokens)
    issues.push('budget_unbounded')
  if (!(typeof budget.maxUSD === 'number' && budget.maxUSD > 0 && budget.maxUSD <= 5))
    issues.push('usd_ceiling_missing')
  if (entry.isolation?.kind !== 'sealed_copy' || !HEX64(entry.isolation?.capsuleManifestDigest) ||
      !isSubstantive(entry.isolation?.proofRef))
    issues.push('isolation_missing')
  if (!HEX64(entry.subject?.artifactDigest) || !COMMIT.test(String(entry.subject?.baseCommit ?? '')))
    issues.push('subject_missing')
  if (!Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length === 0) issues.push('evidence_refs_missing')
  if (entry.sourceCommit !== sourceCommit) issues.push('source_mismatch')
  if (!Number.isSafeInteger(entry.reviewTurnStarts) || entry.reviewTurnStarts < 1) issues.push('no_review_turns')
  return issues
}

/** Real native control evidence: execution, stop, native question and recovery, bound to one source. */
export function nativeControlIssues(control, sourceCommit) {
  if (!control || typeof control !== 'object') return ['missing']
  const issues = []
  if (control.executed !== true) issues.push('not_executed')
  if (!isSubstantive(control.version)) issues.push('version_missing')
  if (!isSubstantive(control.attemptId) || !isSubstantive(control.commandId)) issues.push('identity_missing')
  if (!HEX.test(String(control.profileIdentityDigest ?? ''))) issues.push('profile_identity')
  if (control.sourceCommit !== sourceCommit) issues.push('source_mismatch')
  for (const name of ['stop', 'question', 'recovery']) {
    const part = control[name]
    if (!part || part.observed !== true) issues.push(`${name}_not_observed`)
    else if (!Array.isArray(part.evidenceRefs) || part.evidenceRefs.length === 0) issues.push(`${name}_without_evidence`)
  }
  const budget = control.budget ?? {}
  if (!isSubstantive(budget.grantId) || !Number.isSafeInteger(budget.usedTokens) ||
      !Number.isSafeInteger(budget.maxTokens) || budget.usedTokens < 0 || budget.usedTokens > budget.maxTokens)
    issues.push('budget_unbounded')
  if (!Array.isArray(control.evidenceRefs) || control.evidenceRefs.length === 0) issues.push('evidence_refs_missing')
  return issues
}

/** A real 8-case pilot result; BLOCKED/inconclusive or zero turns are not a value result. */
export function pilotIssues(pilot, sourceCommit) {
  if (!pilot || typeof pilot !== 'object') return ['missing']
  const issues = []
  if (pilot.protocol !== 'independent-review-pilot/1') issues.push('protocol')
  if (pilot.grantId !== 'wave05-independent-review-pilot-01') issues.push('grant')
  if (pilot.executed !== true) issues.push('not_executed')
  if (!Number.isSafeInteger(pilot.turnsUsed) || pilot.turnsUsed < 1 || pilot.turnsUsed > 24) issues.push('turns')
  if (!Number.isSafeInteger(pilot.tokensUsed) || pilot.tokensUsed < 1 || pilot.tokensUsed > 200000) issues.push('tokens')
  if (!(typeof pilot.costUSD === 'number' && pilot.costUSD >= 0 && pilot.costUSD <= 5)) issues.push('cost')
  if (pilot.usageCompleteness !== 'observed') issues.push('usage_unknown')
  if (!HEX.test(String(pilot.oracleDigest ?? ''))) issues.push('oracle_digest')
  if (!['promising', 'no_go_for_current_recipe'].includes(pilot.decision)) issues.push('decision')
  if (pilot.sourceCommit !== sourceCommit) issues.push('source_mismatch')
  if (!Array.isArray(pilot.arms) || pilot.arms.length !== 3) issues.push('arms')
  if (Array.isArray(pilot.refusals) && pilot.refusals.length > 0) issues.push('invalid_result_claimed')
  return issues
}

export function reviewTimingIssues(timing) {
  if (!timing || typeof timing !== 'object') return ['missing']
  const issues = []
  if (timing.candidateReadyAt !== null && !Number.isFinite(Date.parse(timing.candidateReadyAt))) issues.push('ready_at')
  if (timing.acceptedAt !== null && !Number.isFinite(Date.parse(timing.acceptedAt))) issues.push('accepted_at')
  if (timing.readyToAcceptanceMs !== null) {
    if (timing.readyToAcceptanceMs < 0) issues.push('negative_delay')
    else if (timing.candidateReadyAt && timing.acceptedAt &&
      Date.parse(timing.acceptedAt) - Date.parse(timing.candidateReadyAt) !== timing.readyToAcceptanceMs)
      issues.push('delay_mismatch')
  }
  if (timing.activeReviewMs === null) {
    if (timing.activeReviewSource !== 'unknown' || timing.activeReviewCompleteness !== 'unknown')
      issues.push('missing_activity_must_be_unknown')
  } else if (!Number.isSafeInteger(timing.activeReviewMs) || timing.activeReviewMs <= 0) {
    issues.push('activity_value')
  } else if (timing.activeReviewSource !== 'ui_visibility_proxy' || timing.activeReviewCompleteness !== 'partial') {
    issues.push('activity_source')
  } else if (timing.readyToAcceptanceMs === null || timing.activeReviewMs > timing.readyToAcceptanceMs) {
    issues.push('activity_exceeds_window')
  }
  if (!Number.isSafeInteger(timing.acceptedEvents) || timing.acceptedEvents < 1) issues.push('accept_event_missing')
  return issues
}

function attentionIssues(attention) {
  if (!attention || typeof attention !== 'object') return ['missing']
  const issues = []
  if (!Number.isSafeInteger(attention.projects) || attention.projects < 1) issues.push('no_projects')
  if (!Number.isSafeInteger(attention.items) || attention.items < 1) issues.push('no_items')
  if (!Array.isArray(attention.groups) || attention.groups.length === 0) issues.push('no_groups')
  if (attention.groups?.some((group) => !isSubstantive(group?.projectId) || !isSubstantive(group?.reason)))
    issues.push('group_provenance')
  if (attention.expiredSent !== 0) issues.push('expired_answer_sent')
  if (attention.batchGrantedPermissions === true) issues.push('batch_authorization')
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
      if (entry.evidence?.includes('routeAdvice')) {
        for (const issue of routeAdviceIssues(result.evidence?.routeAdvice))
          failures.push(fail('route_advice_invalid', `Route advice ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('reviewReport')) {
        for (const issue of reviewReportIssues(result.evidence?.reviewReport))
          failures.push(fail('review_report_invalid', `Review report ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('reviewEvidence')) {
        for (const issue of reviewEvidenceIssues(result.evidence?.reviewEvidence))
          failures.push(fail('review_evidence_invalid', `Review evidence ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('heterogeneous')) {
        for (const issue of heterogeneousReviewIssues(result.evidence?.heterogeneous, report.source?.commit))
          failures.push(fail('heterogeneous_review_invalid', `Heterogeneous review ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('reviewTiming')) {
        for (const issue of reviewTimingIssues(result.evidence?.reviewTiming))
          failures.push(fail('review_timing_invalid', `Review timing ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('nativeControl')) {
        for (const issue of nativeControlIssues(result.evidence?.nativeControl, report.source?.commit))
          failures.push(fail('native_control_invalid', `Native control ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('pilot')) {
        for (const issue of pilotIssues(result.evidence?.pilot, report.source?.commit))
          failures.push(fail('pilot_evidence_invalid', `Pilot ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('attention')) {
        for (const issue of attentionIssues(result.evidence?.attention))
          failures.push(fail('attention_evidence_invalid', `Attention ${issue}`, entry.id))
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
