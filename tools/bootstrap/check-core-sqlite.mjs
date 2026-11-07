import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: { storage: { type: 'string' }, record: { type: 'boolean' } } });
if (!values.storage) throw new Error('Use --storage <independently built storage checkout>');
const storage = resolve(values.storage);
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
execFileSync(pnpm, ['exec', 'tsc', '--ignoreConfig', '--noEmit', '--strict', '--target', 'ES2024', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--allowImportingTsExtensions', '--skipLibCheck', '--types', 'node', 'apps/coordinator/main.ts'], { cwd: root, stdio: 'inherit' });
const typing = mkdtempSync(resolve(tmpdir(), 'g1-storage-binding-types-'));
try {
  const fixture = resolve(typing, 'binding.mts');
  writeFileSync(fixture, `import { bindCoreRepositories } from ${JSON.stringify(resolve(root, 'apps/coordinator/main.ts'))};\nimport type { ProductStore } from ${JSON.stringify(resolve(storage, 'packages/storage/dist/index.js'))};\ndeclare const store: ProductStore;\nexport const repositories = bindCoreRepositories(store);\n`);
  execFileSync(pnpm, ['exec', 'tsc', '--ignoreConfig', '--noEmit', '--strict', '--target', 'ES2024', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--allowImportingTsExtensions', '--skipLibCheck', '--types', 'node', fixture], { cwd: root, stdio: 'inherit' });
} finally { rmSync(typing, { recursive: true, force: true }); }
const core = resolve(root, 'packages/orchestrator-core');
execFileSync(pnpm, ['exec', 'vitest', 'run', '--config', 'vitest.sqlite.config.ts', '--reporter=default', '--reporter=json', '--outputFile=reports/sqlite-test-results.json'], { cwd: core, env: { ...process.env, G1_STORAGE_REVIEW_ROOT: storage }, stdio: 'inherit' });
const result = JSON.parse(readFileSync(resolve(core, 'reports/sqlite-test-results.json'), 'utf8'));
assert.equal(result.success, true);
assert.equal(result.numFailedTests, 0);
const original = result.testResults.filter(item => /(?:core-engine|stage)\.spec\.ts$/.test(item.name)).reduce((sum, item) => sum + item.assertionResults.length, 0);
assert.equal(original, 144);
const report = { status: 'PASS_CORE_DOMAIN_SQLITE_ONLY', storageCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: storage, encoding: 'utf8' }).trim(), typedStorageBinding: true, coreTests: result.numPassedTests, originalBaselineTests: original, personalCoreTests: result.numPassedTests - original, node: process.version, platform: process.platform, recordedAt: new Date().toISOString(), limitations: ['One SQLite store per core test; no concurrent coordinator startup', 'Writer lock and direct async UnitOfWork cases are blocked in the separate review report', 'Original fake callbacks are not durable effect/outbox evidence', 'No production runtime bindings/leases or real fenced ingress wired', 'No native agent compatibility or full G1 acceptance'] };
if (values.record) { mkdirSync(resolve(root, 'reports/releases'), { recursive: true }); writeFileSync(resolve(root, 'reports/releases/g1-core-sqlite.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify(report, null, 2));
