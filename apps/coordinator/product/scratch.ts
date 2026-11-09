import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Creates a disposable project outside the product repository. No user repository is selected. */
export function ensureScratchProject(stateRoot: string): string {
  const reference = join(stateRoot, 'scratch-project.json')
  if (existsSync(reference)) {
    const value: unknown = JSON.parse(readFileSync(reference, 'utf8'))
    const path = (value as { path?: unknown })?.path
    if (typeof path !== 'string' || !/^\/tmp\/pa-project-[A-Za-z0-9]+$/.test(path))
      throw new Error('Invalid scratch project reference')
    const stat = lstatSync(path)
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('Scratch project is not privately owned')
    return path
  }
  const path = mkdtempSync('/tmp/pa-project-')
  const git = (args: string[]) => execFileSync('git', args, { cwd: path, stdio: 'pipe' })
  git(['init', '-q'])
  mkdirSync(join(path, 'src'))
  writeFileSync(join(path, 'src', 'product-output.txt'), 'pending controlled output\n', { mode: 0o600 })
  git(['add', 'src/product-output.txt'])
  git([
    '-c',
    'user.name=Controlled Product Fixture',
    '-c',
    'user.email=fixture@localhost',
    'commit',
    '-qm',
    'Controlled scratch baseline',
  ])
  writeFileSync(reference, JSON.stringify({ path }) + '\n', { flag: 'wx', mode: 0o600 })
  return path
}
