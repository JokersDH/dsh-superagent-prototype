import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = JSON.parse(readFileSync(resolve(root, 'upstream.json'), 'utf8'));
const reasons = {
  'src/core/model.ts': 'Optional personal completion lifecycle metadata; legacy fields preserved.',
  'src/core/part.ts': 'Trusted completion ports, current-contract owner filtering and candidate invalidation.',
  'src/core/ports.ts': 'Additive completion/retirement domain events; Repositories/Executor stay compatible.',
  'src/core/errors.ts': 'Stable errors for scoped execution, stale candidates and failed verification.',
  'src/core/engine.ts': 'Additive scoped facts/completion entry points and frozen runtime facade.',
  'src/core/assignments.ts': 'Scoped reports/read ACKs, candidate lifecycle and verified-mode ready behavior.',
  'src/core/tickets.ts': 'Opt-in creation, invalidation, personal resume restrictions and completion defense.',
  'src/core/intake.ts': 'Do not fan out to ended, retired or stale personal tickets.',
  'src/core/replies.ts': 'Only verified personal results can be formally delivered; retain withdrawal IDs.',
  'src/core/stage.ts': 'Retired personal tickets cannot be retried.',
  'src/core/index.ts': 'Public completion ports/digest helpers and scoped roles.',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = upstream.files.map(item => {
  const original = execFileSync('git', ['show', `${upstream.commit}:${item.upstreamPath}`], { cwd: root });
  const actual = readFileSync(resolve(root, item.path));
  assert.equal(sha(original), item.upstreamSha256, `Bad source manifest: ${item.path}`);
  const changed = !original.equals(actual);
  if (changed) assert.ok(reasons[item.path], `Undeclared upstream change: ${item.path}`);
  return { path: item.path, upstreamSha256: item.upstreamSha256, currentSha256: sha(actual), treatment: changed ? 'adapted' : 'verbatim', reason: changed ? reasons[item.path] : 'Unmodified upstream source/test/license.' };
});
function walk(path) { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)]); }
const copied = new Set(upstream.files.map(item => item.path));
const added = walk(resolve(root, 'src')).map(path => relative(root, path)).filter(path => !copied.has(path)).sort().map(path => ({ path, sha256: sha(readFileSync(resolve(root, path))) }));
const report = JSON.stringify({ upstream: upstream.repository, commit: upstream.commit, files, added }, null, 2) + '\n';
const output = resolve(root, 'generated/upstream-diff.json');
if (process.argv.includes('--check')) assert.equal(readFileSync(output, 'utf8'), report, 'Stale upstream diff manifest');
else { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, report); }
console.log(`PASS: ${files.length} upstream files accounted for; original tests and MIT license remain byte-identical; ${added.length} new source files.`);
