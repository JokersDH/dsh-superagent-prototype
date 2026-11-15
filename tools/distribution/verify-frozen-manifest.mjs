#!/usr/bin/env node
// Verify a frozen release manifest and tar identity without extracting or starting the product.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const args = process.argv.slice(2)
const val = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const manifestPath = val('--manifest'), tarPath = val('--tar')
if (!manifestPath || !tarPath) { console.error('usage: verify-frozen-manifest.mjs --manifest <json> --tar <tar.gz>'); process.exit(2) }
const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8')), tar = resolve(tarPath)
if (!existsSync(tar)) { console.error(JSON.stringify({ status: 'REFUSED', code: 'tar_missing' })); process.exit(1) }
const bytes = statSync(tar).size, sha256 = createHash('sha256').update(readFileSync(tar)).digest('hex')
const listing = spawnSync('tar', ['-tzf', tar], { encoding: 'utf8', timeout: 120000 })
if (listing.status !== 0) { console.error(JSON.stringify({ status: 'REFUSED', code: 'tar_unreadable' })); process.exit(1) }
const entries = listing.stdout.trim().split('\n').filter(Boolean)
const failures = []
if (sha256 !== manifest.tarSha256) failures.push('sha256')
if (bytes !== manifest.tarBytes) failures.push('bytes')
if (entries.length !== manifest.tarEntries) failures.push('entries')
if (manifest.buildId && !entries.includes('install/install.json')) failures.push('missing_install_manifest')
if (manifest.release && !entries.some(entry => entry.startsWith('install/app/apps/launcher/bin/'))) failures.push('missing_launcher_entry')
const external = entries.filter(entry => entry.startsWith('/') || entry.includes('../'))
if (external.length) failures.push('unsafe_entry')
if (failures.length) { console.error(JSON.stringify({ status: 'REFUSED', failures, observed: { sha256, bytes, entries: entries.length, files: manifest.entries } })); process.exit(1) }
console.log(JSON.stringify({ status: 'PASS', release: manifest.release, source: manifest.source, buildId: manifest.buildId, sha256, bytes, entries: entries.length, files: manifest.entries }))
