import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const own = dirname(fileURLToPath(import.meta.url));
const source = resolve(own, '../../packages/contracts');
const scratch = mkdtempSync(resolve(tmpdir(), 'personal-agent-contracts-'));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const results = [];
try {
  cpSync(source, scratch, { recursive: true, filter: path => !['node_modules', 'dist', 'reports', '.test-output'].includes(basename(path)) });
  for (const args of [['install', '--ignore-workspace', '--frozen-lockfile'], ['run', 'check']]) {
    const output = execFileSync(pnpm, args, { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    results.push({ command: `pnpm ${args.join(' ')}`, status: 'PASS' });
    if (args[0] === 'run') assert.match(output, /(?:ℹ\s*)?fail 0/);
  }
  const code = 'import { UserCommandSchema, CONTRACT_IDENTITY } from "@personal-agent/contracts"; const c=UserCommandSchema.parse({commandId:"smoke-1",conversationId:"conversation-1",kind:"chat",projectId:"project-1",text:"Smoke"}); if(c.kind!=="chat"||CONTRACT_IDENTITY.apiMajor!==1)process.exit(1);';
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: scratch, stdio: 'pipe' });
  results.push({ command: 'Built ESM package self-import and runtime parse', status: 'PASS' });
  const report = { status: 'PASS', node: process.version, platform: process.platform, architecture: process.arch, checkedAt: new Date().toISOString(), isolation: 'Temporary standalone package outside the repository; no original root dependencies copied', results, limitations: ['No native binding/runtime or product integration was exercised'] };
  if (process.argv.includes('--record')) {
    mkdirSync(resolve(own, 'reports'), { recursive: true });
    writeFileSync(resolve(own, 'reports/g0-contracts-standalone.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
