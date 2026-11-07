import assert from 'node:assert/strict';
import { readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = realpathSync(resolve(root, 'dist'));
const files = new Set(), external = new Set();
function walk(file) {
  file = realpathSync(file);
  assert.ok(!relative(dist, file).startsWith('..'), `Runtime import escapes the built core: ${file}`);
  if (files.has(file)) return;
  files.add(file);
  const text = readFileSync(file, 'utf8');
  const syntax = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const scan = node => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) assert.ok(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]), 'Nonliteral module loading is not allowed in the core');
    ts.forEachChild(node, scan);
  };
  scan(syntax);
  for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
    if (fileName.startsWith('.')) walk(resolve(dirname(file), fileName));
    else { assert.equal(fileName, 'node:crypto', `Unexpected runtime external ${fileName}`); external.add(fileName); }
  }
}
walk(resolve(dist, 'index.js'));
const config = ts.readConfigFile(resolve(root, 'tsconfig.build.json'), ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
assert.equal(parsed.errors.length, 0);
const program = ts.createProgram(parsed.fileNames, parsed.options);
assert.equal(ts.getPreEmitDiagnostics(program).length, 0, 'The type graph must compile');
const typeFiles = program.getSourceFiles().map(file => file.fileName);
assert.ok(typeFiles.every(file => !file.includes('@deepseek-ai') && !file.includes('/src/app/')), 'Core type graph depends on the original DSH application');
assert.ok(typeFiles.some(file => file.includes('/contracts/dist/')), 'Product types must come from the public built contracts package');
const report = { status: 'PASS', runtimeFiles: [...files].map(file => relative(dist, file)).sort(), runtimeExternals: [...external].sort(), typeFilesChecked: typeFiles.length, productContractTypes: true, dshHostTypes: false, parser: `typescript@${ts.version}` };
mkdirSync(resolve(root, 'reports'), { recursive: true });
writeFileSync(resolve(root, 'reports/dependencies.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS: ${files.size} built runtime files import only node:crypto; ${typeFiles.length} compiled type files have no DSH host dependency.`);
