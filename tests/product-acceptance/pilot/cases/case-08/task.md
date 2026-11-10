# Byte formatter

Existing `formatBytes(value)` must format non-negative integer byte counts with binary units and one decimal place, throwing RangeError for negative or non-finite input. Add `formatBytesRange`. Keep the existing tests passing.

Visible tests must keep passing. Implement the requested addition in `src/feature.js`.
