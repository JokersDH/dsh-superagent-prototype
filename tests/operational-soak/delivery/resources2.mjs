/**
 * Wave-30 H3 external resource closure ledger.
 *
 * B/main own the real writer/coordinator lifetimes. This helper records only explicitly observed
 * resources (own probe, child, socket, fd, timer, waiter, queue row, journal, Runner) and answers one
 * question: is every known resource physically ended with evidence? `module.close` or a dead parent is
 * not quiescence, unknown material is never treated as ended, and a partial set is never complete.
 */
export const RESOURCE_KINDS = ['process', 'child', 'socket', 'fd', 'timer', 'waiter', 'queue', 'journal', 'runner']

export function evaluateResourceLedger({ resources, moduleClosed = false, parentPidGone = false }) {
  if (!Array.isArray(resources)) return { quiescent: false, reason: 'resources_missing', complete: false }
  const unknown = resources.filter((resource) => resource?.ended === 'unknown' || resource?.ended === undefined || resource?.ended === null)
  const live = resources.filter((resource) => resource?.ended === false)
  const missingEvidence = resources.filter((resource) => resource?.ended === true && (resource.evidence === undefined || resource.evidence === null || String(resource.evidence).length === 0))
  const badKind = resources.filter((resource) => !RESOURCE_KINDS.includes(resource?.kind))
  const duplicates = resources.length !== new Set(resources.map((resource) => `${resource?.kind}:${resource?.id}`)).size
  const quiescent = resources.length > 0 && unknown.length === 0 && live.length === 0 && missingEvidence.length === 0 && badKind.length === 0 && !duplicates
  return {
    quiescent,
    complete: true,
    counts: { total: resources.length, ended: resources.length - unknown.length - live.length, live: live.length, unknown: unknown.length, missingEvidence: missingEvidence.length },
    unknown: unknown.map((resource) => ({ kind: resource?.kind, id: resource?.id })),
    live: live.map((resource) => ({ kind: resource?.kind, id: resource?.id })),
    missingEvidence: missingEvidence.map((resource) => ({ kind: resource?.kind, id: resource?.id })),
    badKind: badKind.map((resource) => ({ kind: resource?.kind, id: resource?.id })),
    duplicates,
    moduleClosed, parentPidGone,
    reason: quiescent ? 'all_known_resources_ended' : unknown.length > 0 ? 'unknown_resource' : live.length > 0 ? 'live_resource' : missingEvidence.length > 0 ? 'ended_without_evidence' : badKind.length > 0 ? 'unknown_kind' : duplicates ? 'duplicate_resource' : 'empty_set',
    // Module close or parent exit is not evidence for the resources themselves.
    closeIsQuiescence: false,
  }
}

export function makeLedgerFixture(kind = 'full') {
  const base = RESOURCE_KINDS.map((name) => ({ kind: name, id: `fixture-${name}`, birth: 'fixture', peak: 1, ended: true, evidence: `fixture-end-${name}` }))
  if (kind === 'full') return { resources: base, moduleClosed: true, parentPidGone: true }
  const copy = structuredClone(base)
  if (kind === 'unknown') copy[2].ended = 'unknown'
  if (kind === 'live') copy[3].ended = false
  if (kind === 'no-evidence') delete copy[4].evidence
  if (kind === 'module-only') return { resources: [], moduleClosed: true, parentPidGone: true }
  return { resources: copy, moduleClosed: true, parentPidGone: true }
}
