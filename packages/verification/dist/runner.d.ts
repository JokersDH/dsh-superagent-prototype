import type { CandidateRef, Criterion, TestStatus, Verification } from '@personal-agent/contracts';
import type { CheckRegistry } from './checks.ts';
/** The frozen candidate could not be verified as frozen (changed artifact, unregistered check, bad cwd). */
export declare class VerificationUnavailable extends Error {
}
export interface VerificationPlan {
    candidate: CandidateRef;
    criteria: readonly Criterion[];
    /** The artifact digest captured at freeze time; verification binds to it. */
    artifactDigest: string;
    /** The frozen attempt worktree. */
    workspacePath: string;
    environmentRef: string;
    verifierIdentityRef?: string;
    /** Trusted exclusions decided by the composition root (for example a platform the check cannot target). */
    exclusions?: readonly {
        criterionId: string;
        outcome: 'SKIPPED' | 'NOT_APPLICABLE';
        reason: string;
    }[];
    /** Run before the first check and after the last; throw when the frozen artifact changed. */
    verifyArtifact?: () => void;
    /** Host environment values; only names declared by a check definition are passed through. */
    environment?: Readonly<Record<string, string | undefined>>;
}
export type CheckOutcome = TestStatus | 'NOT_APPLICABLE';
export interface CheckEvidence {
    criterionId: string;
    checkDefinitionRef?: string;
    definitionRevision?: number;
    outcome: CheckOutcome;
    exitCode?: number | null;
    signal?: string | null;
    durationMs: number;
    timedOut: boolean;
    missingDependency: boolean;
    outputDigest: string;
    outputExcerpt: string;
    reason?: string;
}
export interface VerificationRun {
    verification: Verification;
    evidence: readonly CheckEvidence[];
}
export declare class VerificationRunner {
    private readonly registry;
    private readonly identity;
    private readonly environment;
    private readonly now;
    constructor(registry: CheckRegistry, options?: {
        identity?: string;
        environment?: Readonly<Record<string, string | undefined>>;
        now?: () => number;
    });
    /**
     * Runs the registered checks for a frozen candidate. Exclusions are recorded as explicit
     * SKIPPED/NOT_APPLICABLE results; everything else runs with its definition's deadline and output
     * budget. A changed artifact or an unregistered check refuses to produce a Verification at all.
     */
    run(plan: VerificationPlan): VerificationRun;
    private checkFrozen;
    private execute;
}
//# sourceMappingURL=runner.d.ts.map