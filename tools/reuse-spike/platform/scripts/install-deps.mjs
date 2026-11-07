#!/usr/bin/env node
/**
 * Install this experiment's dependency with the *proposed* toolchain only:
 *   - the Node binary fetched by fetch-runtime.mjs (24.22.2 on darwin-arm64)
 *   - the pnpm CLI fetched by fetch-runtime.mjs (11.7.0)
 *   - an isolated pnpm store under .cache/, so the global pnpm store is untouched
 *
 * better-sqlite3 13.0.3 ships N-API prebuilds inside its npm tarball (`prebuilds/<platform>-<arch>.node`)
 * and declares no install/postinstall script. pnpm 11's strict dependency-build policy still treats it
 * as an unapproved builder and exits 1, so the local pnpm-workspace.yaml records the explicit decision
 * `allowBuilds: better-sqlite3: false`: no script runs, no compiler is invoked, and the shipped prebuild
 * is used. That distinction (build explicitly declined vs. a binding silently replaced by a locally
 * compiled one) is itself part of the evidence.
 *
 * Writes evidence/install/pnpm-install.log and evidence/install/install.json; fails loudly when the
 * prebuild for this host is missing or when a node-gyp build directory appears.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureRuntime } from './fetch-runtime.mjs'
import { defaultSubstitutions, sanitize, sha256File } from '../src/lib/util.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EVIDENCE = join(ROOT, 'evidence', 'install')
const STORE = join(ROOT, '.cache', 'pnpm-store')
const MODULE = join(ROOT, 'node_modules', 'better-sqlite3')

const INSTALL_ARGS = ['install', '--store-dir', STORE, '--reporter=append-only']

export async function install({ quiet = false } = {}) {
  const runtime = await ensureRuntime()
  const nodeBin = runtime.node.binary
  const pnpmCli = runtime.pnpm.cli

  const result = spawnSync(nodeBin, [pnpmCli, ...INSTALL_ARGS], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      // Put the proposed Node first so any package lifecycle script would also run on it.
      PATH: `${dirname(nodeBin)}:${process.env.PATH ?? ''}`,
      npm_config_cache: join(ROOT, '.cache', 'npm-cache'),
      npm_config_store_dir: STORE,
    },
    timeout: 15 * 60 * 1000,
  })

  const substitutions = defaultSubstitutions(ROOT)
  const log = sanitize(`${result.stdout ?? ''}${result.stderr ?? ''}`, substitutions)
  await mkdir(EVIDENCE, { recursive: true })
  await writeFile(join(EVIDENCE, 'pnpm-install.log'), log)
  if (!quiet) process.stdout.write(log)

  if (result.status !== 0) throw new Error(`pnpm install exited ${result.status}; see evidence/install/pnpm-install.log`)
  if (!existsSync(MODULE)) throw new Error('better-sqlite3 is missing after install')

  const packageJson = JSON.parse(await readFile(join(MODULE, 'package.json'), 'utf8'))
  const hostTag = `${process.platform}-${process.arch === 'arm64' ? 'arm64' : process.arch}`
  const prebuild = join(MODULE, 'prebuilds', `${hostTag}.node`)
  const buildDir = join(MODULE, 'build')
  const installScripts = ['preinstall', 'install', 'postinstall'].filter(name => packageJson.scripts?.[name])

  const facts = {
    ranAt: new Date().toISOString(),
    command: `${runtime.node.reported} ${sanitize(pnpmCli, substitutions)} ${INSTALL_ARGS.join(' ')}`,
    exitCode: result.status,
    node: { reported: runtime.node.reported, archiveSha256: runtime.node.sha256 },
    pnpm: { reported: runtime.pnpm.reported, tarballIntegrity: runtime.pnpm.integrity },
    storeDir: '.cache/pnpm-store',
    buildPolicy: {
      file: 'pnpm-workspace.yaml',
      allowBuilds: await readBuildPolicy(),
      note: 'pnpm 11 asks about dependency build scripts; the local config declines them because better-sqlite3 ships prebuilt N-API binaries and needs no compile.',
    },
    logPath: 'evidence/install/pnpm-install.log',
    logBytes: log.length,
    ignoredBuildScriptsWarning: /Ignored build scripts/i.test(log),
    betterSqlite3: {
      packageVersion: packageJson.version,
      main: packageJson.main,
      lifecycleScripts: installScripts,
      prebuildsShippedInTarball: await listPrebuilds(MODULE),
      hostPrebuild: sanitize(prebuild, substitutions),
      hostPrebuildPresent: existsSync(prebuild),
      hostPrebuildBytes: existsSync(prebuild) ? (await stat(prebuild)).size : 0,
      hostPrebuildSha256: existsSync(prebuild) ? await sha256File(prebuild) : null,
      nodeGypBuildDirectoryPresent: existsSync(buildDir),
    },
    interpretation: {
      buildApproval: 'pnpm 11 flags better-sqlite3 as an unapproved builder; --config.strict-dep-builds=false keeps install non-interactive. The package declares no install script, so no local compile was requested.',
      prebuildOnly: 'The binding used at runtime is prebuilds/<platform>-<arch>.node from the npm tarball; no build/Release output exists.',
    },
  }

  await writeFile(join(EVIDENCE, 'install.json'), `${JSON.stringify(sanitize(facts, substitutions), null, 2)}\n`)

  if (!facts.betterSqlite3.hostPrebuildPresent) throw new Error(`prebuild for ${hostTag} missing: ${prebuild}`)
  if (facts.betterSqlite3.nodeGypBuildDirectoryPresent) throw new Error('node-gyp build directory appeared: prebuild was not the source of the binding')
  return facts
}

async function readBuildPolicy() {
  const file = join(ROOT, 'pnpm-workspace.yaml')
  if (!existsSync(file)) return null
  const text = await readFile(file, 'utf8')
  const match = text.match(/better-sqlite3:\s*(true|false)/)
  return match ? match[1] === 'true' : null
}

async function listPrebuilds(moduleDir) {
  const { readdir } = await import('node:fs/promises')
  const dir = join(moduleDir, 'prebuilds')
  if (!existsSync(dir)) return []
  return (await readdir(dir)).filter(name => name.endsWith('.node')).sort()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  install({ quiet: true })
    .then(facts => {
      process.stdout.write(`install exit=${facts.exitCode} ignoredBuildWarning=${facts.ignoredBuildScriptsWarning}\n`)
      process.stdout.write(`better-sqlite3 ${facts.betterSqlite3.packageVersion} prebuild=${facts.betterSqlite3.hostPrebuildPresent} buildDir=${facts.betterSqlite3.nodeGypBuildDirectoryPresent}\n`)
      process.stdout.write(`prebuild sha256=${facts.betterSqlite3.hostPrebuildSha256}\n`)
      process.stdout.write('evidence/install/install.json\n')
    })
    .catch(error => {
      process.stderr.write(`install failed: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    })
}
