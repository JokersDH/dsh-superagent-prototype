import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repository = realpathSync(process.argv[2] || ownRoot);
const spike = resolve(repository, 'tools/reuse-spike/core-extraction');
assert.ok(existsSync(resolve(spike, 'node_modules/typescript/package.json')), 'Install the extraction package independently first');
const ts = createRequire(resolve(spike, 'package.json'))('typescript');
const upstream = '8c32a9dc5d72c033816c6a8110b37f40cf94fba4';
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
const expected = ['LICENSE', ...git(['ls-tree', '-r', '--name-only', upstream, 'src/core']).split('\n'), 'tests/core-engine.spec.ts', 'tests/stage.spec.ts'].sort();
const manifest = JSON.parse(readFileSync(resolve(spike, 'source-manifest.json'), 'utf8'));
assert.equal(manifest.upstream.commit, upstream);
assert.deepEqual(manifest.files.map(item => item.path).sort(), expected, 'Manifest must include the whole expected slice');
for (const item of manifest.files) {
  const source = execFileSync('git', ['show', `${upstream}:${item.path}`], { cwd: repository });
  const local = readFileSync(resolve(spike, item.path));
  assert.ok(source.equals(local), `Extracted file changed: ${item.path}`);
  assert.equal(createHash('sha256').update(local).digest('hex'), item.sha256);
}

const graph = new Map();
function visit(file) {
  if (graph.has(file)) return;
  const rel = relative(spike, realpathSync(file));
  assert.ok(rel && !rel.startsWith('..'), 'Source escapes the extraction package');
  const syntax = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const edges = [];
  const add = (literal, typeOnly) => {
    assert.ok(literal && ts.isStringLiteralLike(literal), `Nonliteral module reference: ${rel}`);
    const specifier = literal.text;
    let target;
    if (specifier.startsWith('.')) {
      target = ts.resolveModuleName(specifier, file, { moduleResolution: ts.ModuleResolutionKind.NodeNext, module: ts.ModuleKind.NodeNext, allowImportingTsExtensions: true }, ts.sys).resolvedModule?.resolvedFileName;
      assert.ok(target, `Unresolved module ${specifier} in ${rel}`);
      target = realpathSync(target);
      const targetRel = relative(spike, target);
      assert.ok(targetRel && !targetRel.startsWith('..'), `Import escapes package: ${specifier}`);
    }
    edges.push({ specifier, typeOnly, target });
  };
  const scan = node => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const allNamedTypes = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(item => item.isTypeOnly);
      add(node.moduleSpecifier, Boolean(clause?.isTypeOnly || (!clause?.name && allNamedTypes)));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node.moduleSpecifier, Boolean(node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly))));
    } else if (ts.isImportTypeNode(node)) {
      assert.ok(ts.isLiteralTypeNode(node.argument), `Unsupported import type in ${rel}`);
      add(node.argument.literal, true);
    } else if (ts.isImportEqualsDeclaration(node)) {
      assert.ok(ts.isExternalModuleReference(node.moduleReference), `Unsupported import alias in ${rel}`);
      add(node.moduleReference.expression, Boolean(node.isTypeOnly));
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      add(node.arguments[0], false);
    }
    ts.forEachChild(node, scan);
  };
  scan(syntax);
  graph.set(file, edges);
  for (const edge of edges) if (edge.target) visit(edge.target);
}

const entries = ['src/core/index.ts', 'tests/core-engine.spec.ts', 'tests/stage.spec.ts'];
const assertions = [];
for (const entry of entries) {
  const start = realpathSync(resolve(spike, entry));
  visit(start);
  for (const mode of ['runtime', 'runtime_and_type']) {
    const reached = new Set();
    const externals = new Set();
    const queue = [start];
    while (queue.length) {
      const file = queue.pop();
      if (reached.has(file)) continue;
      reached.add(file);
      for (const edge of graph.get(file)) {
        if (mode === 'runtime' && edge.typeOnly) continue;
        if (edge.target) queue.push(edge.target);
        else externals.add(edge.specifier);
      }
    }
    const allowed = entry.startsWith('src/') ? ['node:crypto'] : ['node:crypto', 'vitest'];
    for (const external of externals) assert.ok(allowed.includes(external), `Unexpected ${mode} external: ${external}`);
    assertions.push({ entry, mode, files: [...reached].map(file => relative(spike, file)).sort(), externals: [...externals].sort() });
  }
}
const report = { status: 'PASS', reviewedCommit: git(['rev-parse', 'HEAD']), upstream, sourceFilesVerified: expected.length, parser: `typescript@${ts.version} AST + module resolver`, assertions, limitations: ['This proves the fixed extracted slice only', 'Does not implement completion/fence/DB/native behavior'], reviewedAt: new Date().toISOString() };
if (process.argv[3] === '--record') {
  const output = resolve(ownRoot, 'tools/bootstrap/reports');
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'g0-agent-a-review.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
