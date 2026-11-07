import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--report')) throw new Error('Only --report is supported');
const recording = args.includes('--report');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const results = [];
let transcript = '';
for (const script of ['check:generated', 'typecheck', 'test', 'build']) {
  const startedAt = new Date().toISOString();
  const output = execFileSync(pnpm, ['run', script], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(output);
  transcript += `COMMAND: pnpm run ${script}\n${output}\n`;
  results.push({ script, status: 'PASS', startedAt, completedAt: new Date().toISOString() });
}
if (recording) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'generated/manifest.json'), 'utf8'));
  const testCount = Number(transcript.match(/(?:ℹ\s*)?tests (\d+)/)?.[1]);
  if (!Number.isSafeInteger(testCount) || testCount < 1) throw new Error('Could not determine the executed test count');
  mkdirSync(resolve(root, 'reports'), { recursive: true });
  writeFileSync(resolve(root, 'reports/commands.txt'), transcript.trimEnd() + '\n');
  writeFileSync(resolve(root, 'reports/g0-contracts.json'), JSON.stringify({ status: 'PASS', gate: 'DATA-01_G0_CONTRACT_SLICE', apiMajor: manifest.apiMajor, version: manifest.version, schemaHash: manifest.schemaHash, schemaCount: manifest.schemaNames.length, executedTests: testCount, node: process.version, platform: process.platform, architecture: process.arch, results, limitations: ['No native/model execution', 'No core lifecycle, product DB, API or full end-to-end implementation validated'] }, null, 2) + '\n');
}
