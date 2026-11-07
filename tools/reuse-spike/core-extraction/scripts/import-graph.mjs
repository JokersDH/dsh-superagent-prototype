/**
 * Transitive import-closure check over the extracted slice. Walks every static
 * import/export-from statement (runtime and type-only) from the library entry and the
 * baseline tests, resolves every relative specifier to a file inside this spike, and
 * fails on any external module other than node builtins and vitest (tests only).
 * The runtime graph is the set of non-type-only edges; the type graph additionally
 * includes `import type` / `export type` edges. A missing or escaping target fails.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SPIKE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_PATH = join(SPIKE_ROOT, 'reports', 'import-graph.json')
const LIBRARY_ENTRY = 'src/core/index.ts'
const ENTRIES = [LIBRARY_ENTRY, 'tests/core-engine.spec.ts', 'tests/stage.spec.ts']
const ALLOWED = new Set(['node:crypto', 'vitest'])
const ALLOWED_FROM_LIBRARY = new Set(['node:crypto'])
const FORBIDDEN_PATTERN = /@deepseek-ai\//;

/** The statement forms in this codebase: `import [type] … from '…'`, `export [type] … from '…'`; clauses may span lines. */
const IMPORT = /\bimport\s+(type\s+)?[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/g
const EXPORT = /\bexport\s+(type\s+)?[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/g

const failures = []
const files = new Map() // absolute path -> { path, edges: [{ specifier, typeOnly }] }

function fail(message) { failures.push(message) }

function walk(path) {
  const absolute = resolve(SPIKE_ROOT, path)
  if (files.has(absolute)) return
  let text
  try {
    text = readFileSync(absolute, 'utf8')
  } catch {
    fail(`Unresolvable import target: ${path}`)
    files.set(absolute, { path, edges: [] })
    return
  }
  const edges = []
  for (const pattern of [IMPORT, EXPORT]) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) edges.push({ specifier: match[2], typeOnly: !!match[1] })
  }
  files.set(absolute, { path: relative(SPIKE_ROOT, absolute), edges })
  for (const edge of edges) {
    if (!edge.specifier.startsWith('.')) continue
    const target = resolve(dirname(absolute), edge.specifier)
    if (!target.startsWith(SPIKE_ROOT + sep)) fail(`Import escapes the spike directory: ${edge.specifier} (from ${path})`)
    walk(relative(SPIKE_ROOT, target))
  }
}

function closureOf(entry) {
  walk(entry)
  const closure = new Set()
  const stack = [resolve(SPIKE_ROOT, entry)]
  while (stack.length) {
    const absolute = stack.pop()
    if (closure.has(absolute)) continue
    closure.add(absolute)
    for (const edge of files.get(absolute).edges) {
      if (edge.specifier.startsWith('.')) stack.push(resolve(dirname(absolute), edge.specifier))
    }
  }
  return closure
}

const closures = new Map(ENTRIES.map(entry => [entry, closureOf(entry)]))
const externalsOf = (closure) => {
  const externals = new Map()
  for (const absolute of closure) {
    for (const edge of files.get(absolute).edges) {
      if (edge.specifier.startsWith('.')) continue
      if (!externals.has(edge.specifier)) externals.set(edge.specifier, new Set())
      externals.get(edge.specifier).add(files.get(absolute).path)
    }
  }
  return externals
}

const assertions = []
for (const [entry, closure] of closures) {
  const externals = externalsOf(closure)
  for (const [specifier, importers] of externals) {
    if (FORBIDDEN_PATTERN.test(specifier)) fail(`${entry}: forbidden external ${specifier} (imported by ${[...importers].join(', ')})`)
    if (!ALLOWED.has(specifier)) fail(`${entry}: unexpected external ${specifier} (imported by ${[...importers].join(', ')})`)
  }
  if (entry === LIBRARY_ENTRY) {
    for (const specifier of externals.keys()) {
      if (!ALLOWED_FROM_LIBRARY.has(specifier)) fail(`${entry}: test-host or non-node external ${specifier} reachable from the core`)
    }
  }
  assertions.push({ entry, files: closure.size, externals: Object.fromEntries([...externals].map(([key, value]) => [key, [...value]])) })
}

const edges = [...files.values()].flatMap(file => file.edges)
const report = {
  generatedAt: new Date().toISOString(),
  conclusion: failures.length ? 'FAIL' : 'PASS',
  summary: {
    filesReached: [...files.values()].map(file => file.path).sort(),
    runtimeEdges: edges.filter(edge => !edge.typeOnly).length,
    typeOnlyEdges: edges.filter(edge => edge.typeOnly).length,
    externalSpecifiers: [...new Set(edges.map(edge => edge.specifier).filter(specifier => !specifier.startsWith('.')))],
  },
  assertions,
  failures,
}
mkdirSync(dirname(REPORT_PATH), { recursive: true })
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)

for (const assertion of assertions) {
  console.log(`${assertion.entry}: ${assertion.files} files in closure, externals: ${Object.keys(assertion.externals).join(', ') || 'none'}`)
}
console.log(`Runtime edges: ${report.summary.runtimeEdges}, type-only edges: ${report.summary.typeOnlyEdges}`)
console.log(`Closure files: ${report.summary.filesReached.join(', ')}`)
if (failures.length) {
  console.error(`\nFAIL: import-graph violations:`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`\nPASS: transitive import closure is self-contained (node builtins and vitest only, tests only for vitest)`)
