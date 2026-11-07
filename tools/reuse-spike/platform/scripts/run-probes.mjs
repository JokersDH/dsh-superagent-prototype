#!/usr/bin/env node
/**
 * Run every probe under the Node binary that starts this script, and write machine-readable evidence.
 *
 *   node scripts/run-probes.mjs [--profile <name>] [--only env,tx,backup,crash]
 *
 * Evidence lands in evidence/<profile>/<probe>.json plus summary.json, with OS paths sanitised.
 * Probes use the OS temp directory; no database file is written inside the repository.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultSubstitutions, makeTempDir, sanitize } from '../src/lib/util.mjs'
import { run as runEnv } from '../src/probes/env.mjs'
import { run as runTx } from '../src/probes/tx.mjs'
import { run as runBackup } from '../src/probes/backup.mjs'
import { run as runCrash } from '../src/probes/crash.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROBES = { env: runEnv, tx: runTx, backup: runBackup, crash: runCrash }

function parseArgs(argv) {
  const options = { profile: `node-${process.version.replace(/^v/, '')}`, only: Object.keys(PROBES) }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--profile') options.profile = argv[++index]
    else if (argv[index] === '--only') options.only = argv[++index].split(',').map(item => item.trim()).filter(Boolean)
  }
  const unknown = options.only.filter(name => !(name in PROBES))
  if (unknown.length) throw new Error(`unknown probe(s): ${unknown.join(', ')}`)
  return options
}

function status(result) {
  return result.ok ? 'PASS' : 'FAIL'
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const substitutions = defaultSubstitutions(ROOT)
  const startedAt = new Date().toISOString()
  const workdir = await makeTempDir('g0b-probes-')
  const evidenceDir = join(ROOT, 'evidence', options.profile)
  await mkdir(evidenceDir, { recursive: true })

  const results = {}
  console.log(`profile=${options.profile} node=${process.version} exec=${sanitize(process.execPath, substitutions)}`)
  console.log(`workdir=<TMPDIR>${workdir.slice(workdir.lastIndexOf('/'))}`)
  console.log('')
  console.log('probe    check                                  result  detail')

  for (const name of options.only) {
    const dir = join(workdir, name)
    await mkdir(dir, { recursive: true })
    const result = await PROBES[name]({ dir })
    results[name] = result
    const saved = sanitize(
      {
        profile: options.profile,
        probe: name,
        ranAt: new Date().toISOString(),
        runtime: {
          node: process.version,
          execPath: process.execPath,
          platform: process.platform,
          arch: process.arch,
          napi: process.versions.napi,
        },
        ...result,
      },
      substitutions,
    )
    await writeFile(join(evidenceDir, `${name}.json`), `${JSON.stringify(saved, null, 2)}\n`)
    for (const item of result.checks) {
      console.log(`${name.padEnd(8)} ${item.id.padEnd(38)} ${item.status.padEnd(6)}  ${item.detail}`)
    }
  }

  const summary = {
    profile: options.profile,
    startedAt,
    finishedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      execPath: sanitize(process.execPath, substitutions),
      platform: process.platform,
      arch: process.arch,
      napi: process.versions.napi,
      nodeBuiltinSqlite: process.versions.sqlite ?? null,
    },
    workdir: sanitize(workdir, substitutions),
    probes: Object.fromEntries(
      Object.entries(results).map(([name, result]) => [
        name,
        {
          status: status(result),
          checks: result.checks.length,
          failed: result.checks.filter(item => item.status === 'FAIL').map(item => item.id),
        },
      ]),
    ),
    overall: Object.values(results).every(result => result.ok) ? 'PASS' : 'FAIL',
    evidenceDir: `evidence/${options.profile}`,
    limitations: [
      'Probe schemas are throwaway; they are not the product Store, migrations or Queue.',
      'Only this host OS/arch and the Node binary that ran the probes are covered.',
      'A schema export or an upstream test result is not native/product compatibility evidence.',
    ],
  }
  await writeFile(join(evidenceDir, 'summary.json'), `${JSON.stringify(sanitize(summary, substitutions), null, 2)}\n`)

  console.log('')
  console.log(`overall=${summary.overall}  evidence=${summary.evidenceDir}`)
  if (summary.overall !== 'PASS') process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`run-probes failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
