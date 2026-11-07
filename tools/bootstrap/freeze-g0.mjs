import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const a = read('tools/bootstrap/reports/g0-agent-a-review.json');
const b = read('tools/bootstrap/reports/g0-agent-b-review.json');
const data = read('packages/contracts/reports/g0-contracts.json');
const standalone = read('tools/bootstrap/reports/g0-contracts-standalone.json');
const identity = read('packages/contracts/generated/manifest.json');
const proposed = read('tools/reuse-spike/platform/release-candidate.json');
assert.equal(a.status, 'PASS');
assert.equal(a.sourceFilesVerified, 18);
assert.equal(b.status, 'PASS_OPS_01_G0_DARWIN_ARM64');
assert.equal(b.independentProbes, 30);
assert.equal(data.status, 'PASS');
assert.equal(standalone.status, 'PASS');
assert.equal(data.schemaHash, identity.schemaHash);
for (const [path, expected] of Object.entries(identity.sourceHashes)) assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'packages/contracts', path))).digest('hex'), expected, `Contract source drift: ${path}`);
assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'packages/contracts/generated/contracts.schema.json'))).digest('hex'), identity.jsonSchemaDigest);
assert.equal(data.executedTests, 183);
assert.equal(identity.schemaNames.length, 76);
assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'tools/reuse-spike/platform/src/lib/util.mjs'))).digest('hex'), b.helperDigest);
assert.equal(proposed.components.node.sha256, b.nodeArchiveSha256);
assert.equal(proposed.components.binding.prebuildSha256, b.prebuildSha256);
const status = {
  gate: 'G0', status: 'PASS_FOR_G1_DARWIN_ARM64',
  scope: 'Independent core reuse, common contracts and the measured platform probe only; not product release approval.',
  contractIdentity: { apiMajor: identity.apiMajor, version: identity.version, schemaHash: identity.schemaHash },
  checks: {
    'CORE-01': { status: 'PASS', commit: a.reviewedCommit, tests: 144, sourceFiles: 18, independentAstAudit: true, evidence: 'docs/adr/bootstrap/reviews/g0-agent-a.md' },
    'DATA-01': { status: 'PASS', schemas: 76, tests: 183, standalonePackage: true, evidence: 'packages/contracts/reports/g0-contracts.json' },
    'OPS-01_G0': { status: 'PASS', originalCommit: b.originalAgentCommit, correctionCommit: b.packagingCorrectionCommit, independentProbes: 30, targetRuntimeTests: 4, localRuntimeTests: 4, runtime: b.runtime, evidence: 'docs/adr/bootstrap/reviews/g0-agent-b.md' },
  },
  next: { main: ['WP-01', 'WP-16'], agentA: ['WP-02'], agentB: ['WP-03'] },
  notProven: ['Core completion/report extensions', 'Production Store/effects/afterCommit/migrations', 'Physical writer fencing and business recovery', 'Native agent compatibility and product E2E', 'Non-darwin-arm64 platforms', 'Learning benefit or product release readiness'],
};
const baseline = {
  schemaVersion: 1, status: 'G0_ACCEPTED_FOR_G1_NOT_PRODUCT_RELEASE', runtime: b.runtime,
  node: { version: proposed.components.node.version, url: proposed.components.node.url, sha256: b.nodeArchiveSha256 },
  pnpm: proposed.components.packageManager,
  binding: { name: 'better-sqlite3', version: '13.0.3', integrity: proposed.components.binding.registryIntegrity, prebuildSha256: b.prebuildSha256, allowBuilds: false },
  minimumActualSqlite: '3.51.3',
  contractIdentity: status.contractIdentity,
  otherPlatforms: 'NOT_TESTED', nativeAgents: 'NOT_TESTED',
};
const outputs = { 'docs/adr/bootstrap/g0-status.json': status, 'tools/bootstrap/release-baseline.json': baseline };
for (const [path, value] of Object.entries(outputs)) {
  const content = JSON.stringify(value, null, 2) + '\n';
  if (process.argv.includes('--check')) assert.equal(readFileSync(resolve(root, path), 'utf8'), content, `Stale gate artifact ${path}`);
  else writeFileSync(resolve(root, path), content);
}
console.log('PASS: CORE-01, DATA-01 and darwin-arm64 G0 OPS-01 evidence agree; G1 may start, product release remains unapproved.');
