/**
 * Wait for the original Work's `accept_candidate` action, not merely a currentCandidate.
 *
 * A candidate can appear while the Work is still verifying, and `actions.available` can initially be
 * empty or only contain stop/pause. Accepting early is a caller bug. This helper only observes; it
 * never sends accept and never writes state.
 */
export async function waitForAcceptableCandidate({ workId, readSnapshot, timeoutMs = 15000, pollMs = 150, now = () => Date.now(), sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)) }) {
  const deadline = now() + timeoutMs
  const observations = []
  let last = null
  let candidateSeen = false
  while (now() < deadline) {
    const snapshot = await readSnapshot()
    last = snapshot
    const work = (snapshot?.works ?? []).find((entry) => entry.work?.id === workId) ?? null
    if (work === null) {
      observations.push({ stage: 'work_absent', workId })
      await sleep(pollMs)
      continue
    }
    const candidate = work.actions?.currentCandidate ?? null
    const available = work.actions?.available
    if (candidate !== null) candidateSeen = true
    observations.push({ stage: 'observed', phase: work.phase, candidate: candidate !== null, available: Array.isArray(available) ? [...available] : null })
    if (work.phase === 'failed' || work.phase === 'blocked') return { status: 'blocked', work, candidate, candidateSeen, observations, last }
    if (candidate === null) { await sleep(pollMs); continue }
    if (candidate.contract?.workId !== work.work.id || !Array.isArray(available)) {
      return { status: 'refused', reason: candidate.contract?.workId !== work.work.id ? 'candidate_foreign_work' : 'available_missing', work, candidate, candidateSeen, observations, last }
    }
    if (available.includes('accept_candidate')) return { status: 'ready', work, candidate, candidateSeen, gateObserved: true, observations, last }
    // Candidate exists but the action has not appeared yet: keep waiting, including an empty array.
    await sleep(pollMs)
  }
  const work = (last?.works ?? []).find((entry) => entry.work?.id === workId) ?? null
  return { status: 'not_ready', work, candidate: work?.actions?.currentCandidate ?? null, candidateSeen, gateObserved: false, observations, last, reason: 'timeout_before_accept_action' }
}
