import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
assert.equal(execFileSync(pnpm, ['--version'], { encoding: 'utf8' }).trim(), '11.7.0');
for (const name of ['@personal-agent/contracts', '@personal-agent/orchestrator-core']) {
  execFileSync(pnpm, ['--filter', name, 'run', 'check'], { cwd: root, stdio: 'inherit' });
}
const own = resolve(root, 'packages/orchestrator-core');
const results = JSON.parse(readFileSync(resolve(own, 'reports/test-results.json'), 'utf8'));
const dependencies = JSON.parse(readFileSync(resolve(own, 'reports/dependencies.json'), 'utf8'));
assert.equal(results.success, true);
assert.equal(results.numFailedTests, 0);
const original = results.testResults.filter(result => /(?:core-engine|stage)\.spec\.ts$/.test(result.name));
const baseline = original.reduce((total, result) => total + result.assertionResults.length, 0);
assert.equal(baseline, 144);
const identity = JSON.parse(readFileSync(resolve(root, 'packages/contracts/generated/manifest.json'), 'utf8'));
const report = {
  status: 'PASS_CORE_AND_CONTRACTS_ONLY', contractIdentity: { version: identity.version, schemaHash: identity.schemaHash },
  coreTests: results.numPassedTests, originalBaselineTests: baseline, newCoreTests: results.numPassedTests - baseline, dependencies,
  node: process.version, platform: process.platform, arch: process.arch, recordedAt: new Date().toISOString(),
  pending: ['WP-02 real storage/effect integration', 'WP-03 actual subprocess/writer barriers and recovery integration', 'A complete G1 gate report', 'Native agent compatibility and product E2E'],
};
mkdirSync(resolve(root, 'reports/releases'), { recursive: true });
writeFileSync(resolve(root, 'reports/releases/g1-core.json'), JSON.stringify(report, null, 2) + '\n');
console.log('PASS: core/contracts slice only. The full G1 gate remains pending storage/runtime integration.');
