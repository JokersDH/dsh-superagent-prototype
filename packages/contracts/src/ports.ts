import type {
  AgentProfile, AttemptSpec, Change, CommandReceipt, CriticalFact, DurableReceipt, InspectQuery,
  Json, ProbeReport, ProcessSpec, ProgressUpdate, ReconcileReport, RunnerCommand, RuntimeReference,
  ServeExit, Snapshot, TrustedActor, UserCommand,
} from './types.ts';

export interface OwnedProcessHost {
  spawn(spec: ProcessSpec): Promise<{
    resourceRef: string;
    stdout: AsyncIterable<Uint8Array>;
    stderr: AsyncIterable<Uint8Array>;
    exited: Promise<{ code: number | null; signal: string | null }>;
  }>;
  write(resourceRef: string, frame: Uint8Array): Promise<void>;
  stopOwned(resourceRef: string, deadlineMs: number): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }>;
}

export interface ProbeHost {
  inspectExecutable(profile: AgentProfile): Promise<{ version: string; digest: string; evidenceRef: string }>;
  inspectConfig(reference: string): Promise<{ fingerprint: string; stability: 'frozen' | 'watched' | 'unverified' }>;
}

export interface RecoveryHost {
  readJournal(reference: string): Promise<readonly CriticalFact[]>;
  inspectRuntime(reference: RuntimeReference): Promise<ReconcileReport>;
}

export type AttemptIO = {
  commands: AsyncIterable<RunnerCommand>;
  record(fact: CriticalFact): Promise<DurableReceipt>;
  publishProgress(update: ProgressUpdate): void;
  runtime: OwnedProcessHost;
  payloads: {
    read(reference: string): Promise<Json>;
    store(payload: Json, classification: 'critical' | 'diagnostic'): Promise<string>;
  };
};

export interface AgentDriverV1 {
  inspect(profile: AgentProfile, host: ProbeHost): Promise<ProbeReport>;
  serve(spec: AttemptSpec, io: AttemptIO): Promise<ServeExit>;
  reconcile(ref: RuntimeReference, host: RecoveryHost): Promise<ReconcileReport>;
}

export interface ApplicationService {
  dispatch(command: UserCommand, actor: TrustedActor): Promise<CommandReceipt>;
  inspect(query: InspectQuery): Promise<Snapshot>;
  changes(after: number): AsyncIterable<Change>;
}
