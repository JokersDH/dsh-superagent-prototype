import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const steps = [
  ['--filter', '@personal-agent/contracts', 'build'],
  ['--filter', '@personal-agent/orchestrator-core', 'build'],
  ['--filter', '@personal-agent/effects', 'build'],
  ['--filter', '@personal-agent/storage', 'build'],
  ['--filter', '@personal-agent/coordinator', 'typecheck'],
  ['--filter', '@personal-agent/coordinator', 'test'],
  ['--filter', '@personal-agent/coordinator', 'test:sqlite'],
];
const results = [];
let tests = 0;
for (const args of steps) {
  const output = execFileSync(pnpm, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(output);
  const matched = output.match(/(?:ℹ\s*)?tests (\d+)/);
  if (matched) { tests += Number(matched[1]); assert.match(output, /(?:ℹ\s*)?fail 0/); }
  results.push({ command: `pnpm ${args.join(' ')}`, status: 'PASS' });
}
assert.ok(tests >= 25, 'Both deterministic and SQLite ingress suites must execute');
const report = { status: 'PASS_INGRESS_INTERFACE_AND_SQLITE_FIXTURE_ONLY', tests, node: process.version, platform: process.platform, architecture: process.arch, checkedAt: new Date().toISOString(), results, limitations: ['SQLite runtime-binding tables/reducers are review fixtures, not production repositories', 'No IPC authentication implementation or durable Runner journal tested', 'No native agent/model task executed', 'Does not approve overall G1 or the remaining runtime safety findings'] };
mkdirSync(resolve(root, 'reports/releases'), { recursive: true });
writeFileSync(resolve(root, 'reports/releases/g1-ingress.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS: ${tests} ingress tests, including native SQLite rollback/reopen; production runtime wiring remains pending.`);
