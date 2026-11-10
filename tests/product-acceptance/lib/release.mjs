import { STATUS, LAYERS } from './status.mjs'
import { isFresh } from './evidence.mjs'

export const REPORT_SCHEMA = 'product-acceptance/1'
export const RELEASE_SCHEMA = 'product-acceptance-release/1'

const HEX = /^[a-f0-9]{64}$/

const fail = (code, detail, caseId) => ({ code, detail, ...(caseId ? { caseId } : {}) })

function evidenceMissing(caseResult, keys) {
  const evidence = caseResult.evidence ?? {}
  return keys.filter((key) => {
    const value = evidence[key]
    if (value === undefined || value === null) return true
    if (typeof value === 'string') return value.length === 0
    return false
  })
}

/**
 * Fail-closed aggregation.
 *
 * A requirement is satisfied only by a case that ran here, passed, carried assertions, bound itself
 * to the same source commit, and supplied the evidence the requirement names. Everything else —
 * absence, unknown status, uncertain acceptance, unverified patch, unexecuted native, stale report,
 * mismatched fixture — becomes a named failure. There is no "mostly green".
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
  if (!report.source || !/^[0-9a-f]{40,64}$/.test(String(report.source.commit ?? '')))
    failures.push(fail('report_source_missing', 'Report has no bound source commit'))
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
    if (item.status === STATUS.PASS && item.source?.commit && item.source.commit !== report.source?.commit)
      failures.push(fail('stale_case_evidence', 'Case evidence binds a different source commit', item.id))

    const acceptance = item.evidence?.acceptance
    if (item.status === STATUS.PASS && acceptance?.uncertain === true)
      failures.push(fail('uncertain_acceptance', 'Acceptance was uncertain and must not be reported as PASS', item.id))
    if (item.status === STATUS.PASS && acceptance?.accepted === true && !acceptance?.candidateRef)
      failures.push(fail('missing_candidate', 'Acceptance claims a candidate it never recorded', item.id))
    if (item.status === STATUS.PASS && Number(item.evidence?.responses?.invalid ?? 0) > 0)
      failures.push(fail('invalid_response_tolerated', 'A case consumed an unknown/invalid response', item.id))

    const patch = item.evidence?.patch
    if (item.status === STATUS.PASS && patch) {
      if (!HEX.test(String(patch.sha256 ?? '')) || !HEX.test(String(patch.verifiedSha256 ?? '')))
        failures.push(fail('bad_patch', 'Patch digest is missing or malformed', item.id))
      else if (patch.sha256 !== patch.verifiedSha256)
        failures.push(fail('bad_patch', 'Recorded patch digest does not match the downloaded bytes', item.id))
      if (patch.apply?.ok === false) failures.push(fail('bad_patch', 'Patch did not apply to the baseline', item.id))
      if (patch.format && !['git-patch', 'unified-diff'].includes(patch.format))
        failures.push(fail('bad_patch', `Unknown patch format ${String(patch.format)}`, item.id))
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
    if (entry.layers && !entry.layers.includes(result.layer))
      failures.push(fail('layer_not_allowed', `Case ${entry.id} ran as ${result.layer}, expected ${entry.layers.join('|')}`, entry.id))
    for (const key of evidenceMissing(result, entry.evidence ?? []))
      failures.push(fail('required_evidence_missing', `Case ${entry.id} lacks evidence.${key}`, entry.id))
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
      'Controlled fixture and SDK mock evidence never substitute for actual-native execution.',
      'A NOT_TESTED or BLOCKED gap is honest only when the release claim excludes that capability.',
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
