/** The attempt an attempt-worktree belongs to; the Assignment identity is recorded, never invented. */
export interface AssignmentIdentity {
    ticketId: string;
    assignmentId: string;
    attemptId: string;
    fenceEpoch: number;
    contract: {
        workId: string;
        revision: number;
        digest: string;
    };
}
export interface UserWorktreeSnapshot {
    /** The repository's HEAD at reserve time, which is also the attempt's base commit. */
    baseCommit: string;
    /** Patch of the user's tracked dirty changes at reserve time, kept as audit evidence only. */
    patchPath: string;
    changedFiles: readonly string[];
    untrackedFiles: readonly string[];
}
export interface ReservedWorkspace {
    attemptId: string;
    /** The attempt worktree path (under our root; not the user's tree). */
    path: string;
    projectPath: string;
    baseCommit: string;
    userWorktree: UserWorktreeSnapshot;
    /** Worktrees share the user repository's git metadata and are not a security sandbox. */
    sharedGitMetadata: 'user_repository';
}
export interface FrozenArtifact {
    attemptId: string;
    baseCommit: string;
    headCommit: string;
    artifactDigest: string;
    manifestPath: string;
    files: number;
    dirty: boolean;
    environment: Readonly<Record<string, string>>;
}
export interface ReserveOptions {
    /** The user's project repository (read-only for this manager). */
    projectPath: string;
    assignment: AssignmentIdentity;
    /** Base commit for the attempt worktree; defaults to the project's HEAD. */
    baseCommit?: string;
}
export declare class WorkspaceConflict extends Error {
}
export declare class WorkspaceManager {
    private readonly rootDir;
    constructor(rootDir: string);
    get attemptRoot(): string;
    get manifestRoot(): string;
    private recordPath;
    private patchPath;
    attemptPath(attemptId: string): string;
    /**
     * Reserves a detached worktree for an attempt at the project's base commit. The user's dirty
     * tracked changes are written to an audit patch; the user's worktree itself is never modified.
     */
    reserve(options: ReserveOptions): ReservedWorkspace;
    /**
     * Freezes the attempt worktree: a manifest of every regular file (and symlink) with its digest,
     * the base/head commits and the worktree's dirty status. The returned digest is the artifact
     * identity the verification binds to; later changes make it differ.
     */
    freeze(ref: {
        attemptId: string;
    }): FrozenArtifact;
    /** Recomputes the artifact digest of the attempt worktree, for staleness checks before and after verification. */
    digest(ref: {
        attemptId: string;
    }): string;
    /** Removes the attempt's own worktree; the user's project worktree is untouched and the manifest stays for audit. */
    release(ref: {
        attemptId: string;
    }): void;
    private record;
}
//# sourceMappingURL=workspace.d.ts.map