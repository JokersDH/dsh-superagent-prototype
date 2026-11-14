/**
 * `@personal-agent/project-recipes` — deterministic, unconfirmed project task/check declarations.
 *
 * Layers:
 *  - `facts.ts`   the explicitly observed project facts contract (`project-facts/1`);
 *  - `catalog.ts` the versioned recipe catalog (three practical task kinds);
 *  - `match.ts`   the pure matcher over (facts, configuration, kind, explicit selection);
 *  - `draft.ts`   the `project-recipe-draft/1` result contract and its revision verification.
 *
 * This package never installs, runs, registers a check, writes SQL, reads the home directory or
 * environment, or creates an execution lifecycle. A result only becomes work through the existing
 * preview and explicit user confirmation owned by main.
 */
export * from './facts.ts'
export * from './catalog.ts'
export * from './draft.ts'
export * from './match.ts'
export * from './preview.ts'
