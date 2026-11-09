import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const groups = [
  'apps/runner',
  'packages/drivers/codex-native',
  'packages/driver-kit',
  'packages/execution',
  'packages/testing',
  'packages/catalog',
  'packages/policy-preparation',
]
const files = groups.flatMap((group) =>
  readdirSync(join(root, group, 'test'))
    .filter((file) => file.endsWith('.test.ts'))
    .map((file) => `${group}/test/${file}`),
)
const sourceFiles = []
const visit = (directory) => {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (['node_modules', 'reports', 'dist'].includes(entry.name)) continue
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) visit(path)
    else if (entry.isFile() && /\.(?:ts|mjs|json)$/.test(path)) sourceFiles.push(path)
  }
}
for (const group of groups) visit(group)
const hash = createHash('sha256')
for (const file of sourceFiles.sort())
  hash
    .update(file)
    .update('\0')
    .update(readFileSync(join(root, file)))
const sourceHash = hash.digest('hex'),
  args = ['--test', '--test-concurrency=2', '--test-timeout=40000', ...files]
let output = '',
  status = 'PASS',
  tests = 0
try {
  output = execFileSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: '/tmp' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  tests = Number(/(?:ℹ\s*)?tests (\d+)/.exec(output)?.[1])
  assert.ok(tests >= 218)
  assert.doesNotMatch(output, /(?:ℹ\s*)?fail [1-9]/)
} catch (error) {
  status = 'FAIL'
  output = `${error.stdout ?? output}\n${error.stderr ?? ''}`
  throw error
} finally {
  const directory = join(root, 'apps/runner/reports/native-mvp')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'runtime-output.txt'), output)
  const report = {
    status,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceHash,
    sourceGroups: groups,
    sourceFiles: sourceFiles.length,
    testedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    tests,
    command: `TMPDIR=/tmp node --test --test-concurrency=2 --test-timeout=40000 ${groups.map((group) => `${group}/test/*.test.ts`).join(' ')}`,
    limitations: [
      'All model/protocol cases in this repeatable suite use fixtures; installed native safety has a separate zero-model probe',
      'Actual approval/clarification/steering model turns, power loss and cross-machine recovery remain NOT_TESTED',
    ],
  }
  writeFileSync(join(directory, 'runtime-regression.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
