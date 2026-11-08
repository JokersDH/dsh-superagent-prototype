/** The wave-02 demo must keep passing: it is the package's end-to-end fixture evidence. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DEMO = fileURLToPath(new URL('../scripts/demo-wave02.ts', import.meta.url))

test('wave-02 demo runs the whole owned stack and reports PASS', () => {
  const output = execFileSync(process.execPath, [DEMO], { encoding: 'utf8', timeout: 90_000 })
  assert.match(output, /DEMO PASS/)
  assert.match(output, /PASS\s+catalog readiness/)
  assert.match(output, /PASS\s+runner ready/)
  assert.match(output, /PASS\s+replay sends facts only/)
  assert.match(output, /native|NOT_TESTED/i)
})
