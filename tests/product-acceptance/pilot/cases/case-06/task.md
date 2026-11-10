# Chunk helper

Existing `chunk(values, size)` must split an array into arrays of at most size items, throw RangeError for size < 1 and preserve order. Add `chunkString(text, size)`. Keep the existing tests passing.

Visible tests must keep passing. Implement the requested addition in `src/feature.js`.
