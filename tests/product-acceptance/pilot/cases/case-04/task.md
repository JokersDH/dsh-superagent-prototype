# Clamp helper

Existing `clamp(value, min, max)` must return min when value is below min, max when above max, and value otherwise, throwing RangeError when min > max. Add `clampPercent(value)`. Keep the existing tests passing.

Visible tests must keep passing. Implement the requested addition in `src/feature.js`.
