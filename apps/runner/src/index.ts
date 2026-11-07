/**
 * Runner public surface (WP-03).
 *
 * `ProcessHost` implements the frozen `OwnedProcessHost` port; `AttemptRunner` hosts one Driver
 * attempt; `ControlledRunnerHost` maps it to the Supervisor's `RunnerHost` seam.
 */
export { ProcessHost } from './process-host.ts'
export type { OwnedProcess, ProcessHostOptions, ProcessIdentity } from './process-host.ts'
export { BoundedJournal, StderrRing, journalCoverage } from './journal.ts'
export type { CriticalEntry, DiagnosticEntry, JournalSnapshot } from './journal.ts'
export { AttemptRunner } from './runner.ts'
export type { RunnerOptions, RunnerResult } from './runner.ts'
export { ControlledRunnerHost } from './host.ts'
export type { DriverFactory } from './host.ts'
