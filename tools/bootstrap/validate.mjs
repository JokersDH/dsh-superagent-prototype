import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const read = name => readFileSync(resolve(directory, 'templates', name), 'utf8');
const scripts = JSON.parse(read('root-scripts.json'));
const candidate = JSON.parse(read('release-candidate.json'));
const tsconfig = JSON.parse(read('tsconfig.package.json'));
assert.equal(candidate.status, 'PROPOSED_NOT_RELEASE_APPROVED');
assert.equal(candidate.targetRuntime.node, '24.22.2');
assert.ok(candidate.platforms.every(item => item.status === 'NOT_TESTED'));
assert.equal(tsconfig.compilerOptions.strict, true);
assert.equal(tsconfig.compilerOptions.noUncheckedIndexedAccess, true);
const original = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const merged = { ...original, scripts: { ...original.scripts, ...scripts } };
assert.deepEqual(merged.dsh, original.dsh);
assert.deepEqual(merged.peerDependencies, original.peerDependencies);
assert.equal(merged.scripts.check, original.scripts.check);
const scratch = mkdtempSync(resolve(tmpdir(), 'personal-agent-bootstrap-'));
try {
  writeFileSync(resolve(scratch, 'package.json'), JSON.stringify({ name: 'bootstrap-fixture', private: true, packageManager: 'pnpm@11.7.0', scripts: merged.scripts }));
  writeFileSync(resolve(scratch, 'pnpm-workspace.yaml'), read('pnpm-workspace.yaml'));
  const expected = ['@personal-agent/contracts', '@personal-agent/fixture-driver', '@personal-agent/fixture-console'];
  for (const [path, name] of [['packages/contracts', expected[0]], ['packages/drivers/fixture', expected[1]], ['apps/console', expected[2]]]) {
    mkdirSync(resolve(scratch, path), { recursive: true });
    writeFileSync(resolve(scratch, path, 'package.json'), JSON.stringify({ name, version: '0.0.0-fixture', private: true }));
  }
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  assert.equal(execFileSync(pnpm, ['--version'], { encoding: 'utf8' }).trim(), '11.7.0', 'Use the pinned package manager');
  const packages = JSON.parse(execFileSync(pnpm, ['list', '--recursive', '--depth', '-1', '--json'], { cwd: scratch, encoding: 'utf8', env: { ...process.env, CI: 'true' } }));
  const discovered = new Set(packages.map(item => item.name));
  for (const name of expected) assert.ok(discovered.has(name), `Workspace did not discover ${name}`);
  console.log('PASS: pnpm discovers packages, nested drivers and apps; additive scripts preserve the original plugin; release template remains unapproved.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
