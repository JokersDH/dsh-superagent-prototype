import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const destination = resolve(root, 'packages/orchestrator-core');
const commit = '8c32a9dc5d72c033816c6a8110b37f40cf94fba4';
const sources = execFileSync('git', ['ls-tree', '-r', '--name-only', commit, 'src/core'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const paths = ['LICENSE', ...sources, 'tests/core-engine.spec.ts', 'tests/stage.spec.ts'];
for (const path of paths) if (existsSync(resolve(destination, path))) throw new Error(`Refusing to replace an existing file: ${path}`);
const files = paths.map(path => {
  const bytes = execFileSync('git', ['show', `${commit}:${path}`], { cwd: root });
  const target = resolve(destination, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return { path, upstreamPath: path, bytes: bytes.length, upstreamSha256: createHash('sha256').update(bytes).digest('hex') };
});
writeFileSync(resolve(destination, 'upstream.json'), JSON.stringify({ repository: 'https://github.com/deepseek-ai/dsh-superagent-prototype', commit, license: 'MIT, Copyright (c) 2026 DeepSeek Harness Team', files }, null, 2) + '\n');
console.log(`Seeded ${files.length} source/test/license files without modifying the upstream prototype.`);
