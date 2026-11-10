#!/usr/bin/env node
/**
 * Deterministically materialises the eight synthetic pilot candidates and their hidden oracle.
 * The cases are NOT a measured native author failure rate: four contain a deliberately seeded
 * defect that the visible tests encode, and the hidden tests verify the oracle.
 *
 * `--check` verifies the committed files match this generator without rewriting them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = new Set(process.argv.slice(2))
const check = args.has('--check')

const CASES = [
  {
    id: 'case-01',
    defective: true,
    title: 'Range totals',
    task: 'Existing utility `sumRange(start, end)` must total every integer from start to end inclusive. Add `sumRangeStep(start, end, step)` that also accepts a positive step. Keep the existing tests passing.',
    files: {
      'src/index.js': `export function sumRange(start, end) {
  let total = 0
  for (let value = start; value < end; value += 1) total += value
  return total
}
`,
      'src/feature.js': `import { sumRange } from './index.js'

export function sumRangeStep(start, end, step) {
  let total = 0
  for (let value = start; value <= end; value += step) total += sumRange(value, value + 1)
  return total
}
`,
      'test/index.test.js': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sumRange } from '../src/index.js'

test('sums a small range', () => {
  assert.equal(sumRange(2, 4), 5)
})
`,
    },
    hidden: {
      'case-01.test.mjs': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sumRange } from '../cases/case-01/src/index.js'

test('inclusive range includes both ends', () => {
  assert.equal(sumRange(1, 5), 15)
  assert.equal(sumRange(2, 4), 9)
})
`,
    },
    oracle: { path: 'src/index.js', line: 3, keywords: ['off-by-one', 'inclusive', 'exclusive', 'range', 'end'] },
  },
  {
    id: 'case-02',
    defective: false,
    title: 'Slug helper',
    task: 'Existing `slugify(text)` must lowercase, trim, collapse runs of non-alphanumerics to one hyphen and strip edge hyphens. Add `slugifyPath(path)` that slugifies each segment and joins with `/`. Keep the existing tests passing.',
    files: {
      'src/index.js': `export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
`,
      'src/feature.js': `import { slugify } from './index.js'

export function slugifyPath(path) {
  return String(path)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => slugify(segment))
    .join('/')
}
`,
      'test/index.test.js': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slugify } from '../src/index.js'

test('normalises a title', () => {
  assert.equal(slugify('  Hello, World! '), 'hello-world')
})
`,
    },
    hidden: {
      'case-02.test.mjs': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slugify } from '../cases/case-02/src/index.js'

test('collapses and trims separators', () => {
  assert.equal(slugify('--A  B--'), 'a-b')
  assert.equal(slugify('***'), '')
})
`,
    },
    oracle: null,
  },
  {
    id: 'case-03',
    defective: true,
    title: 'Port parser',
    task: 'Existing `parsePort(value)` must accept a decimal integer string from 1 to 65535 and reject everything else with `RangeError`. Add `parsePorts(list)` that parses comma-separated ports. Keep the existing tests passing.',
    files: {
      'src/index.js': `export function parsePort(value) {
  const port = Number(value)
  if (port < 0) throw new RangeError('port must be positive')
  return port
}
`,
      'src/feature.js': `import { parsePort } from './index.js'

export function parsePorts(list) {
  return String(list)
    .split(',')
    .map((item) => parsePort(item.trim()))
}
`,
      'test/index.test.js': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePort } from '../src/index.js'

test('parses a normal port', () => {
  assert.equal(parsePort('8080'), 8080)
})
`,
    },
    hidden: {
      'case-03.test.mjs': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePort } from '../cases/case-03/src/index.js'

test('rejects non-numeric, zero and out-of-range values', () => {
  for (const value of ['abc', '', '0', '65536', '1.5']) {
    assert.throws(() => parsePort(value), RangeError, value)
  }
})
`,
    },
    oracle: { path: 'src/index.js', line: 3, keywords: ['nan', 'range', '65535', 'validation', 'integer'] },
  },
  {
    id: 'case-04',
    defective: false,
    title: 'Clamp helper',
    task: 'Existing `clamp(value, min, max)` must return min when value is below min, max when above max, and value otherwise, throwing RangeError when min > max. Add `clampPercent(value)`. Keep the existing tests passing.',
    files: {
      'src/index.js': `export function clamp(value, min, max) {
  if (min > max) throw new RangeError('min must not exceed max')
  if (value < min) return min
  if (value > max) return max
  return value
}
`,
      'src/feature.js': `import { clamp } from './index.js'

export function clampPercent(value) {
  return clamp(value, 0, 100)
}
`,
      'test/index.test.js': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clamp } from '../src/index.js'

test('clamps both directions', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-1, 0, 10), 0)
  assert.equal(clamp(11, 0, 10), 10)
})
`,
    },
    hidden: {
      'case-04.test.mjs': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clamp } from '../cases/case-04/src/index.js'

test('rejects an inverted range', () => {
  assert.throws(() => clamp(1, 10, 0), RangeError)
})
`,
    },
    oracle: null,
  },
  {
    id: 'case-05',
    defective: true,
    title: 'Palindrome check',
    task: 'Existing `isPalindrome(text)` must ignore case, spaces and punctuation. Add `isPalindromeNumber(value)`. Keep the existing tests passing.',
    files: {
      'src/index.js': `export function isPalindrome(text) {
  const cleaned = String(text).replace(/\\s+/g, '')
  return cleaned === [...cleaned].reverse().join('')
}
`,
      'src/feature.js': `import { isPalindrome } from './index.js'

export function isPalindromeNumber(value) {
  return isPalindrome(String(value))
}
`,
      'test/index.test.js': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPalindrome } from '../src/index.js'

test('accepts a simple palindrome', () => {
  assert.equal(isPalindrome('racecar'), true)
})
`,
    },
    hidden: {
      'case-05.test.mjs': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPalindrome } from '../cases/case-05/src/index.js'

test('ignores case and punctuation', () => {
  assert.equal(isPalindrome('A man, a plan, a canal: Panama'), true)
  assert.equal(isPalindrome('No lemon, no melon'), true)
})
`,
    },
    oracle: { path: 'src/index.js', line: 2, keywords: ['case', 'lowercase', 'punct', 'normal', 'regex'] },
  },
  {
    id: 'case-06',
    defective: false,
    title: 'Chunk helper',
    task: 'Existing `chunk(values, size)` must split an array into arrays of at most size items, throw RangeError for size < 1 and preserve order. Add `chunkString(text, size)`. Keep the existing tests passing.',
    files: {
      'src/index.js': `export function chunk(values, size) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('size must be a positive integer')
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
`,
      'src/feature.js': `import { chunk } from './index.js'

export function chunkString(text, size) {
  return chunk([...String(text)], size).map((items) => items.join(''))
}
`,
      'test/index.test.js': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunk } from '../src/index.js'

test('chunks without losing items', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})
`,
    },
    hidden: {
      'case-06.test.mjs': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunk } from '../cases/case-06/src/index.js'

test('rejects invalid sizes', () => {
  assert.throws(() => chunk([1], 0), RangeError)
  assert.throws(() => chunk([1], 1.5), RangeError)
})
`,
    },
    oracle: null,
  },
  {
    id: 'case-07',
    defective: true,
    title: 'Retry backoff',
    task: 'Existing `retryDelay(attempt)` must return exponential backoff: 1000ms for attempt 1, doubling each attempt, capped at 30000ms, and throwing RangeError for attempt < 1. Add `retryPlan(attempts)`. Keep the existing tests passing.',
    files: {
      'src/index.js': `export function retryDelay(attempt) {
  if (attempt < 1) throw new RangeError('attempt must be positive')
  return 1000 * attempt
}
`,
      'src/feature.js': `import { retryDelay } from './index.js'

export function retryPlan(attempts) {
  return Array.from({ length: attempts }, (_, index) => retryDelay(index + 1))
}
`,
      'test/index.test.js': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retryDelay } from '../src/index.js'

test('starts at one second', () => {
  assert.equal(retryDelay(1), 1000)
})
`,
    },
    hidden: {
      'case-07.test.mjs': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retryDelay } from '../cases/case-07/src/index.js'

test('doubles and caps', () => {
  assert.deepEqual([1, 2, 3].map(retryDelay), [1000, 2000, 4000])
  assert.equal(retryDelay(10), 30000)
})
`,
    },
    oracle: { path: 'src/index.js', line: 3, keywords: ['exponential', 'double', 'cap', 'backoff', '30000'] },
  },
  {
    id: 'case-08',
    defective: false,
    title: 'Byte formatter',
    task: 'Existing `formatBytes(value)` must format non-negative integer byte counts with binary units and one decimal place, throwing RangeError for negative or non-finite input. Add `formatBytesRange`. Keep the existing tests passing.',
    files: {
      'src/index.js': `export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('bytes must be non-negative')
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return unit === 0 ? \`\${amount} B\` : \`\${amount.toFixed(1)} \${units[unit]}\`
}
`,
      'src/feature.js': `import { formatBytes } from './index.js'

export function formatBytesRange(from, to) {
  return \`\${formatBytes(from)} – \${formatBytes(to)}\`
}
`,
      'test/index.test.js': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatBytes } from '../src/index.js'

test('formats basic sizes', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KiB')
})
`,
    },
    hidden: {
      'case-08.test.mjs': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatBytes } from '../cases/case-08/src/index.js'

test('rejects invalid input', () => {
  assert.throws(() => formatBytes(-1), RangeError)
  assert.throws(() => formatBytes(Number.NaN), RangeError)
})
`,
    },
    oracle: null,
  },
]

const basePackage = {
  name: 'pilot-candidate',
  private: true,
  type: 'module',
  scripts: { test: 'node --test test/*.test.js' },
}

let changed = 0
for (const entry of CASES) {
  const directory = join(here, 'cases', entry.id)
  const files = {
    'package.json': JSON.stringify(basePackage, null, 2) + '\n',
    'task.md': `# ${entry.title}\n\n${entry.task}\n\nVisible tests must keep passing. Implement the requested addition in \`src/feature.js\`.\n`,
    ...entry.files,
  }
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, name)
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== content) throw new Error(`case file differs: ${path}`)
    } else {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
      changed += 1
    }
  }
  for (const [name, content] of Object.entries(entry.hidden)) {
    const path = join(here, 'hidden', name)
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== content) throw new Error(`hidden file differs: ${path}`)
    } else {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
      changed += 1
    }
  }
}

const oracle = {
  protocol: 'review-pilot-oracle/1',
  note: 'Synthetic candidates. Four seeded defects are verified by hidden tests; this is not a measured native author failure rate.',
  cases: CASES.map((entry) => ({
    id: entry.id,
    defective: entry.defective,
    oracle: entry.oracle,
    visibleTask: `cases/${entry.id}/task.md`,
    hiddenTest: entry.hidden ? Object.keys(entry.hidden)[0] : null,
  })),
}
const oraclePath = join(here, 'oracle.json')
if (check) {
  if (!existsSync(oraclePath) || readFileSync(oraclePath, 'utf8') !== JSON.stringify(oracle, null, 2) + '\n')
    throw new Error('oracle differs')
} else {
  writeFileSync(oraclePath, JSON.stringify(oracle, null, 2) + '\n')
  changed += 1
}

process.stdout.write(
  `${check ? 'verified' : `wrote ${changed} files`}: ${CASES.length} cases, ${CASES.filter((item) => item.defective).length} seeded defects\n`,
)
export { CASES }
