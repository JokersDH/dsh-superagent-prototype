/**
 * Wave-29 current selected-source binding.
 *
 * Defaults are the current checkouts, not an old head pin. The exact commit observed at run start is
 * recorded; consumed files must equal that commit's blob in the worktree, so an unrelated docs-only
 * HEAD advance does not invalidate a valid run, while any consumed-source change refuses.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export const ROOTS = {
  I: '/Users/hh/Desktop/joker/superagent-agent-i',
  B: '/Users/hh/Desktop/joker/superagent-agent-b',
  main: '/Users/hh/Desktop/joker/superagent-agent-h',
}

export const FILES = {
  I: {
    'apps/runner/src/attach-channel/attach.ts': '321738dae3b87e6ad7d235f52aaa65e6f63ab527',
    'apps/runner/src/attach-channel/coordinator-channel.ts': 'd1ef81eb9d51b24417645151440eb1e262c20546',
    'apps/runner/src/attach-channel/errors.ts': 'ec8ce909d0f30ab1d96488db56cdf3b6a4ab7f49',
    'apps/runner/src/attach-channel/index.ts': 'b26154f343634cb6c7536aa5cd5bcb7169e0b980',
    'packages/contracts/src/coordinator-channel.ts': 'cf451efe433b8f9140d992ccfb415df9cd74b92c',
    'packages/contracts/src/schemas.ts': '0eaafbf444c5ef099971fbc226c36a33002f983d',
    'packages/contracts/src/types.ts': '423043fe2b999a2e71e0dd3995c7d33f522144de',
  },
  B: {
    'apps/runner/src/attach-channel/attach.ts': '321738dae3b87e6ad7d235f52aaa65e6f63ab527',
    'apps/runner/src/attach-channel/coordinator-channel.ts': 'd1ef81eb9d51b24417645151440eb1e262c20546',
    'apps/runner/src/attach-channel/errors.ts': 'ec8ce909d0f30ab1d96488db56cdf3b6a4ab7f49',
    'apps/runner/src/attach-channel/index.ts': 'b26154f343634cb6c7536aa5cd5bcb7169e0b980',
    'apps/runner/src/runner-service.ts': '1e7f0bd0fb5f9a7a20c0b19edaf1dc99e2811c29',
    'apps/runner/src/business-attach.ts': '2f69fedf5b4a33343968b8cc8a0269598dacbc1f',
  },
  main: {
    'packages/contracts/src/coordinator-channel.ts': 'cf451efe433b8f9140d992ccfb415df9cd74b92c',
  },
}

export const BRANCHES = { I: 'codex/g5-coordinator-channel', B: 'codex/g1-runtime', main: 'codex/g4-trial-operations' }

function git(root, args, encoding = 'utf8') {
  return spawnSync('git', ['-C', root, ...args], { encoding })
}

export function currentHead(root) {
  const out = git(root, ['rev-parse', 'HEAD'])
  return out.status === 0 ? out.stdout.trim() : null
}

function currentBranch(root) {
  const out = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return out.status === 0 ? out.stdout.trim() : null
}

/** Bind one root at its current HEAD (or an explicit commit) and exact expected file blobs. */
export function bindCurrent({ role, root = ROOTS[role], commit = null, expectFiles = null }) {
  const issues = []
  let real
  try { real = realpathSync(resolve(root)) } catch { return { role, root, ok: false, issues: ['root_missing'], files: [], commit: null, head: null } }
  const info = lstatSync(real)
  if (!info.isDirectory() || info.isSymbolicLink()) issues.push('root_not_directory')
  const head = currentHead(real)
  const selected = commit ?? head
  const branch = currentBranch(real)
  if (head === null) issues.push('not_a_git_root')
  if (branch !== BRANCHES[role]) issues.push(`branch_mismatch:${branch}`)
  if (selected === null) issues.push('commit_missing')
  else {
    if (git(real, ['cat-file', '-e', `${selected}^{commit}`]).status !== 0) issues.push('commit_missing')
    else if (git(real, ['merge-base', '--is-ancestor', selected, head ?? selected]).status !== 0) issues.push('commit_not_ancestor')
  }
  const files = []
  const expectedMap = expectFiles ?? Object.fromEntries(Object.keys(FILES[role]).map((rel) => [rel, null]))
  for (const [rel, expectedBlob] of Object.entries(expectedMap)) {
    const absolute = resolve(real, rel)
    let fileInfo
    try { fileInfo = lstatSync(absolute) } catch { issues.push(`${rel}:missing`); continue }
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) { issues.push(`${rel}:not_regular`); continue }
    const commitBlob = git(real, ['rev-parse', `${selected}:${rel}`]).stdout?.trim() ?? null
    const commitBytes = spawnSync('git', ['-C', real, 'show', `${selected}:${rel}`], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }).stdout
    files.push({ rel, commitBlob, sha256: sha256(commitBytes), bytes: commitBytes.byteLength })
    if (expectedBlob !== null && commitBlob !== expectedBlob) issues.push(`${rel}:commit_blob_mismatch`)
  }
  let zod = null
  if (role === 'I' || role === 'B') {
    try {
      const manifest = JSON.parse(readFileSync(resolve(real, 'node_modules/zod/package.json'), 'utf8'))
      zod = { version: manifest.version }
    } catch { issues.push('zod_unreadable') }
  }
  return { role, root: real, branch, head, commit: selected, ok: issues.length === 0, issues, files, zod }
}

export function verifyCurrent(binding) {
  return bindCurrent({ role: binding.role, root: binding.root, commit: binding.commit })
}

export function importFrom(binding, rel) {
  return import(new URL(`file://${resolve(binding.root, rel)}`).href)
}


/**
 * Materialize exact committed source trees into a new root. This reads only git objects from the
 * owner root; it does not touch the owner's dirty worktree and is not a second implementation.
 */
export function materializeTree({ root, commit, paths, dest, nodeModulesFrom = null }) {
  mkdirSync(dest, { recursive: true, mode: 0o700 })
  const archive = spawnSync('git', ['-C', root, 'archive', '--format=tar', commit, '--', ...paths], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  if (archive.status !== 0) return { ok: false, issues: [`archive_failed:${String(archive.stderr).slice(0, 200)}`], dest, files: [] }
  const extract = spawnSync('tar', ['-x', '-C', dest], { input: archive.stdout, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  if (extract.status !== 0) return { ok: false, issues: ['extract_failed'], dest, files: [] }
  if (nodeModulesFrom !== null) {
    try { symlinkSync(nodeModulesFrom, join(dest, 'node_modules'), 'dir') } catch { /* existing link is fine */ }
  }
  return { ok: true, issues: [], dest, commit, bytes: archive.stdout.byteLength }
}

/** Re-hash the selected committed files in a materialized tree. */
export function verifyMaterializedTree(tree, files) {
  const issues = []
  const observed = []
  for (const [rel, expected] of Object.entries(files)) {
    try {
      const bytes = readFileSync(join(tree.dest, rel))
      observed.push({ rel, sha256: sha256(bytes), bytes: bytes.byteLength })
      if (sha256(bytes) !== expected) issues.push(`${rel}:materialized_sha256_mismatch`)
    } catch { issues.push(`${rel}:materialized_missing`) }
  }
  return { ok: issues.length === 0, issues, files: observed }
}
