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
export { FileCriticalJournal, decodeBuffer, encodeRecord } from './file-journal.ts'
export type { JournalEntry, JournalRecovery, FileJournalOptions } from './file-journal.ts'
export { replayJournal } from './runner.ts'
export type { ReplayResult } from './runner.ts'
export { ControlledRunnerHost } from './host.ts'
export type { DriverFactory } from './host.ts'
export { AttemptArtifactManifest } from './artifact-manifest.ts'
export type { ArtifactEntry, ArtifactSource } from './artifact-manifest.ts'
export { serveRecoveryEndpoint, endpointDirectory, CREDENTIAL_FILE, SOCKET_FILE } from './recovery-endpoint.ts'
export type { RecoveryEndpoint, RecoveryEndpointOptions, RunnerInspection, RunnerResourceState } from './recovery-endpoint.ts'
export { RUNNER_BRIDGE_PROTOCOL, parseBridgeFrame, toBridgeFailure, BridgeProtocolError } from './bridge-protocol.ts'
export type { BridgeDownstream, BridgeUpstream, BridgeFrame } from './bridge-protocol.ts'
export { serveRunner } from './runner-service.ts'
export type { RunnerServiceOptions, RunnerServiceHandle } from './runner-service.ts'
export { RunnerLink } from './runner-link-client.ts'
export type { RunnerLinkOptions, SpawnedRunner } from './runner-link-client.ts'
