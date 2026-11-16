/**
 * Pure coverage composition shared by the history tool and its tests. A missing, unknown or
 * unparsable upstream state must never be presented as a complete history: only an explicit
 * `complete` upstream plus a local window that ends at the last row is complete.
 */
export const SOURCE_STATES = ['complete', 'truncated', 'unknown']
export function normalizeSourceState(value) {
  return value === 'complete' || value === 'truncated' ? value : 'unknown'
}
export function composeHistoryWindow({ sourceState, total, offset, limit }) {
  const normalized = normalizeSourceState(sourceState)
  const available = Number.isInteger(total) && total >= 0 ? total : null
  const returned = available === null ? 0 : Math.max(0, Math.min(limit, available - offset))
  const localTruncated = available !== null && sourceState === 'complete' && offset + returned < available
  const state = normalized === 'truncated' ? 'truncated_source'
    : normalized === 'unknown' ? 'unknown'
    : localTruncated ? 'truncated_local' : 'complete'
  return {
    sourceState: normalized,
    state,
    complete: state === 'complete',
    offset,
    limit,
    returned,
    availableKnown: normalized === 'complete',
    available: normalized === 'complete' ? available : null,
    localTruncated,
    truncated: normalized === 'truncated' || localTruncated,
    ...(localTruncated && returned > 0 ? { nextOffset: offset + returned } : {}),
  }
}
