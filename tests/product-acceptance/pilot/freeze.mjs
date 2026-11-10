#!/usr/bin/env node
/**
 * Freezes the pilot inputs before any model call: protocol, all case files, hidden oracle tests,
 * oracle labels and the scoring-rule digest. `--check` verifies the committed manifest.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const protocolPath = join(root, 'tools/experiments/review-pilot-01/protocol.json')
const manifestPath = join(here, 'cases.manifest.json')
const check = process.argv.includes('--check')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const read = (path) => readFileSync(path)

function walk(directory) {
  const results = []
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name)
    const stat = statSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link is not allowed in frozen inputs: ${path}`)
    if (stat.isDirectory()) results.push(...walk(path))
    else if (stat.isFile()) results.push(path)
  }
  return results
}

const caseFiles = walk(join(here, 'cases'))
const hiddenFiles = walk(join(here, 'hidden'))
const oraclePath = join(here, 'oracle.json')
const scorePath = join(here, 'score.mjs')

const protocolBytes = read(protocolPath)
const oracleBytes = read(oraclePath)
const scoreBytes = read(scorePath)

const manifest = {
  schema: 'review-pilot-cases/1',
  protocolPath: relative(root, protocolPath),
  protocolDigest: sha256(protocolBytes),
  oracleDigest: sha256(oracleBytes),
  scoringRuleDigest: sha256(scoreBytes),
  armOrderSeed: sha256(Buffer.concat([protocolBytes, oracleBytes])).slice(0, 16),
  files: [...caseFiles, ...hiddenFiles, oraclePath].map((path) => ({
    path: relative(here, path),
    sha256: sha256(read(path)),
    bytes: statSync(path).size,
  })),
}
manifest.caseManifestDigest = sha256(Buffer.from(JSON.stringify(manifest.files)))
manifest.totalCases = 8
manifest.seededDefective = 4
manifest.clean = 4

const body = JSON.stringify(manifest, null, 2) + '\n'
if (check) {
  if (!existsSync(manifestPath)) throw new Error('cases.manifest.json is missing; run freeze.mjs')
  if (readFileSync(manifestPath, 'utf8') !== body) throw new Error('cases.manifest.json is stale; re-freeze')
  process.stdout.write(`verified ${manifest.files.length} frozen files; protocol ${manifest.protocolDigest.slice(0, 12)}\n`)
} else {
  writeFileSync(manifestPath, body)
  process.stdout.write(`froze ${manifest.files.length} files; protocol ${manifest.protocolDigest.slice(0, 12)}\n`)
}
