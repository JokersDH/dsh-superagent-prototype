# Retry backoff

Existing `retryDelay(attempt)` must return exponential backoff: 1000ms for attempt 1, doubling each attempt, capped at 30000ms, and throwing RangeError for attempt < 1. Add `retryPlan(attempts)`. Keep the existing tests passing.

Visible tests must keep passing. Implement the requested addition in `src/feature.js`.
