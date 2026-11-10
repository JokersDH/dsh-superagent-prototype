import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export const PILOT_CAPS = Object.freeze({
  maxTotalTurnStarts: 24,
  maxAuthorTurnStarts: 8,
  maxReviewTurnStarts: 16,
  maxTotalBillableTokens: 200000,
  maxTotalCostUSD: 5,
})

export const ARMS = Object.freeze(['no_review', 'same_session_self_review', 'fresh_session_review'])

const lower = (value) => String(value ?? '').toLowerCase()

/** Blind matching rule, fixed before any model call in score.mjs and hashed by freeze.mjs. */
export function isDetected(oracle, report) {
  if (!report || !Array.isArray(report.findings)) return false
  return report.findings.some(
    (finding) =>
      finding?.path === oracle.path &&
      (finding.line === undefined || oracle.line === undefined || Math.abs(finding.line - oracle.line) <= 5) &&
      oracle.keywords.some((keyword) => lower(finding.claim).includes(lower(keyword))),
  )
}

export function hasFalsePositive(report) {
  if (!report) return false
  if (report.disposition === 'inconclusive') return false
  return Array.isArray(report.findings) && report.findings.length > 0
}

function refuse(code, detail) {
  return { code, detail }
}

/**
 * Deterministic, fail-closed pilot scoring. It refuses to produce a promising/no-go verdict when the
 * inputs are incomplete, budgets differ, usage is unbounded, cases were swapped, a report reuses a
 * different subject, or the scoring standards changed after freezing.
 */
export function scorePilot({ manifest, oracle, arms, budgets = {}, usage }) {
  const refusals = []
  const oracleDigest = sha256(Buffer.from(JSON.stringify(oracle, null, 2) + '\n'))
  if (!manifest) refusals.push(refuse('missing_manifest', 'No frozen case manifest'))
  if (manifest && oracleDigest !== manifest.oracleDigest)
    refusals.push(refuse('oracle_changed', 'Oracle bytes differ from the frozen digest'))
  const scoringDigest = sha256(readFileSync(new URL('./score.mjs', import.meta.url)))
  if (manifest && scoringDigest !== manifest.scoringRuleDigest)
    refusals.push(refuse('scoring_changed', 'Scoring rules differ from the frozen digest'))

  const caseIds = (oracle?.cases ?? []).map((item) => item.id).sort()
  if (caseIds.length !== 8) refusals.push(refuse('case_count', `Expected 8 cases, found ${caseIds.length}`))
  const defective = (oracle?.cases ?? []).filter((item) => item.defective)
  if (defective.length !== 4 || caseIds.length === 8 && oracle.cases.filter((item) => !item.defective).length !== 4)
    refusals.push(refuse('case_mix', 'Expected 4 defective and 4 clean cases'))

  const budgetSignature = (arm) => {
    const budget = budgets[arm] ?? {}
    return JSON.stringify([
      budget.model,
      budget.version,
      budget.tools,
      budget.timeoutMs,
      budget.maxTokens,
      budget.maxUSD,
      budget.historyInputTokens ?? null,
    ])
  }
  const signatures = ARMS.map(budgetSignature)
  if (new Set(signatures).size !== 1) refusals.push(refuse('budget_mismatch', 'Arms do not share the same ceilings'))

  const totals = { turns: 0, tokens: 0, costUSD: 0, unknown: 0 }
  const scored = { no_review: null, same_session_self_review: null, fresh_session_review: null }

  for (const arm of ARMS) {
    const entry = arms?.[arm]
    if (!entry) {
      refusals.push(refuse('missing_arm', `Arm ${arm} is missing`))
      continue
    }
    const expectedReports = arm === 'no_review' ? 0 : 8
    const reports = entry.reports ?? {}
    const keys = Object.keys(reports).sort()
    if (keys.length !== expectedReports)
      refusals.push(refuse('selective_cases', `Arm ${arm} has ${keys.length} reports, expected ${expectedReports}`))
    if (expectedReports > 0 && keys.some((id) => !caseIds.includes(id)))
      refusals.push(refuse('unknown_case', `Arm ${arm} contains an unknown case`))

    const turnKey = arm === 'no_review' ? 0 : 8
    totals.turns += Number(entry.turnStarts ?? 0)
    if (arm !== 'no_review' && Number(entry.turnStarts ?? 0) !== turnKey)
      refusals.push(refuse('turn_count', `Arm ${arm} has ${entry.turnStarts} turns, expected ${turnKey}`))

    const usageEntry = usage?.[arm] ?? {}
    if (arm !== 'no_review') {
      if (usageEntry.completeness !== 'observed' || !Number.isSafeInteger(usageEntry.tokens) || usageEntry.tokens < 0)
        refusals.push(refuse('unbounded_usage', `Arm ${arm} has no observed bounded usage`))
      else totals.tokens += usageEntry.tokens
      if (!(typeof usageEntry.usd === 'number' && usageEntry.usd >= 0))
        refusals.push(refuse('unbounded_cost', `Arm ${arm} has no bounded USD cost`))
      else totals.costUSD += usageEntry.usd
      if (Number.isSafeInteger(usageEntry.unknownTurns) && usageEntry.unknownTurns > 0) totals.unknown += usageEntry.unknownTurns
    }

    if (arm !== 'no_review') {
      for (const id of keys) {
        const report = reports[id]
        const subjectDigest = (oracle.cases.find((item) => item.id === id) ?? {}).subjectDigest
        if (subjectDigest && report?.subjectDigest !== subjectDigest)
          refusals.push(refuse('wrong_subject', `Arm ${arm} case ${id} reports another subject`))
        if (report?.verdict !== undefined || report?.accepted !== undefined)
          refusals.push(refuse('review_claims_authority', `Arm ${arm} case ${id} claims verification or acceptance`))
      }
      const detected = defective.filter((item) => isDetected(item.oracle, reports[item.id])).length
      const falsePositives = (oracle.cases ?? [])
        .filter((item) => !item.defective)
        .filter((item) => hasFalsePositive(reports[item.id])).length
      scored[arm] = { detected, missed: defective.length - detected, falsePositives }
    } else scored[arm] = { detected: 0, missed: defective.length, falsePositives: 0, note: 'no additional review' }
  }

  if (totals.turns > PILOT_CAPS.maxTotalTurnStarts) refusals.push(refuse('turn_cap', 'Turn ceiling exceeded'))
  if (totals.tokens > PILOT_CAPS.maxTotalBillableTokens) refusals.push(refuse('token_cap', 'Token ceiling exceeded'))
  if (totals.costUSD > PILOT_CAPS.maxTotalCostUSD) refusals.push(refuse('cost_cap', 'USD ceiling exceeded'))

  let decision = 'inconclusive'
  let rationale
  if (refusals.length > 0) {
    rationale = `Invalid or incomplete pilot: ${refusals.map((item) => item.code).join(', ')}`
  } else {
    const self = scored.same_session_self_review
    const fresh = scored.fresh_session_review
    const promising = fresh.detected >= self.detected + 1 && fresh.falsePositives <= self.falsePositives && fresh.falsePositives <= 1
    decision = promising ? 'promising' : 'no_go_for_current_recipe'
    rationale = promising
      ? `Fresh review detected ${fresh.detected} vs self ${self.detected}; clean false positives ${fresh.falsePositives} vs ${self.falsePositives}.`
      : `Screening rule not met: fresh ${fresh.detected}/${self.detected} detections, false positives ${fresh.falsePositives}/${self.falsePositives}.`
  }

  return {
    schema: 'review-pilot-result/1',
    decision,
    rationale,
    refusals,
    totals,
    scored,
    caps: PILOT_CAPS,
    scope: 'Mechanism screening on eight synthetic cases; not statistical proof, product admission or a disproof of other protocols.',
  }
}
