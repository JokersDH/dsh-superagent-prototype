/**
 * The browser entry must stay free of Node builtins. The analysis pipeline needs `node:crypto` for
 * canonical digests, so a UI bundle importing the package root would break; this test walks the
 * browser entry's relative import graph and refuses any Node or filesystem dependency.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const sourceRoot = resolve(here, '../src')

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/from '([^']+)'/g)].map(match => match[1]!)
}

function closure(entry: string): { files: string[]; bare: string[] } {
  const seen = new Set<string>()
  const bare = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier))
      else bare.add(specifier)
    }
  }
  return { files: [...seen], bare: [...bare] }
}

test('the browser entry never reaches a Node builtin or the analysis pipeline', () => {
  const { files, bare } = closure(resolve(sourceRoot, 'browser.ts'))
  assert.ok(files.length >= 3, 'the graph includes the browser entry, the protocol and the projection')
  for (const file of files) {
    assert.equal(file.startsWith(sourceRoot), true, `unexpected import outside the package: ${file}`)
    for (const specifier of importsOf(file))
      assert.equal(specifier.startsWith('node:'), false, `${file} imports ${specifier}`)
  }
  for (const name of ['fs', 'crypto', 'path', 'os'])
    assert.equal(files.some(file => file.endsWith(`/${name}.ts`)), false, `the browser graph must not include ${name}`)
  for (const forbidden of ['./analyze.ts', './subject.ts', './report.ts', './node-composition.ts'])
    assert.equal(files.some(file => file.endsWith(forbidden.slice(2))), false, `${forbidden} is Node-only`)
  assert.deepEqual(bare.sort(), ['@personal-agent/contracts', 'zod'],
    'only the browser-safe contract barrel and zod are external')
})
