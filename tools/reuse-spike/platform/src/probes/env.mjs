/**
 * Probe 1 — native load and engine admission (OPS-01).
 *
 * better-sqlite3 13.0.3 ships N-API prebuilds inside its npm tarball and exposes one subpath per
 * platform/arch (`better-sqlite3/darwin-arm64` → `prebuilds/darwin-arm64.node`). The package's
 * exports map blocks deep imports, so this probe proves the chain in three steps instead:
 *   1. the default import loads and answers `SELECT sqlite_version()`;
 *   2. the same prebuild file is opened explicitly through the `nativeBinding` option;
 *   3. no `build/` (node-gyp) directory exists, and the loader source prefers `prebuilds/`.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { release as osRelease, type as osType, version as osVersion } from 'node:os'
import Database from 'better-sqlite3'
import { atLeast, check, sha256File } from '../lib/util.mjs'

const require = createRequire(import.meta.url)
export const MIN_SQLITE = '3.51.3'
export const PROPOSED_NODE = '24.22.2'

const sha256 = text => createHash('sha256').update(text).digest('hex')

export async function run() {
  const checks = []
  const packageJson = require('better-sqlite3/package.json')
  const packageDir = dirname(require.resolve('better-sqlite3/package.json'))
  const hostTag = `${process.platform}-${process.arch}`
  const hostPrebuild = join(packageDir, 'prebuilds', `${hostTag}.node`)
  const buildDir = join(packageDir, 'build')
  const loaderSource = await readFile(join(packageDir, 'lib', 'binding.js'), 'utf8')

  const started = Date.now()
  const db = new Database(':memory:')
  const loadMs = Date.now() - started
  const engineVersion = db.prepare('SELECT sqlite_version() AS version').get().version
  const sourceId = db.prepare('SELECT sqlite_source_id() AS id').get().id
  const compileOptions = db.prepare('PRAGMA compile_options').all().map(row => row.compile_options)
  const defaultJournalMode = db.pragma('journal_mode', { simple: true })
  db.close()

  // Open the shipped prebuild explicitly; this is the positive control for "the prebuild is real".
  let prebuildVersion = null
  let prebuildError = null
  if (existsSync(hostPrebuild)) {
    try {
      const viaPrebuild = new Database(':memory:', { nativeBinding: hostPrebuild })
      prebuildVersion = viaPrebuild.prepare('SELECT sqlite_version() AS version').get().version
      viaPrebuild.close()
    } catch (error) {
      prebuildError = error instanceof Error ? error.message : String(error)
    }
  }

  const exactNode = process.version === `v${PROPOSED_NODE}`
  checks.push(check('OPS-01.native-load', true, `better-sqlite3 ${packageJson.version} opened a database in ${loadMs}ms`))
  checks.push(check('OPS-01.prebuild-file-shipped', existsSync(hostPrebuild), hostPrebuild))
  checks.push(
    check(
      'OPS-01.prebuild-loads-directly',
      prebuildVersion === engineVersion,
      prebuildError ?? `nativeBinding=${hostPrebuild} sqlite_version()=${prebuildVersion}`,
    ),
  )
  checks.push(
    check(
      'OPS-01.loader-prefers-prebuild',
      loaderSource.includes('prebuilds') && loaderSource.includes('build'),
      'lib/binding.js checks prebuilds/<platform>-<arch>.node before build/Debug|Release',
    ),
  )
  checks.push(check('OPS-01.no-local-compile', !existsSync(buildDir), `build directory present: ${existsSync(buildDir)}`))
  checks.push(check('OPS-01.sqlite-engine-admission', atLeast(engineVersion, MIN_SQLITE), `sqlite_version()=${engineVersion}, minimum ${MIN_SQLITE}`))
  checks.push(check('OPS-01.binding-pin', packageJson.version === '13.0.3', `better-sqlite3 ${packageJson.version}`))
  checks.push({
    id: 'OPS-01.node-proposed',
    status: exactNode ? 'PASS' : 'INFO',
    detail: `runtime ${process.version}; proposed v${PROPOSED_NODE}`,
  })

  const facts = {
    runtime: {
      node: process.version,
      execPath: process.execPath,
      platform: process.platform,
      arch: process.arch,
      napi: process.versions.napi,
      modules: process.versions.modules,
      v8: process.versions.v8,
      nodeBuiltinSqlite: process.versions.sqlite ?? null,
      os: { type: osType(), release: osRelease(), version: osVersion() },
    },
    binding: {
      package: 'better-sqlite3',
      version: packageJson.version,
      main: packageJson.main,
      hostPrebuild: hostPrebuild,
      hostPrebuildPresent: existsSync(hostPrebuild),
      hostPrebuildSha256: existsSync(hostPrebuild) ? await sha256File(hostPrebuild) : null,
      prebuildsShipped: await listPrebuilds(join(packageDir, 'prebuilds')),
      loaderSourceSha256: sha256(loaderSource),
      localBuildDirectoryPresent: existsSync(buildDir),
      loadMs,
    },
    sqlite: {
      version: engineVersion,
      sourceId,
      minimum: MIN_SQLITE,
      admissionSatisfied: atLeast(engineVersion, MIN_SQLITE),
      defaultJournalMode,
      compileOptions,
      compileOptionsSha256: sha256(compileOptions.join('\n')),
    },
    scope: {
      tested: `native load, explicit prebuild load and engine query on ${process.platform}/${process.arch} with Node ${process.version}`,
      notTested: 'other OS/arch combinations, a clean-machine install, and Windows/Linux runtime behaviour',
    },
  }

  return { id: 'env', ok: checks.every(item => item.status !== 'FAIL'), checks, facts }
}

async function listPrebuilds(dir) {
  if (!existsSync(dir)) return []
  const { readdir } = await import('node:fs/promises')
  return (await readdir(dir)).filter(name => name.endsWith('.node')).sort()
}
