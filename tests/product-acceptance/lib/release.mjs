import { STATUS, LAYERS } from './status.mjs'
import { INSTALL_CASES } from './release-requirements.mjs'
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

/** Explicit decisions: prepare writes nothing, confirm/revoke are audited, no execution effect. */
export function decisionFlowIssues(flow) {
  if (!flow || typeof flow !== 'object') return ['missing']
  const issues = []
  if (flow.previewReadOnly !== true) issues.push('prepare_not_proven_read_only')
  if (!Number.isSafeInteger(flow.records) || flow.records < 1) issues.push('no_records')
  if (flow.revoked !== true) issues.push('revoke_missing')
  if (flow.sourceState !== 'current') issues.push('source_state')
  if (flow.executionEffects !== 0) issues.push('execution_effect')
  if (!Array.isArray(flow.businessRejections) || flow.businessRejections.length === 0) issues.push('no_business_rejection')
  if (!Number.isSafeInteger(flow.events) || flow.events < 2) issues.push('events')
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

/** The browser must keep a lost-response request identity and settle it exactly once. */
export function proposalUiIssues(ui) {
  if (!ui || typeof ui !== 'object') return ['missing']
  const issues = []
  if (!Number.isSafeInteger(ui.preview?.works) || !Number.isSafeInteger(ui.preview?.receipts)) issues.push('preview_state')
  if (ui.pendingSurvivedReload !== true) issues.push('reload_identity')
  if (ui.lostResponseSettledOnce !== true) issues.push('lost_response')
  if (!Number.isSafeInteger(ui.confirm?.works) || ui.confirm.works <= ui.preview.works) issues.push('confirm_effect')
  if (!Number.isSafeInteger(ui.secondConfirm?.works) || ui.secondConfirm.works !== ui.confirm.works + 1) issues.push('second_confirm')
  if (!Number.isSafeInteger(ui.reject?.works) || ui.reject.works !== ui.secondConfirm.works) issues.push('reject_effect')
  if (!Array.isArray(ui.viewports) || !ui.viewports.includes('mobile')) issues.push('viewports')
  return issues
}

/** Selected context must join the message, receipt, binding and provider request exactly once. */
export function contextUseIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.protocol !== 'assistant-context-prepared/1') issues.push('protocol')
  if (!Number.isSafeInteger(value.sources) || value.sources < 1) issues.push('sources')
  if (!value.binding?.commandId || !value.binding?.messageId || !value.binding?.bundleDigest) issues.push('binding')
  if (value.providerRequests !== 1) issues.push('provider_calls')
  if (value.reopened !== true) issues.push('reopen')
  return issues
}
export function contextSseIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.complete === true && value.providerRequests === 1 ? [] : ['stream_or_single_request']
}
export function contextGuardIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.cross !== 403 && value.cross !== 400) issues.push('cross_project')
  if (!['conflict', 'verification_failed', 'stale_contract'].includes(value.drift)) issues.push('source_drift')
  if (value.expiry !== 'stale_contract') issues.push('expiry')
  if (value.offline !== 'unsupported_capability') issues.push('offline')
  if (value.unknownProviderCalls !== 1) issues.push('unknown_no_resend')
  return issues
}
export function sourceConfirmIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.authorization === 'not_granted' && value.startupAvailable === false && value.queueHeld === true && value.markerUnchanged === true && value.replay === true ? [] : ['source_confirm']
}
export function sourceConfirmRefusalIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.status !== 200 && value.activation === false && value.target === false ? [] : ['source_refusal']
}
export function candidateFlowIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.status === 'candidates' && value.executable === false && value.prepare === 200 && value.confirm === 'recorded' && value.providerCalls === 1 ? [] : ['candidate_flow']
}
export function contextHistoryIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.first !== 1 || value.more !== true) issues.push('page')
  if (!(value.second >= 0)) issues.push('continuation')
  if (value.crossConversation !== 0) issues.push('scope')
  if (!(value.modelOff >= 2)) issues.push('model_off')
  if (value.expiredVisible !== true) issues.push('expiry')
  if (value.providerCalls !== 2) issues.push('resend')
  return issues
}
export function contextSourcesIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.verified >= 1 && ['missing', 'unverified', 'scope_changed'].includes(value.stateAfterCorrupt) && value.providerCalls === 1 ? [] : ['frozen_sources']
}
export function contextUiIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.desktopMessages !== 1 || value.mobileMessages !== 2) issues.push('messages')
  if (value.tabMessages !== 2) issues.push('multi_tab')
  if (!(value.historyRows >= 4)) issues.push('history_ui')
  if (value.pendingReconciled !== true) issues.push('lost_response')
  if (!(value.providerRequests >= 2)) issues.push('provider_calls')
  if (!Array.isArray(value.auditCommandIds) || !value.auditCommandIds[0]) issues.push('audit')
  return issues
}
export function concurrencyIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.prepared === 4 && value.recorded === 4 && value.replies === 4 && value.providerCalls === 4 && value.bindings === 4 ? [] : ['bounded_concurrency']
}
export function replyDurableIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.first?.calls === 1 && value.first?.replies === 0 && value.recovered?.calls === 0 && value.recovered?.replies === 1 ? [] : ['durable_reply']
}
export function replyUnknownIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.crashedCalls === 1 && value.recoveredCalls === 0 && typeof value.notice === 'string' ? [] : ['unknown_resend']
}
export function replyWindowIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.crashedCalls === 1 && value.recoveredCalls === 0 && value.replies === 1 ? [] : ['message_window']
}
export function replyBadArtifactIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.calls === 0 && value.replies === 0 && typeof value.notice === 'string' ? [] : ['bad_artifact']
}
const OWNERSHIP_ISSUE_CODES = Object.freeze({
  subject: 'ownership_subject', helper_provenance: 'helper_provenance', helper_source: 'helper_source',
  helper_build: 'helper_build', helper_tar: 'helper_tar', probe_source: 'probe_source',
  previous_control: 'previous_control', previous_control_identity: 'previous_control_identity',
})
export function scopeDiagnosticsIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const plain = value.plain ?? {}, narrow = value.narrow ?? {}, issues = []
  const reasons = new Set(['project_changed', 'selection_narrowed', 'selection_broadened', 'selection_replaced',
    'exclusion_added', 'exclusion_removed', 'selection_validity_changed'])
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  if (value.mode !== 'personal') issues.push('mode')
  issues.push(...consumerEntryIssues(value))
  const check = (diagnostic, state, bindingCount, label) => {
    if (!diagnostic) { issues.push(`${label}_missing`); return }
    if (diagnostic.protocol !== 'context-scope-review/1' || diagnostic.authorization !== 'none' ||
      typeof diagnostic.partial !== 'boolean' || !Array.isArray(diagnostic.reasons)) issues.push(`${label}_shape`)
    const list = Array.isArray(diagnostic.reasons) ? diagnostic.reasons : []
    if (list.length > 7 || new Set(list).size !== list.length || list.some(reason => !reasons.has(reason))) issues.push(`${label}_reasons`)
    const withheld = diagnostic.withheldSourceCount
    if (!(withheld === null || (Number.isSafeInteger(withheld) && withheld >= 0 && withheld <= 64))) issues.push(`${label}_withheld`)
    if (typeof state === 'string') {
      if (diagnostic.partial !== (state !== 'verified')) issues.push(`${label}_partial`)
      const expected = state === 'scope_changed' ? bindingCount : 0
      if (withheld !== expected) issues.push(`${label}_withheld`)
    }
  }
  if (plain.plain !== 200 || plain.plainHasDiagnostic !== false) issues.push('default_shape')
  // The opt-in diagnostic must be the payload of a real HTTP 200 response in this run; a schema-valid
  // object with a failed/missing status is not an observation.
  if (plain.optIn !== 200) issues.push('opt_in_http')
  if (plain.diagnostic && plain.optIn !== 200) issues.push('opt_in_stale')
  check(plain.diagnostic, plain.state, plain.bindingSourceCount, 'opt_in')
  if (![400, 422].includes(plain.duplicate) || ![400, 422].includes(plain.unknown)) issues.push('strict_query')
  if (narrow.start !== 'RUNNING' && narrow.start !== 'REUSED') issues.push('narrow_start')
  else {
    if (narrow.bodyServed !== false) issues.push('narrow_body')
    if (narrow.optIn !== 200) issues.push('narrow_http')
    check(narrow.diagnostic, narrow.state, narrow.bindingSourceCount, 'narrow')
    if (narrow.state === 'verified') issues.push('narrow_state')
  }
  return issues
}
/** GET /v1/readiness must be independently shaped, configuration-bound and truthful in every mode. */
/** The packaged trial workbench must be navigated in a browser, not inferred from a marker or an API. */
export function trialUiIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (!value.subject || !HEX64(String(value.subject.tarSha256 ?? ''))) issues.push('subject')
  if (value.mode !== 'personal') issues.push('mode')
  if (!value.bundle || !HEX64(String(value.bundle.sha256 ?? '')) || !(value.bundle.bytes > 0)) issues.push('bundle')
  if (!Array.isArray(value.selector?.navigations) || !value.selector.navigations.includes('试用准备')) issues.push('selector')
  for (const key of ['model', 'import', 'executor', 'conversation'])
    if (!String(value.actions?.[key] ?? '').startsWith('opened')) issues.push(`action_${key}`)
  if (!(value.readinessReads >= 1)) issues.push('no_readiness_read')
  if (value.writes !== 0) issues.push('writes')
  if (value.providerBefore !== value.providerAfter) issues.push('provider_calls')
  if (value.negatives?.abort?.preservesPrior !== true) issues.push('abort_prior')
  if (value.negatives?.badSchema?.alertShown !== true || value.negatives?.badSchema?.leaksGranted !== false ||
    value.negatives?.badSchema?.keepsPersonal !== true) issues.push('bad_schema')
  if (value.negatives?.legacy?.absentInterfaceStated !== true) issues.push('legacy')
  for (const viewport of ['desktop', 'mobile']) {
    const layout = value.layout?.[viewport]
    if (!layout || !Array.isArray(layout.overlaps) || layout.overlaps.length > 0) issues.push(`${viewport}_overlap`)
    if (!layout || !(layout.overflow?.scrollWidth <= layout.overflow?.innerWidth + 1)) issues.push(`${viewport}_overflow`)
  }
  if (!Array.isArray(value.screenshots) || value.screenshots.length < 2 ||
    value.screenshots.some(item => !HEX64(String(item.sha256 ?? '')) || !(item.bytes > 1000))) issues.push('screenshots')
  if (!Array.isArray(value.problems) || !Array.isArray(value.pageErrors) || value.pageErrors.length > 0) issues.push('page_errors')
  const lifecycle = value.lifecycle ?? {}
  for (const stage of ['stageAStop', 'stageBStop']) {
    const stop = lifecycle[stage] ?? {}
    if (stop.clean !== true) issues.push(`${stage}_unclean`)
    const packaged = stop.package === 'STOPPED' || stop.package === 'STOPPED_ORPHAN'
    if (packaged) continue
    // A packaged refusal is admitted only as an explicit product finding with an equivalent-proof
    // cleanup: exact code/failures, per-pid proof signals, and the record removed after proof.
    if (!isSubstantive(stop.refusal?.code) || !Array.isArray(stop.refusal?.failures) || stop.refusal.failures.length === 0) { issues.push(`${stage}_package`); continue }
    if (!Array.isArray(stop.signals) || stop.signals.length === 0 || stop.signals.some(item => item.ok !== true || item.signalled !== 'SIGTERM')) issues.push(`${stage}_proof`)
    if (stop.recordRemoved !== true) issues.push(`${stage}_record`)
  }
  if (lifecycle.unknown !== null && lifecycle.unknown !== undefined) issues.push('unknown_resource')
  if (lifecycle.retained) issues.push('retained_after_success')
  if (lifecycle.released?.removed !== true) issues.push('not_released')
  const injected = value.problems?.filtered?.injectedResourceFailures ?? value.problemsFiltered?.injectedResourceFailures ??
    ((value.problems?.length ?? 0) - (value.pageErrors?.length ?? 0))
  if (!(injected >= 3)) issues.push('injected_failures_unrecorded')
  return issues
}
/**
 * Probe-owned lifecycle controls. Each validator checks the recorded decisions of the pure control,
 * so a tool that silently force-killed, deleted a record or trusted a substring cannot pass.
 */
/** A packaged stop either succeeds or is reported as an exact, reproducible product finding. */
export function packagedStopIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.status !== 'RUNNING') issues.push('not_started')
  if (value.stopStatus === 'STOPPED' || value.stopStatus === 'STOPPED_ORPHAN') {
    if (value.finding !== null) issues.push('finding_without_refusal')
  } else if (value.stopStatus === 'BLOCKED') {
    const finding = value.finding ?? {}
    if (finding.code !== 'instance_identity_mismatch' || !Array.isArray(finding.failures) || finding.failures.length === 0) issues.push('finding')
    if (finding.expected === finding.observed) issues.push('finding_contradiction')
    if (!isSubstantive(finding.command) || !Number.isSafeInteger(finding.exit)) issues.push('finding_command')
  } else issues.push('stop_status')
  const cleaned = value.cleaned ?? {}
  if (cleaned.clean !== true) issues.push('not_cleaned')
  if (value.stopStatus === 'BLOCKED' && (cleaned.recordRemoved !== true ||
    !Array.isArray(cleaned.signals) || cleaned.signals.length === 0 || cleaned.signals.some(item => item.ok !== true))) issues.push('proof_cleanup')
  return issues
}
export function lifecycleOwnIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.birth?.argvExact !== true || !Number.isSafeInteger(value.birth?.pid)) issues.push('birth')
  if (!Array.isArray(value.signals) || value.signals.length === 0) issues.push('no_signal')
  else if (value.signals.some(item => item.signalled !== 'SIGTERM')) issues.push('unexpected_signal')
  if (!Array.isArray(value.aliveAfter) || value.aliveAfter.length !== 0) issues.push('survivors')
  if (value.clean !== true || value.released?.removed !== true || value.rootAfter !== false) issues.push('not_released')
  return issues
}
export function lifecycleWrongStartIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.reason !== 'unknown_live_resource') issues.push('reason')
  if (!Array.isArray(value.gaps) || value.gaps.length === 0) issues.push('no_gap')
  if (!Array.isArray(value.signals) || value.signals.length !== 0) issues.push('signalled')
  if (value.alive !== true) issues.push('killed')
  if (!HEX64(String(value.retained?.sha256 ?? '')) || value.retained?.reason !== 'unknown_live_resource') issues.push('retained')
  return issues
}
export function lifecycleSiblingIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.reason !== 'requested_root_mismatch') issues.push('reason')
  if (value.scope?.stateMatches !== false) issues.push('scope')
  if (!Array.isArray(value.signals) || value.signals.length !== 0) issues.push('signalled')
  if (value.substringMatch !== false) issues.push('substring_accepted')
  if (value.exactMatch !== true) issues.push('exact_lost')
  if (value.alive?.alive !== true) issues.push('killed')
  return issues
}
export function lifecycleForeignChildIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.sameUid !== true) issues.push('not_same_uid_control')
  if (value.foreignArgvExactForRequestedRoot !== false) issues.push('argv_match')
  if (value.reason !== 'fresh_identity_changed') issues.push('reason')
  if (value.signalled !== null && value.signalled !== false) issues.push('signalled')
  if (value.foreignAlive?.alive !== true) issues.push('killed')
  return issues
}
export function lifecycleMixedUnknownIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.reason !== 'unknown_live_resource') issues.push('reason')
  if (!Array.isArray(value.gaps) || !value.gaps.some(item => item.label === 'console')) issues.push('console_gap')
  if (!Array.isArray(value.signals) || value.signals.length !== 0) issues.push('signalled')
  if (!Array.isArray(value.alive) || value.alive.length !== 2 || !value.alive.every(Boolean)) issues.push('killed')
  if (value.recordPresent !== true) issues.push('record_deleted')
  return issues
}
export function lifecycleStartWindowIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.status !== 'TIMEOUT') issues.push('status')
  if (!Number.isSafeInteger(value.birth?.pid) || !isSubstantive(value.birth?.start)) issues.push('birth')
  if (value.beforeStop?.rootExists !== true || value.beforeStop?.record !== true) issues.push('not_retained_before_proof')
  if (value.fresh?.argvExact !== true) issues.push('fresh_argv')
  if (value.clean !== true || value.released?.removed !== true) issues.push('not_cleaned')
  return issues
}
export function lifecycleRefusedStopIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.package?.json?.status !== 'BLOCKED' || value.package?.status === 0) issues.push('package_status')
  if (value.reason !== 'package_stop_refused') issues.push('reason')
  if (!Array.isArray(value.signals) || value.signals.length !== 0) issues.push('fallback_signal')
  if (value.alive?.alive !== true) issues.push('killed')
  if (!HEX64(String(value.retained?.sha256 ?? '')) || value.retained?.reason !== 'package_stop_refused') issues.push('retained')
  return issues
}
export function lifecycleIdempotentIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.first?.clean !== true || !Array.isArray(value.first?.signals) || value.first.signals.length === 0) issues.push('first')
  if (value.second?.clean !== true || value.second?.signalled !== 0) issues.push('second')
  if (value.released?.removed !== true) issues.push('release')
  return issues
}
export function readinessIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  const shape = body => {
    if (!body || typeof body !== 'object') return ['missing']
    const found = []
    if (body.protocol !== 'trial-readiness/1') found.push('protocol')
    if (!HEX64(String(body.configurationRevision ?? ''))) found.push('revision')
    if (body.authorization !== 'none') found.push('authorization')
    if (body.startupMode === 'recovery_readonly' && (body.development !== 'readonly' || body.execution?.state !== 'unavailable' ||
      body.execution?.reason !== 'recovery_readonly' || body.projects?.dispatchable !== 0 || body.profiles?.admittedNative !== 0 ||
      body.profiles?.admittedControlled !== 0 || body.capabilities?.decisions !== false || body.capabilities?.proposals !== false)) found.push('readonly')
    if (!body.projects || typeof body.projects !== 'object') found.push('projects')
    if (!body.profiles || typeof body.profiles !== 'object') found.push('profiles')
    if (!body.capabilities || typeof body.capabilities !== 'object') found.push('capabilities')
    if (!body.execution || typeof body.execution !== 'object') found.push('execution')
    return found
  }
  if (!value.subject || !HEX64(String(value.subject.tarSha256 ?? ''))) issues.push('subject')
  if (value.mode !== 'personal') issues.push('mode')
  const normal = value.normal ?? {}, readonly = value.readonly ?? {}, fixture = value.fixture ?? {}
  if (normal.status !== 'RUNNING' || normal.mode !== 'personal' || normal.startupMode !== 'normal') issues.push('normal_start')
  if (normal.readiness?.status !== 200) issues.push('normal_http')
  else issues.push(...shape(normal.readiness.body).map(item => `normal_${item}`))
  if (normal.readiness?.body?.configurationRevision !== normal.configuration?.revision) issues.push('normal_revision')
  if (normal.negatives?.invalidBearer !== 401 || normal.negatives?.badQuery !== 400 || normal.negatives?.badQueryCode !== 'invalid_request' ||
    normal.negatives?.missingRoute !== 404) issues.push('normal_negatives')
  if (normal.registration !== 200 || normal.after?.status !== 200 ||
    normal.after?.body?.configurationRevision === normal.readiness?.body?.configurationRevision ||
    normal.after?.body?.projects?.development !== (normal.readiness?.body?.projects?.development ?? -1) + 1) issues.push('normal_stale')
  if (readonly.status !== 'RUNNING' || readonly.startupMode !== 'recovery_readonly' || readonly.readiness?.status !== 200) issues.push('readonly_start')
  else issues.push(...shape(readonly.readiness.body).map(item => `readonly_${item}`))
  if (fixture.status !== 'RUNNING' || fixture.mode !== 'fixture' || fixture.readiness?.status !== 200 ||
    fixture.readiness?.body?.mode !== 'fixture' || fixture.readiness?.body?.development !== 'fixture_only') issues.push('fixture_facts')
  else issues.push(...shape(fixture.readiness.body).map(item => `fixture_${item}`))
  if (value.mockRequests !== value.providerBefore) issues.push('provider_calls')
  return issues
}
export function installedStabilityIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  if (value.mode !== 'recovery_readonly') issues.push('mode')
  if (!Array.isArray(value.concurrent) || value.concurrent.length !== 4 || value.concurrent.some(status => status !== 200)) issues.push('concurrent')
  if (value.repeatedEqual !== true || value.queueReturned !== true || value.countsStable !== true) issues.push('returned')
  if (value.providerUnchanged !== true) issues.push('resend')
  if (value.reopened !== 'RUNNING' || value.reopenedEqual !== true) issues.push('reopen')
  return issues
}
function consumerEntryIssues(value) {
  const entry = value?.consumerEntry, issues = []
  if (!entry || entry.origin !== 'package') return ['consumer_provenance']
  if (!entry.package || String(entry.package.source ?? '') !== String(value?.subject?.source ?? '') ||
    String(entry.package.buildId ?? '') !== String(value?.subject?.buildId ?? '') ||
    String(entry.package.tarSha256 ?? '') !== String(value?.subject?.tarSha256 ?? '')) issues.push('consumer_provenance')
  const files = Array.isArray(entry.files) ? entry.files : []
  const required = ['apps/launcher/lib/start.mjs', 'apps/coordinator/product/restored-review.ts', 'apps/coordinator/product/demo.ts']
  if (files.length < 3 || files.some(file => !isSubstantive(file?.path) || !HEX.test(String(file?.sha256 ?? '')) || !Number.isSafeInteger(file?.bytes)) ||
    !required.every(path => files.some(file => file.path === path))) issues.push('consumer_provenance')
  return issues
}
export function personalReviewIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const before = value.before ?? {}, after = value.after ?? {}, issues = []
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  if (value.mode !== 'personal' || value.state !== 'recovery_readonly' ||
    !(isSubstantive(value.entryOrigin) || isSubstantive(value.consumerEntry?.origin))) issues.push('mode')
  if (!(before.healthy === true || before.status === 'RUNNING') || before.candidates !== 403 || before.history !== 403) issues.push('unbound')
  if (after.candidates !== 200 || after.history !== 200 || after.sources !== 200 || after.originalBody !== true) issues.push('bound')
  if (value.business !== 422) issues.push('business')
  issues.push(...consumerEntryIssues(value))
  if (value.queueHeld !== true) issues.push('queue')
  if (value.reviewFile?.mode !== '600' || value.reviewFile?.access !== 'historical_data_read_only' || value.reviewFile?.startupAvailable !== false) issues.push('review_file')
  if (!Number.isSafeInteger(value.providerRequests)) issues.push('provider')
  return issues
}
export function restoredReviewRefusalsIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const results = value.results ?? {}, issues = []
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  if (value.mode !== 'personal' || !(isSubstantive(value.entryOrigin) || isSubstantive(value.consumerEntry?.origin))) issues.push('mode')
  for (const name of ['tamperedSignature', 'foreignRoot', 'publicMode', 'symlink', 'fifo'])
    if (results[name]?.healthy !== false) issues.push(name)
  for (const name of ['existingOutput', 'unknownProject', 'unsafePath'])
    if (!Number.isInteger(results[name]?.status) || results[name].status === 0) issues.push(name)
  if ((results.expired ?? results.expiredOrTampered)?.healthy !== false) issues.push('expired_or_tampered')
  if (!Array.isArray(value.notTestedEntry) || !isSubstantive(value.notTestedReason)) issues.push('scope')
  issues.push(...consumerEntryIssues(value))
  return issues
}
export function reviewReuseIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const outcomes = value.outcomes ?? {}, processes = value.processes, issues = []
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  if (value.mode !== 'personal') issues.push('mode')
  issues.push(...consumerEntryIssues(value))
  // The original and reused process identity is mandatory, not an optional comparison.
  if (!processes || !isSubstantive(processes.live) || !isSubstantive(processes.reused) || processes.live !== processes.reused)
    issues.push('process')
  const same = outcomes.sameFile ?? {}
  if (!((same.status === 'REUSED' || same.status === 'RUNNING') && Number.isSafeInteger(same.instance?.pid) &&
    same.instance.pid === value.firstPid)) issues.push('same_selection')
  else if (!isSubstantive(same.instance?.processStart) || same.instance.processStart !== processes?.reused) issues.push('process')
  // Digest support is a fact of the immutable package bytes for this subject, not a self-claimed evidence
  // field. A supporting package must always carry the original and reused observations.
  const capability = value.packageCapability
  if (!capability || String(capability.source ?? '') !== String(value.subject?.source ?? '') ||
    String(capability.buildId ?? '') !== String(value.subject?.buildId ?? '') ||
    String(capability.tarSha256 ?? '') !== String(value.subject?.tarSha256 ?? '') ||
    typeof capability.digestSupported !== 'boolean') issues.push('capability')
  else if (capability.digestSupported) {
    if (value.digestAvailable !== true || !HEX.test(String(value.healthDigest ?? '')) || value.sameDigest !== value.healthDigest)
      issues.push('digest')
  } else if (value.digestAvailable !== false || !isSubstantive(value.digestScope)) issues.push('digest')
  // Every negative request needs a real observed refusal terminal; a RUNNING response (even without a
  // reused boolean) or a missing observation is not a refusal.
  for (const name of ['differentFile', 'missingFile', 'portChange', 'unboundThenSelection']) {
    const item = outcomes[name]
    if (!item || typeof item !== 'object' || item.status !== 'BLOCKED' || !isSubstantive(item.code)) issues.push(name)
    else if (Number.isSafeInteger(item.instance?.pid) && item.instance.pid === value.firstPid) issues.push(name)
  }
  if (!Number.isSafeInteger(value.pidAfterRefusals) || value.pidAfterRefusals !== value.firstPid ||
    !Number.isSafeInteger(value.pidAfterUnbound) || value.pidAfterUnbound !== value.unboundPid) issues.push('pid')
  return issues
}
export function workflowFormatsIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  if (value.mode !== 'installed_bytes') issues.push('mode')
  const scope = value.capability
  if (scope !== 'default1+explicit2' && scope !== 'v1-only') issues.push('capability')
  if (!value.v1 || value.v1.status !== 'ok' || value.v1.protocol !== 'workflow-snapshot/1' ||
    value.v1.evidenceProtocol !== 'workflow-evidence/1' || value.v1.families !== 13 ||
    value.v1.familySetVersion !== null || value.v1.verified !== 'ok' || !HEX.test(String(value.v1.digest ?? ''))) issues.push('v1')
  if (scope === 'default1+explicit2') {
    if (!value.v2 || value.v2.status !== 'ok' || value.v2.protocol !== 'workflow-snapshot/2' ||
      value.v2.evidenceProtocol !== 'workflow-evidence/2' || value.v2.families !== 21 ||
      value.v2.familySetVersion !== 2 || value.v2.verified !== 'ok' || !HEX.test(String(value.v2.digest ?? ''))) issues.push('v2')
    else if (value.v2.digest === value.v1.digest) issues.push('v2_recipe')
    if (!value.invalid3 || value.invalid3.rejected !== true || value.invalid3.destinationCreated !== false) issues.push('invalid_version')
  // Wave-27: artifact bytes must be closed over the registry digests, and corruption/missing files must
  // be refused by the same packaged verifier; an unknown persisted table cannot be a complete set.
  const closure = value.artifactClosure ?? {}
  for (const key of ['v1', 'v2']) {
    const entry = closure[key]
    if (!entry) continue
    if (!(entry.copied >= 1) || !Array.isArray(entry.digests) || !entry.digests.every(item => item.match === true)) issues.push(`${key}_artifact_digest`)
    if (!entry.allMatch) issues.push(`${key}_artifact_missing_match`)
  }
  if (closure.corruptDetected !== true) issues.push('corrupt_artifact_accepted')
  if (closure.missingDetected !== true) issues.push('missing_artifact_accepted')
  if (value.derived?.refused !== true) issues.push('unknown_table_not_bounded')
    if (value.dbUnchanged !== true) issues.push('source_db')
    if (!value.snapshotProtocols?.includes('workflow-snapshot/2') || !value.evidenceProtocols?.includes('workflow-evidence/2')) issues.push('protocol_pair')
  } else if (scope === 'v1-only') {
    if (!value.v2 || value.v2.unsupported !== true || value.v2.families !== 13 || value.snapshotProtocols?.includes('workflow-snapshot/2')) issues.push('v2_claim')
  }
  if (value.portability?.installArtifact !== 'pa-install/1' || value.portability?.restoreReport !== 'personal-restore/1' ||
    !isSubstantive(value.explicitV2)) issues.push('protocol_separation')
  return issues
}
export function secondRootIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const readOnly = value.readOnly ?? {}, before = value.before ?? {}, after = value.after ?? {}, issues = []
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  if (value.mode !== 'recovery_readonly' || value.restore !== 'RESTORED' || value.verify !== 'VERIFIED') issues.push('restored')
  if (value.probeScope !== 'fixture+recovery_readonly' && value.probeScope !== 'personal') issues.push('probe_scope')
  if (!isSubstantive(value.personalRebinding)) issues.push('personal_scope')
  const data = value.businessData
  if (!data || !isSubstantive(data.producer) || data.workPhase !== 'delivered' || !(data.workArtifacts >= 1) ||
    !(data.questionsAnswered >= 1) || data.candidateConfirmed !== 'recorded' || data.nativeApplied !== false ||
    !isSubstantive(data.boundary)) issues.push('business_data')
  if (readOnly.originalBodyEqual !== true || !(readOnly.messages >= 3)) issues.push('original_body')
  if (readOnly.workPhase !== 'delivered' || !(readOnly.workArtifacts >= 1)) issues.push('held_work')
  if (!(before.questions >= 1)) issues.push('qa')
  if (readOnly.candidates !== 200 || readOnly.candidateStatus !== 'candidates' || !(readOnly.candidateCount >= 1)) issues.push('candidates')
  if (readOnly.audit !== 200 || readOnly.history !== 200 || readOnly.sources !== 200 || !(readOnly.historyRows >= 1)) issues.push('context')
  if (readOnly.business !== 422) issues.push('business')
  if (!Number.isSafeInteger(readOnly.effectRows) || readOnly.effectRows !== readOnly.effectRowsBefore) issues.push('queue')
  if (!Number.isSafeInteger(readOnly.modelRequestsAfter) || readOnly.modelRequestsAfter !== readOnly.modelRequestsBefore) issues.push('resend')
  if (!(before.bindings >= 1 && before.results >= 1 && after.bindings === before.bindings && after.results === before.results &&
    after.messages === before.messages && after.decisions === before.decisions)) issues.push('data')
  return issues
}
export function installedSourceConfirmIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const prepare = value.prepare ?? {}, confirm = value.confirm ?? {}, replay = value.replay ?? {}, reopened = value.reopened ?? {}, issues = []
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  if (value.mode !== 'recovery_readonly') issues.push('mode')
  if (prepare.status !== 200 || prepare.authorization !== 'not_granted' || prepare.startupAvailable !== false) issues.push('not_granted')
  if (prepare.targetCreated !== false) issues.push('target')
  if (confirm.status !== 200 || !isSubstantive(confirm.activationId) || confirm.auditEqual !== true) issues.push('confirm')
  if (value.queueHeld !== true || value.markerUnchanged !== true) issues.push('held')
  if (replay.status !== 200 || replay.equal !== true) issues.push('replay')
  if (reopened.status !== 'RUNNING' || reopened.replay !== 200 || reopened.equal !== true) issues.push('reopen')
  if (!Number.isSafeInteger(value.providerRequests)) issues.push('provider')
  return issues
}
export function installedCandidatesIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const actions = value.actions ?? {}, issues = []
  if (value.mode !== 'personal' || value.action !== 'discussion_only_default_off_then_enabled') issues.push('mode')
  if (actions.suggestionsOff !== 200 || actions.suggestionsOffEnabled !== false || actions.offCandidateStatus !== 'none') issues.push('default_off')
  if (actions.suggestionsOn !== 200 || actions.suggestionsOnEnabled !== true) issues.push('opt_in')
  if (actions.candidates !== 200 || actions.candidateStatus !== 'candidates' || !(actions.candidateCount >= 2)) issues.push('candidates')
  if (actions.candidateWorkPrepare !== 200 || !(actions.candidateWorkRequiredInputs?.length > 0) || actions.candidateWorkStatus !== 'rejected') issues.push('required_inputs')
  if (actions.candidatePrepare !== 200 || actions.candidateConfirmStatus !== 'recorded') issues.push('confirm')
  if (actions.candidateReplay !== 200 || actions.candidateReplaySame !== true) issues.push('replay')
  if (actions.candidateRejectPrepare !== 200 || actions.candidateRejectStatus !== 'recorded') issues.push('reject')
  if (actions.nativeSends !== 0 || actions.dispatchPaused !== 'discussion_only_no_executor') issues.push('native')
  if (!isSubstantive(value.subject?.buildId)) issues.push('subject')
  return issues
}
export function ownershipMocksIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const steps = Object.fromEntries((value.steps ?? []).map(item => [item.id, item]))
  const issues = []
  if (steps.parent_owned?.status !== 'PASS') issues.push('parent')
  if (steps.same_uid_child_not_owned?.status !== 'PASS') issues.push('child_owned')
  if (steps.child_not_signalled?.status !== 'PASS') issues.push('child_signalled')
  if (steps.unknown_child_blocks_proof?.status !== 'PASS' || value.proof?.proven !== false) issues.push('proof')
  // The safety helper must be the one shipped inside the same frozen package as the installed
  // subject: a green probe produced from a newer source checkout cannot certify an older binary.
  const subject = value.subject
  if (!subject || !isSubstantive(subject.source) || !isSubstantive(subject.buildId) ||
    !Number.isSafeInteger(subject.schema) || !HEX.test(String(subject.tarSha256 ?? '')) ||
    !Number.isSafeInteger(subject.tarBytes)) issues.push('subject')
  const helper = value.helper
  if (!helper || !HEX.test(String(helper.upgradeSha256 ?? '')) || !HEX.test(String(helper.instanceSha256 ?? '')) ||
    !Number.isSafeInteger(helper.upgradeBytes) || !Number.isSafeInteger(helper.instanceBytes)) {
    issues.push('helper_provenance')
  } else {
    if (String(helper.sourceCommit ?? '') !== String(subject?.source ?? '')) issues.push('helper_source')
    if (String(helper.buildId ?? '') !== String(subject?.buildId ?? '')) issues.push('helper_build')
    if (String(helper.tarSha256 ?? '') !== String(subject?.tarSha256 ?? '')) issues.push('helper_tar')
  }
  if (!value.probeSource || !HEX.test(String(value.probeSource.sha256 ?? ''))) issues.push('probe_source')
  // A positive control: the previous frozen package must still fail this probe. Without it a green
  // result is compatible with a probe that never discriminates the defect.
  const previous = value.previousPackageHelper
  if (!previous || !isSubstantive(previous.source) || !HEX.test(String(previous.upgradeSha256 ?? '')) ||
    !Number.isSafeInteger(previous.fail) || previous.fail < 1) issues.push('previous_control')
  else if (String(previous.source) === String(subject?.source ?? '') ||
    String(previous.upgradeSha256) === String(helper?.upgradeSha256 ?? '')) issues.push('previous_control_identity')
  return issues
}
export function ownershipCopyIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  if (value.status === 0 || !isSubstantive(value.code) || value.apiAlive !== true) issues.push('claimed_other_state')
  return issues
}
export function upgradeFaultsIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = [], windows = value.windows ?? {}
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  for (const mode of ['crash_after_stop', 'crash_after_stop_kill', 'target_unhealthy']) {
    const probe = windows[mode]?.probe, steps = Object.fromEntries((probe?.steps ?? []).map(item => [item.id, item]))
    if (!probe) { issues.push(mode); continue }
    if (steps.fault_observed?.status !== 'PASS' || steps.recover?.status !== 'PASS' || steps.recovered_health?.status !== 'PASS' || steps.data_kept?.status !== 'PASS') issues.push(mode)
    if (!isSubstantive(probe.fault?.code) && !probe.fault?.killed) issues.push(`${mode}_fault`)
    if (!isSubstantive(probe.recover?.status) || !['RECOVERED_PREVIOUS', 'RECOVERED_TARGET', 'REVERTED', 'NO_OP'].includes(probe.recover.status)) issues.push(`${mode}_recover`)
    if (!Number.isInteger(probe.recover?.exit) || probe.recover.exit !== 0) issues.push(`${mode}_exit`)
    if (probe.recover?.code !== null && probe.recover?.code !== undefined) issues.push(`${mode}_code`)
    if (!isSubstantive(probe.fault?.operationId) || probe.operation?.after !== probe.fault.operationId) issues.push(`${mode}_operation`)
    if (!isSubstantive(probe.pointerBefore) || !isSubstantive(probe.pointerAfter) || probe.pointerAfter !== probe.pointerBefore) issues.push(`${mode}_pointer`)
    if (probe.dataKept !== true) issues.push(`${mode}_data`)
  }
  return issues
}
export function currentInstallIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (!isSubstantive(value.subject?.buildId) || !Number.isSafeInteger(value.subject?.schema)) issues.push('subject')
  if (value.mode !== 'personal' || !isSubstantive(value.action) || !isSubstantive(value.observed)) issues.push('not_executed')
  if (value.observed === 'RUNNING') {
    if (value.instanceMode !== 'personal') issues.push('instance_mode')
    if (value.configuration?.assistantContextAvailable !== true) issues.push('context_availability')
    if (value.actions?.send !== 200 || value.actions?.sendStatus !== 'recorded' || value.actions?.audit !== 200 ||
      value.actions?.history !== 200 || value.actions?.sources !== 200 || !isSubstantive(value.actions?.reply)) issues.push('actions')
  }
  for (const key of ['hasContextRoute', 'hasHistoryRoute', 'hasSourcesRoute', 'hasReplyResults', 'hasDiscussionReadiness'])
    if (typeof value.capability?.[key] !== 'boolean') issues.push(key)
  return issues
}
export function frozenScopeIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = [], artifact = value.artifact ?? {}, capability = value.capability ?? {}, main = value.main ?? {}
  if (!HEX64(artifact.tarSha256) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(String(artifact.source ?? '')) || !isSubstantive(artifact.buildId) || !Number.isSafeInteger(artifact.schema) || !Number.isSafeInteger(artifact.tarBytes)) issues.push('tuple')
  if (!Number.isSafeInteger(main.schema)) issues.push('main_schema')
  for (const key of ['hasContextRoute', 'hasHistoryRoute', 'hasSourcesRoute', 'hasReplyResults']) if (typeof capability[key] !== 'boolean') issues.push(key)
  if (value.currentMainEligible === true && !(capability.hasContextRoute && capability.hasHistoryRoute && capability.hasSourcesRoute && capability.hasReplyResults)) issues.push('eligibility')
  return issues
}
export function legacyMigrationIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.old?.schema < value.migrated?.schema && value.migrated?.schema >= 18 && value.old?.messages === value.migrated?.messages ? [] : ['legacy_migration']
}
export function schemaMigrationIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (!(value.old?.schema <= value.migrated?.schema)) issues.push('schema_order')
  if (value.old?.messages !== value.migrated?.messages) issues.push('data_loss')
  if (value.migrated?.bindingTable !== true) issues.push('binding_table')
  if (value.reopened !== true) issues.push('reopen')
  return issues
}
export function completedReplyIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.providerRequests !== 1) issues.push('provider_calls')
  if (value.replies !== 1) issues.push('reply_count')
  if (value.auditStable !== true) issues.push('audit')
  return issues
}
export function unknownReplyIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  return value.providerRequests === 1 && value.notice === true && value.reply === false ? [] : ['unknown_resend_or_success']
}

/** Personal install must prove a real personal process, console, auth and config adoption. */
export function backupContextReplyIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (!(value.before?.bindings >= 1 && value.before?.results >= 1 && value.before?.messages >= 2)) issues.push('not_nonempty')
  if (JSON.stringify(value.after) !== JSON.stringify(value.before)) issues.push('counts_changed')
  if (!(value.artifacts >= 1)) issues.push('artifact_missing')
  if (typeof value.reply !== 'string') issues.push('reply')
  return issues
}
export function installedContextIssues(value) {
  if (!value || typeof value !== 'object') return ['missing']
  const issues = []
  if (value.mode !== 'fixture') issues.push('mode')
  if (value.available !== true) issues.push('availability')
  if (value.prepare !== 200 || value.send !== 'recorded') issues.push('send')
  if (!value.reply || value.audit !== 200) issues.push('reply_or_audit')
  if (!(value.modelCalls >= 1)) issues.push('provider')
  return issues
}
export function personalInstallIssues(personal) {
  if (!personal || typeof personal !== 'object') return ['missing']
  const issues = []
  if (personal.start !== 'RUNNING') issues.push('start')
  if (personal.health !== 'ok') issues.push('health')
  if (personal.console?.status !== 200 || personal.console?.asset !== true) issues.push('console')
  if (personal.auth !== 401 && personal.auth !== 403) issues.push('auth')
  if (!Number.isSafeInteger(personal.schema)) issues.push('schema')
  if (personal.stop?.status !== 'STOPPED' || personal.stop?.closed !== true) issues.push('stop')
  if (personal.modelSends !== 0) issues.push('model_send')
  if (personal.configConflict?.code !== 'release_source_conflict' || personal.configConflict?.after !== personal.configConflict?.before) issues.push('config_conflict')
  return issues
}

/** Context preview must be bounded, project/work bound and free of execution effects. */
export function contextPreviewIssues(preview) {
  if (!preview || typeof preview !== 'object') return ['missing']
  const issues = []
  if (preview.protocol !== 'context-preview/1') issues.push('protocol')
  if (preview.trust !== 'untrusted_data') issues.push('trust')
  if (!Array.isArray(preview.budgetClamped) || preview.budgetClamped.length === 0) issues.push('budget_not_clamped')
  if (!preview.budget || preview.budget.maxFiles > 32 || preview.budget.maxBytes > 131072 || preview.budget.maxTokens > 32768) issues.push('ceiling')
  if (!Number.isSafeInteger(preview.totals?.files) || !Number.isSafeInteger(preview.totals?.bytes)) issues.push('totals')
  if (!Array.isArray(preview.kinds) || !preview.kinds.includes('work') || !preview.kinds.includes('contract')) issues.push('work_sources')
  if (preview.refusals?.crossProject === 200 || preview.refusals?.missingWork !== 400) issues.push('refusals')
  return issues
}

/**
 * A structured proposal is inert data until one explicit confirmation. Preview must be pending,
 * confirmation/rejection must be replay-safe, every drift/tamper/cross-project path must refuse,
 * and a question answer must never become shared knowledge.
 */
export function proposalFlowIssues(flow) {
  if (!flow || typeof flow !== 'object') return ['missing']
  const issues = []
  const preview = flow.preview ?? {}
  const confirm = flow.confirm ?? {}
  const replay = flow.replay ?? {}
  const refusals = flow.refusals ?? {}
  if (preview.protocol !== 'proposal-preview/1') issues.push('protocol')
  if (!Array.isArray(preview.requiredInputs) || preview.requiredInputs.length < 3) issues.push('required_inputs')
  if (!Number.isSafeInteger(preview.ttlMs) || preview.ttlMs <= 0 || preview.ttlMs > 5 * 60 * 1000 + 5_000) issues.push('ttl')
  if (!isSubstantive(confirm.workId) || !Number.isSafeInteger(confirm.seq)) issues.push('confirm')
  if (replay.seq !== confirm.seq) issues.push('replay_seq')
  if (![400, 422].includes(refusals.missingInput)) issues.push('missing_input_not_refused')
  if (refusals.changedPayload !== 409) issues.push('changed_payload_not_conflict')
  if (refusals.tampered !== 403) issues.push('tampered_not_refused')
  if (![400, 403].includes(refusals.crossProject)) issues.push('cross_project_not_refused')
  if (flow.reject?.recorded !== true || flow.reject?.noWork !== true) issues.push('reject_effect')
  if (!Number.isSafeInteger(flow.isolation?.projectA) || !Number.isSafeInteger(flow.isolation?.projectB)) issues.push('isolation')
  if (flow.decision?.recorded !== true) issues.push('decision_effect')
  if (![400, 403, 409].includes(flow.authAnswer)) issues.push('auth_answer_promoted')
  return issues
}

/** Evidence history must name its work/contract, bound pages and refuse invalid limits. */
export function evidenceHistoryIssues(history) {
  if (!history || typeof history !== 'object') return ['missing']
  const issues = []
  if (history.protocol !== 'work-evidence-history/1') issues.push('protocol')
  if (!Number.isSafeInteger(history.entries) || history.entries < 1) issues.push('no_entries')
  if (!['complete', 'caller_limit', 'storage_cap'].includes(history.window)) issues.push('window')
  if (!Array.isArray(history.pages) || history.pages.length !== 2) issues.push('pages')
  if (history.refusals?.limitZero !== 400 || history.refusals?.limitMax !== 400) issues.push('limit_refusal')
  if (![400, 403, 404].includes(history.refusals?.unknown)) issues.push('unknown_refusal')
  return issues
}

/** A cross-schema upgrade must leave the old binary refusing the new database by schema, not assets. */
export function crossUpgradeIssues(cross) {
  if (!cross || typeof cross !== 'object') return ['missing']
  const issues = [], base = cross.baseline ?? {}
  if (!isSubstantive(base.buildId) || !Number.isSafeInteger(base.schema)) issues.push('baseline')
  if (!Number.isSafeInteger(cross.migratedSchema) || cross.migratedSchema <= base.schema) issues.push('schema_order')
  if (cross.status !== 'BLOCKED') issues.push('old_binary_admitted')
  if (!['daemon_start_failed', 'schema_unsupported', 'runtime_mismatch', 'state_schema_newer_than_binary'].includes(cross.code)) issues.push('wrong_reason')
  if (cross.code === 'release_artifact_missing') issues.push('wrong_reason')
  if (cross.dataSchema !== cross.migratedSchema) issues.push('data_changed')
  return issues
}

/** A shared install path is not ownership: another state's live instance must stay untouched. */
export function multiStateIssues(state) {
  if (!state || typeof state !== 'object') return ['missing']
  const issues = []
  const stop = state.stopOtherState ?? {}
  const dead = state.deadLauncher ?? {}
  if (stop.exit === 0 || stop.bAlive !== true || stop.bApiAlive !== true) issues.push('other_state_claimed')
  if (dead.status !== 'NOT_TESTED' && (dead.status !== 'UNVERIFIED' || dead.apiAliveBefore !== true)) issues.push('dead_launcher_window')
  return issues
}

/**
 * A private config root must initialize from the install's trusted release manifest. A manual copy
 * that makes doctor pass is evidence of the missing step, not evidence of a working first-run.
 */
export function configRootIssues(configRoot) {
  if (!configRoot || typeof configRoot !== 'object') return ['missing']
  const issues = []
  for (const role of ['baseline', 'target']) {
    const item = configRoot[role] ?? {}
    if (item.firstRun !== 'OK') issues.push(`${role}_first_run`)
    if (item.seeded !== 'PASS') issues.push(`${role}_seed_not_decisive`)
  }
  if (configRoot.target?.initialized !== 'PASS') issues.push('target_not_initialized')
  if (!['PASS', 'FAIL'].includes(configRoot.baselineHistorical)) issues.push('baseline_history')
  return issues
}

/**
 * The launcher must retain the fixture mode on reuse, refuse a personal request without an admitted
 * executor, and never adopt or signal a live process that is not the recorded instance.
 */
export function hostGuardIssues(guards) {
  if (!guards || typeof guards !== 'object') return ['missing']
  const issues = []
  if (guards.mode?.fixtureReused !== true) issues.push('mode_not_retained')
  if (!['author_executor_unavailable', 'author_executor_version_mismatch', 'instance_conflict'].includes(guards.mode?.personalRefused))
    issues.push('personal_not_refused')
  if (guards.mode?.existingUntouched !== true) issues.push('existing_instance_changed')
  if (!['instance_identity_mismatch', 'invalid_instance_record'].includes(guards.unknownPid?.startCode)) issues.push('unknown_pid_adopted')
  if (guards.unknownPid?.stopStatus === 0) issues.push('unknown_pid_stopped')
  if (guards.unknownPid?.alive !== true) issues.push('unknown_pid_killed')
  return issues
}

/**
 * A two-binary upgrade must move a real state forward, refuse the newer schema on the old binary
 * without deleting data, and keep an explicit restore clearly separate from a binary downgrade.
 */
export function upgradeIssues(upgrade) {
  if (!upgrade || typeof upgrade !== 'object') return ['missing']
  const issues = []
  const base = upgrade.baseline ?? upgrade.base ?? {}
  const next = upgrade.target ?? upgrade.upgrade ?? {}
  if (!isSubstantive(base.buildId) || !isSubstantive(next.buildId) || base.buildId === next.buildId) issues.push('distinct_builds')
  if (!HEX.test(String(base.tarSha256 ?? '')) || !HEX.test(String(next.tarSha256 ?? '')) || base.tarSha256 === next.tarSha256)
    issues.push('distinct_bytes')
  if (!Number.isSafeInteger(base.schema) || !Number.isSafeInteger(next.schema) || next.schema < base.schema) issues.push('schema_order')
  if (upgrade.status !== 'CONFIRMED') issues.push('switch_not_confirmed')
  if (upgrade.pointer?.afterUpgrade !== next.buildId) issues.push('pointer_not_target')
  if (upgrade.pointer?.afterRollback !== base.buildId) issues.push('pointer_not_reverted')
  if (!isSubstantive(upgrade.backup?.path)) issues.push('no_preupgrade_backup')
  if (!Number.isSafeInteger(upgrade.messages?.after) || !Number.isSafeInteger(upgrade.messages?.before) || upgrade.messages.after < upgrade.messages.before)
    issues.push('data_loss')
  if (upgrade.preDataReadable !== true) issues.push('pre_data_lost')
  if (upgrade.postUpgradeMessageKept !== true) issues.push('post_data_lost')
  if (upgrade.binaryRollback?.status !== 'BINARY_ROLLED_BACK' || upgrade.binaryRollback?.build !== base.buildId) issues.push('binary_rollback')
  if (upgrade.binaryRollback?.dataRolledBack !== false || upgrade.binaryRollback?.postDataKept !== true) issues.push('rollback_rolled_data')
  // Crash-window and whole-process guards are a separate NOT_TESTED case in this round; their
  // absence from a confirmed-switch probe is explicit, not a pass.
  if (upgrade.tampered?.code !== 'target_tampered' || upgrade.tampered?.instanceUntouched !== true) issues.push('tampered_target')
  const schema = upgrade.schemaRefusal ?? {}
  if (schema.applicable === false) {
    if (schema.reason !== 'same_schema') issues.push('schema_refusal_reason')
  } else if (schema.code !== 'daemon_start_failed' && schema.code !== 'schema_unsupported') issues.push('schema_refusal')
  return issues
}

/**
 * A work-evidence projection must bind the exact work, name its projection honestly, carry at most a
 * bounded window and never include another work's outcome.
 */
export function workEvidenceIssues(evidence) {
  if (!evidence || typeof evidence !== 'object') return ['missing']
  const issues = []
  if (evidence.protocol !== 'work-evidence/1') issues.push('protocol')
  if (!isSubstantive(evidence.workId)) issues.push('work_binding')
  if (!['recorded', 'source_missing', 'not_in_window', 'not_accepted'].includes(evidence.projection)) issues.push('projection')
  if (!Number.isSafeInteger(evidence.entries) || evidence.entries < 1) issues.push('no_entries')
  if (!Number.isSafeInteger(evidence.outcomes) || evidence.outcomes < 0) issues.push('outcome_count')
  if (evidence.truncated !== false && evidence.truncated !== true) issues.push('truncation')
  if (![400, 403, 404].includes(evidence.unknownWorkStatus)) issues.push('unknown_work_not_refused')
  return issues
}

/**
 * A recovery plan is diagnostics: it must carry no authority, must not write the restored state and
 * must refuse a stale fingerprint, a foreign project and every commit entry.
 */
export function recoveryPreflightIssues(preflight) {
  if (!preflight || typeof preflight !== 'object') return ['missing']
  const issues = []
  const inspection = preflight.inspection ?? {}
  const plan = preflight.plan ?? {}
  const refusals = preflight.refusals ?? {}
  const writes = preflight.writes ?? {}
  if (inspection.protocol !== 'recovery-inspection/1') issues.push('inspect_protocol')
  if (inspection.state !== 'recovery_readonly') issues.push('inspect_state')
  if (!HEX.test(String(inspection.markerDigest ?? ''))) issues.push('inspect_marker')
  if (!Array.isArray(inspection.blockerCodes) || !inspection.blockerCodes.includes('authorization_not_implemented'))
    issues.push('inspect_no_authority_blocker')
  if (plan.protocol !== 'recovery-plan/1') issues.push('plan_protocol')
  if (plan.authorization !== 'not_granted' || plan.commitAvailable !== false) issues.push('plan_claims_authority')
  if (!Array.isArray(plan.bindings) || plan.bindings.length === 0) issues.push('plan_no_bindings')
  else if (plan.bindings.some((binding) => !/^[a-f0-9]{40}$/.test(String(binding?.headCommit ?? '')))) issues.push('plan_binding_head')
  if (!Number.isSafeInteger(plan.ttlMs) || plan.ttlMs <= 0 || plan.ttlMs > 5 * 60 * 1000 + 5_000) issues.push('plan_ttl')
  if (JSON.stringify(writes.rowsBefore) !== JSON.stringify(writes.rowsAfter)) issues.push('prepare_wrote_rows')
  if (writes.markerUnchanged !== true) issues.push('prepare_wrote_marker')
  if (writes.bindingsUnsaved !== true) issues.push('prepare_saved_bindings')
  if (refusals.staleFingerprint !== 409) issues.push('stale_fingerprint_not_refused')
  if (refusals.foreignProject !== 403) issues.push('foreign_project_not_refused')
  if (![403, 404, 422].includes(refusals.commit)) issues.push('commit_not_refused')
  if (![403, 422].includes(refusals.normalPrepare)) issues.push('normal_prepare_not_refused')
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

  for (const id of ['E6-CURRENT-MAIN-INSTALL', 'E4-UPGRADE-FAULTS', 'E7-OWNERSHIP-COPY']) {
    const item = byId.get(id)
    if (item?.status !== STATUS.PASS) continue
    if (id === 'E6-CURRENT-MAIN-INSTALL') {
      const value = item.evidence?.currentInstall ?? {}
      if (value.observed !== 'RUNNING' || value.instanceMode !== 'personal' || value.mode !== 'personal') {
        failures.push(fail('current_install_failed', 'A current install PASS requires an actual RUNNING personal process', id))
      }
    }
    if (id === 'E7-OWNERSHIP-COPY') {
      const value = item.evidence?.ownershipCopy ?? {}
      if (!Number.isInteger(value.status) || value.status === 0 || !isSubstantive(value.code)) {
        failures.push(fail('ownership_copy_failed', 'Ownership copy PASS needs exit/code from the actual stop attempt', id))
      }
    }
    if (id === 'E4-UPGRADE-FAULTS') {
      const windows = item.evidence?.upgradeFaults?.windows ?? {}
      for (const mode of ['crash_after_stop', 'crash_after_stop_kill', 'target_unhealthy']) {
        const probe = windows[mode]?.probe
        if (!probe?.fault || !probe?.recover || probe?.dataKept !== true)
          failures.push(fail('upgrade_faults_failed', `Fault window ${mode} has no actual fault/recover/data result`, id))
      }
    }
  }

  // Every claimed installation/current-tuple case must describe the same frozen subject.
  const canonicalTuple = byId.get('E4-INSTALL-ARTIFACT-IDENTITY')?.evidence?.artifact?.tuple?.target
  if (canonicalTuple) {
    // Every required installed case, not a chosen subset, must describe the tested tuple. The
    // canonical identity case is the reference itself.
    const subjectCases = INSTALL_CASES.map(entry => entry.id).filter(id => id !== 'E4-INSTALL-ARTIFACT-IDENTITY')
    const normalize = (value, key) => key === 'source' ? (value?.source ?? value?.sourceCommit)
      : key === 'schema' ? (value?.schema ?? value?.productSchema) : value?.[key]
    for (const id of subjectCases) {
      const item = byId.get(id)
      if (!item) continue
      const subject = item.evidence?.subject ?? item.evidence?.frozenScope?.artifact ??
        item.evidence?.currentInstall?.subject ?? item.evidence?.upgradeFaults?.subject ??
        item.evidence?.ownershipCopy?.subject ?? item.evidence?.installedContext?.subject ??
        item.evidence?.backupContextReply?.subject ?? item.evidence?.ownershipMocks?.subject ??
        item.evidence?.installedCandidates?.subject ?? item.evidence?.secondRoot?.subject ??
        item.evidence?.installedSourceConfirm?.subject ?? item.evidence?.installedStability?.subject ??
        item.evidence?.workflowFormats?.subject ?? item.evidence?.personalReview?.subject ??
        item.evidence?.restoredReviewRefusals?.subject ?? item.evidence?.reviewReuse?.subject ??
        item.evidence?.scopeDiagnostics?.subject ?? item.evidence?.readiness?.subject ?? item.evidence?.trialUi?.subject
      if (!subject || typeof subject !== 'object') {
        failures.push(fail('subject_missing', `Case ${id} has no frozen artifact subject`, id))
        continue
      }
      for (const field of ['source', 'buildId', 'schema', 'tarSha256', 'tarBytes', 'abi', 'platform', 'arch']) {
        if (String(normalize(subject, field) ?? '') !== String(normalize(canonicalTuple, field) ?? ''))
          failures.push(fail('subject_mismatch', `Case ${id} ${field} differs from the tested artifact tuple`, id))
      }
    }
  }

  // The digest capability of the review package must agree with the capability recorded from the same
  // package bytes by the format case; one evidence file cannot downgrade a supporting package alone.
  const reuseEvidence = byId.get('E5-REVIEW-REUSE-CONSISTENCY')?.evidence?.reviewReuse
  const formatCapability = byId.get('E5-WORKFLOW-FORMATS')?.evidence?.workflowFormats?.packageCapabilities
  if (reuseEvidence?.packageCapability && formatCapability) {
    for (const field of ['source', 'buildId', 'tarSha256', 'digestSupported']) {
      if (String(reuseEvidence.packageCapability[field] ?? '') !== String(formatCapability[field] ?? ''))
        failures.push(fail('capability_mismatch', `Review package capability ${field} disagrees with the package-bytes fact`, 'E5-REVIEW-REUSE-CONSISTENCY'))
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
      if (entry.evidence?.includes('evidenceHistory')) {
        for (const issue of evidenceHistoryIssues(result.evidence?.evidenceHistory))
          failures.push(fail('evidence_history_invalid', `Evidence history ${issue}`, entry.id))
      }
      for (const [key, fn] of [['contextUse', contextUseIssues], ['sse', contextSseIssues], ['guards', contextGuardIssues], ['sourceConfirm', sourceConfirmIssues], ['sourceConfirmRefusal', sourceConfirmRefusalIssues], ['candidateFlow', candidateFlowIssues], ['history', contextHistoryIssues], ['sources', contextSourcesIssues], ['contextUi', contextUiIssues], ['concurrency', concurrencyIssues], ['schemaMigration', schemaMigrationIssues], ['legacyMigration', legacyMigrationIssues], ['frozenScope', frozenScopeIssues], ['ownershipCopy', ownershipCopyIssues], ['ownershipMocks', ownershipMocksIssues], ['installedCandidates', installedCandidatesIssues], ['secondRoot', secondRootIssues], ['workflowFormats', workflowFormatsIssues], ['personalReview', personalReviewIssues], ['restoredReviewRefusals', restoredReviewRefusalsIssues], ['reviewReuse', reviewReuseIssues], ['scopeDiagnostics', scopeDiagnosticsIssues], ['readiness', readinessIssues], ['trialUi', trialUiIssues],
      ['packagedStop', packagedStopIssues], ['lifecycleOwn', lifecycleOwnIssues], ['lifecycleWrongStart', lifecycleWrongStartIssues], ['lifecycleSibling', lifecycleSiblingIssues],
      ['lifecycleForeignChild', lifecycleForeignChildIssues], ['lifecycleMixedUnknown', lifecycleMixedUnknownIssues],
      ['lifecycleStartWindow', lifecycleStartWindowIssues], ['lifecycleRefusedStop', lifecycleRefusedStopIssues],
      ['lifecycleIdempotent', lifecycleIdempotentIssues], ['installedSourceConfirm', installedSourceConfirmIssues], ['installedStability', installedStabilityIssues], ['upgradeFaults', upgradeFaultsIssues], ['currentInstall', currentInstallIssues], ['installedContext', installedContextIssues], ['backupContextReply', backupContextReplyIssues], ['replyDurable', replyDurableIssues], ['replyUnknown', replyUnknownIssues], ['replyMessageWindow', replyWindowIssues], ['replyBadArtifact', replyBadArtifactIssues], ['completedReply', completedReplyIssues], ['unknownReply', unknownReplyIssues]]) {
        if (entry.evidence?.includes(key)) {
          for (const issue of fn(result.evidence?.[key]))
            failures.push(fail(key === 'ownershipMocks' ? (OWNERSHIP_ISSUE_CODES[issue] ?? 'ownershipMocks_invalid') : `${key}_invalid`, `${key} ${issue}`, entry.id))
        }
      }
      if (entry.evidence?.includes('personalInstall')) {
        for (const issue of personalInstallIssues(result.evidence?.personalInstall))
          failures.push(fail('personal_install_invalid', `Personal install ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('contextPreview')) {
        for (const issue of contextPreviewIssues(result.evidence?.contextPreview))
          failures.push(fail('context_preview_invalid', `Context preview ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('proposalUi')) {
        for (const issue of proposalUiIssues(result.evidence?.proposalUi))
          failures.push(fail('proposal_ui_invalid', `Proposal UI ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('proposals')) {
        for (const issue of proposalFlowIssues(result.evidence?.proposals))
          failures.push(fail('proposal_flow_invalid', `Proposal flow ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('configRoot')) {
        for (const issue of configRootIssues(result.evidence?.configRoot))
          failures.push(fail('config_root_invalid', `Config root ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('hostGuards')) {
        for (const issue of hostGuardIssues(result.evidence?.hostGuards))
          failures.push(fail('host_guard_invalid', `Host guard ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('multiState')) {
        for (const issue of multiStateIssues(result.evidence?.multiState))
          failures.push(fail('multi_state_invalid', `Multi-state ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('crossUpgrade')) {
        for (const issue of crossUpgradeIssues(result.evidence?.crossUpgrade))
          failures.push(fail('cross_upgrade_invalid', `Cross-schema upgrade ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('upgrade')) {
        for (const issue of upgradeIssues(result.evidence?.upgrade))
          failures.push(fail('upgrade_evidence_invalid', `Upgrade proof ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('workEvidence')) {
        for (const issue of workEvidenceIssues(result.evidence?.workEvidence))
          failures.push(fail('work_evidence_invalid', `Work evidence ${issue}`, entry.id))
      }
      if (entry.evidence?.includes('recoveryPreflight')) {
        for (const issue of recoveryPreflightIssues(result.evidence?.recoveryPreflight))
          failures.push(fail('recovery_preflight_invalid', `Recovery preflight ${issue}`, entry.id))
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
      if (entry.evidence?.includes('decisionWorkflow')) {
        for (const issue of decisionFlowIssues(result.evidence?.decisionWorkflow))
          failures.push(fail('decision_workflow_invalid', `Decision workflow ${issue}`, entry.id))
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

  // A claim without a tier is universal and always checked. A claim for a different tier is not a
  // claim about this one, so its contradictions are already reported by the specific failures.
  const claimScope = report.claim?.tier
  if (
    report.claim?.status === STATUS.PASS &&
    failures.length > 0 &&
    (claimScope === undefined || claimScope === requirement?.tier)
  )
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
