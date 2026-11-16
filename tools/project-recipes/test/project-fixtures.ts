/** Real on-disk project shapes used by the J consumer tests (no product writes). */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureStarterProject } from '../../../apps/coordinator/product/project-registry.ts'

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Personal Agent', '-c', 'user.email=agent@example.invalid', ...args], { cwd, stdio: 'ignore' })

const initRepo = (path: string) => {
  mkdirSync(join(path, 'src'), { recursive: true })
  mkdirSync(join(path, 'test'), { recursive: true })
  writeFileSync(join(path, 'src/index.mjs'), 'export const greet = name => `Hello, ${name}!`\n')
  writeFileSync(join(path, '.gitignore'), 'node_modules/\n')
  git(path, ['init', '-q'])
  git(path, ['add', '.'])
  git(path, ['commit', '-q', '-m', 'fixture'])
}

export const makePlainProject = (path: string): void => ensureStarterProject(path)

export const makeNpmProject = (path: string): void => {
  initRepo(path)
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'npm-app', packageManager: 'npm@11.6.0', engines: { node: '>=22' }, scripts: { test: 'node --test' } }))
  writeFileSync(join(path, 'package-lock.json'), '{"lockfileVersion":3}')
  git(path, ['add', '.'])
  git(path, ['commit', '-q', '-m', 'npm lock'])
}

export const makePnpmProject = (path: string): void => {
  initRepo(path)
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'pnpm-app', packageManager: 'pnpm@11.7.0', engines: { node: '>=24' }, scripts: { test: 'node --test' } }))
  writeFileSync(join(path, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  git(path, ['add', '.'])
  git(path, ['commit', '-q', '-m', 'pnpm lock'])
}

/** The product fixture check expects this file inside the attempt workspace. */
export const PRODUCT_OUTPUT = 'approved product output\n'
