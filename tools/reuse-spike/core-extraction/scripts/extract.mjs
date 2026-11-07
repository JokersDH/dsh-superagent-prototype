/**
 * G0-A provenance tool: materialize the upstream core slice from the fixed upstream commit
 * (`--write`), or verify that the committed copies still match that commit byte-for-byte
 * (default). Spike paths mirror upstream paths, so extracted files need no import changes.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SPIKE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = join(SPIKE_ROOT, 'source-manifest.json')
const UPSTREAM_COMMIT = '8c32a9dc5d72c033816c6a8110b37f40cf94fba4'
const UPSTREAM_REPOSITORY = 'https://github.com/deepseek-ai/dsh-superagent-prototype.git'
const WRITE = process.argv.includes('--write')

/** Repository-relative paths extracted verbatim from the upstream commit. */
const SOURCES = [
  'LICENSE',
  'src/core/assignments.ts',
  'src/core/engine.ts',
  'src/core/errors.ts',
  'src/core/evals.ts',
  'src/core/ids.ts',
  'src/core/index.ts',
  'src/core/intake.ts',
  'src/core/memory.ts',
  'src/core/model.ts',
  'src/core/part.ts',
  'src/core/ports.ts',
  'src/core/reasons.ts',
  'src/core/replies.ts',
  'src/core/stage.ts',
  'src/core/tickets.ts',
  'tests/core-engine.spec.ts',
  'tests/stage.spec.ts',
]
const MODIFICATION =
  'verbatim — byte-identical to the upstream commit; spike layout mirrors upstream paths, so imports stay unchanged'

const git = (args) => execFileSync('git', args, { cwd: SPIKE_ROOT })
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const upstreamBlob = (path) => git(['show', `${UPSTREAM_COMMIT}:${path}`])

function assertCommitPresent() {
  try {
    git(['cat-file', '-e', `${UPSTREAM_COMMIT}^{commit}`])
  } catch {
    console.error(`FAIL: upstream commit ${UPSTREAM_COMMIT} is not present in local git history`)
    process.exit(1)
  }
}

function write() {
  const files = []
  for (const path of SOURCES) {
    const blob = upstreamBlob(path)
    const target = join(SPIKE_ROOT, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, blob)
    files.push({ path, upstreamPath: path, sha256: sha256(blob), bytes: blob.length, modification: MODIFICATION })
  }
  const manifest = {
    schemaVersion: 1,
    purpose: 'G0-A isolated core extraction provenance',
    upstream: {
      commit: UPSTREAM_COMMIT,
      repository: UPSTREAM_REPOSITORY,
      license: 'MIT — Copyright (c) 2026 DeepSeek Harness Team (LICENSE copied verbatim)',
      extractedAt: new Date().toISOString(),
      extractionCommand: 'node scripts/extract.mjs --write',
      verificationCommand: 'node scripts/extract.mjs',
    },
    files,
    hostFiles: {
      note: 'Spike-owned test-host files, not extracted from upstream',
      paths: ['.gitignore', 'package.json', 'tsconfig.json', 'vitest.config.ts', 'scripts/extract.mjs', 'scripts/import-graph.mjs', 'README.md', 'report.md', 'reports/'],
    },
  }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${SOURCES.length} files from ${UPSTREAM_COMMIT} and regenerated source-manifest.json`)
}

function verify() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  if (manifest.upstream.commit !== UPSTREAM_COMMIT) {
    console.error(`FAIL: manifest records commit ${manifest.upstream.commit}, expected ${UPSTREAM_COMMIT}`)
    process.exit(1)
  }
  let failures = 0
  const rows = []
  for (const file of manifest.files) {
    const upstreamDigest = sha256(upstreamBlob(file.path))
    let diskDigest = 'missing'
    try {
      diskDigest = sha256(readFileSync(join(SPIKE_ROOT, file.path)))
    } catch { /* reported below */ }
    const ok = upstreamDigest === file.sha256 && diskDigest === file.sha256
    if (!ok) failures++
    rows.push({ path: file.path, ok, manifest: file.sha256, upstream: upstreamDigest, disk: diskDigest })
  }
  for (const row of rows) {
    console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.path}  sha256=${row.manifest}${row.ok ? '' : `  upstream=${row.upstream} disk=${row.disk}`}`)
  }
  console.log(`\n${rows.length - failures}/${rows.length} files verified byte-identical against upstream commit ${UPSTREAM_COMMIT}`)
  process.exit(failures ? 1 : 0)
}

assertCommitPresent()
if (WRITE) write()
else verify()
