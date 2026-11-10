# Port parser

Existing `parsePort(value)` must accept a decimal integer string from 1 to 65535 and reject everything else with `RangeError`. Add `parsePorts(list)` that parses comma-separated ports. Keep the existing tests passing.

Visible tests must keep passing. Implement the requested addition in `src/feature.js`.
