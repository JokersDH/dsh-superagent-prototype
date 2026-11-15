#!/usr/bin/env node
// Read-only support bundle for a packaged install. It never starts the product, reads user state,
// credentials, native profiles or model keys. Output directory 0700, file 0600, no overwrite.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const args = process.argv.slice(2)
const value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const install = value('--install'), output = value('--output')
if (!install || !output) { console.error('usage: support-bundle.mjs --install <dir> --output <absent-dir>'); process.exit(2) }
const installRoot = resolve(install), outputRoot = resolve(output)
const manifestPath = join(installRoot, 'install.json')
if (!existsSync(manifestPath)) { console.error(JSON.stringify({ status: 'REFUSED', code: 'install_manifest_missing' })); process.exit(1) }
if (existsSync(outputRoot)) { console.error(JSON.stringify({ status: 'REFUSED', code: 'output_exists' })); process.exit(1) }
const release = JSON.parse(readFileSync(manifestPath, 'utf8'))
const sensitive = /(token|secret|credential|password|private.?key|api.?key)/i
const redact = value => Array.isArray(value) ? value.map(redact) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? '[redacted]' : redact(item)])) : value
mkdirSync(outputRoot, { recursive: false, mode: 0o700 }); chmodSync(outputRoot, 0o700)
const report = redact({ protocol: 'wave30-support-bundle/1', generatedAt: new Date().toISOString(),
  subject: { buildId: release.buildId, source: release.source, producer: release.producer, build: release.build,
    tar: release.tar ?? null, limitations: release.limitations ?? [] },
  observed: { installManifest: 'install.json', fileCount: Array.isArray(release.files) ? release.files.length : null,
    consoleMode: release.build?.consoleMode ?? null, productSchema: release.producer?.productSchema ?? null },
  boundaries: ['No product start/stop.', 'No user state/profile/credential/model key read.', 'Not a stop authorization or release admission.'] })
const path = join(outputRoot, 'support.json'); writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); chmodSync(path, 0o600)
console.log(JSON.stringify({ status: 'PASS', path, mode: '0600', protocol: report.protocol, buildId: report.subject.buildId }))
