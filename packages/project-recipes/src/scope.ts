/**
 * Scope atoms, mirrored from the application's own authorization rule.
 *
 * `Scope.allowedPaths`/`excludedPaths` are **declared atoms**, not prefixes and not globs. The
 * application compares them literally (`packages/questions/src/validation.ts` and
 * `packages/context/src/paths.ts`: `scope.allowedPaths.every(path => grant.allowedPaths.includes(path))`).
 * Therefore a recipe may only pass through atoms the project already declares — `src/` stays `src/`,
 * `.` stays `.`, and `src/file.ts` is **not** a narrower form of a declared `src/`.
 *
 * Narrowing to a child path needs the original configuration/authorization flow, not a recipe.
 */
import type { Scope } from '@personal-agent/contracts'

/**
 * Format check matching the contracts' `relativePath`: non-empty, project-relative, no drive letter,
 * no backslash, no NUL and no parent traversal. Trailing slashes and `.` are legal atoms.
 */
export function isProjectAtom(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1024 &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.split('/').includes('..')
  )
}

/**
 * Exact mirror of the application's declared-atom containment. Exported so a consumer can prove,
 * without importing the whole application, that a draft scope is acceptable to the grant it came from.
 */
export function scopeAtomWithin(scope: Scope, grant: Scope): boolean {
  return (
    scope.projectId === grant.projectId &&
    scope.allowedPaths.every((path) => grant.allowedPaths.includes(path)) &&
    grant.excludedPaths.every((path) => scope.excludedPaths.includes(path)) &&
    scope.externalActions.every((action) => grant.externalActions.includes(action)) &&
    (!grant.expiresAt || (scope.expiresAt !== undefined && Date.parse(scope.expiresAt) <= Date.parse(grant.expiresAt)))
  )
}
