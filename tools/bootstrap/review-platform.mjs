import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.argv[2] || resolve(own, '../..'));
const spike = resolve(repo, 'tools/reuse-spike/platform');
const read = path => JSON.parse(readFileSync(resolve(spike, path), 'utf8'));
const digest = path => createHash('sha256').update(readFileSync(resolve(spike, path))).digest('hex');
const install = read('evidence/install/install.json');
const summary = read('evidence/release-proposed/summary.json');
const env = read('evidence/release-proposed/env.json');
const paths = ['env', 'tx', 'backup', 'crash'];
assert.equal(install.exitCode, 0);
assert.equal(install.node.reported, 'v24.22.2');
assert.equal(install.pnpm.reported, '11.7.0');
assert.equal(install.betterSqlite3.packageVersion, '13.0.3');
assert.equal(install.betterSqlite3.nodeGypBuildDirectoryPresent, false);
assert.deepEqual(install.betterSqlite3.lifecycleScripts, []);
assert.equal(install.buildPolicy.allowBuilds, false);
assert.equal(summary.overall, 'PASS');
assert.equal(summary.runtime.platform, 'darwin');
assert.equal(summary.runtime.arch, 'arm64');
assert.equal(summary.runtime.node, 'v24.22.2');
let checks = 0;
for (const path of paths) {
  const result = read(`evidence/release-proposed/${path}.json`);
  assert.equal(result.ok, true);
  assert.ok(result.checks.length > 0 && result.checks.every(check => check.status === 'PASS'));
  checks += result.checks.length;
}
assert.equal(env.facts.sqlite.version, '3.53.4');
assert.equal(env.facts.sqlite.admissionSatisfied, true);
const report = {
  status: 'PASS_OPS_01_G0_DARWIN_ARM64',
  reviewedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  originalAgentCommit: '87deffb', packagingCorrectionCommit: 'ad24d87',
  helperDigest: digest('src/lib/util.mjs'),
  correction: 'The helper was copied byte-identically from Agent B original local file; root lib/ ignore became /lib/. Agent B worktree was not changed.',
  independentProbes: checks,
  runtime: { node: install.node.reported, pnpm: install.pnpm.reported, binding: install.betterSqlite3.packageVersion, sqlite: env.facts.sqlite.version, platform: summary.runtime.platform, architecture: summary.runtime.arch },
  nodeArchiveSha256: install.node.archiveSha256,
  prebuildSha256: install.betterSqlite3.hostPrebuildSha256,
  evidence: Object.fromEntries(['evidence/install/install.json', ...paths.map(path => `evidence/release-proposed/${path}.json`), 'evidence/release-proposed/summary.json'].map(path => [path, digest(path)])),
  recordedAt: new Date().toISOString(),
  limitations: ['Only the G0 native-load/SQLite probe scope is accepted', 'No product Store, afterCommit, queue, writer lease, artifact backup or end-to-end recovery validated', 'All other platforms remain NOT_TESTED'],
};
if (process.argv[3] === '--record') {
  mkdirSync(resolve(own, 'reports'), { recursive: true });
  writeFileSync(resolve(own, 'reports/g0-agent-b-review.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
