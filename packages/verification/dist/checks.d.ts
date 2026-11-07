export interface CheckDefinition {
    /** The ID a contract criterion's `checkDefinitionRef` names. */
    id: string;
    /** Immutable revision of this definition; a changed body must use a new revision. */
    revision: number;
    title?: string;
    executable: string;
    argv: readonly string[];
    /** Working directory relative to the frozen workspace; must stay inside it. */
    cwd?: string;
    /** Environment variable names passed through from the host; nothing else is inherited. */
    allowedEnvironment?: readonly string[];
    deadlineMs: number;
    /** Captured stdout+stderr byte budget; exceeding it fails the check instead of buffering without bound. */
    outputLimitBytes: number;
}
export declare class CheckConflict extends Error {
}
export declare class UnknownCheck extends Error {
}
export declare class InvalidCheck extends Error {
}
export declare class CheckRegistry {
    private readonly byId;
    /** Registers an immutable revision; the same ID and revision with a different body conflicts. */
    register(definition: CheckDefinition): void;
    /** The newest revision of a registered check ID, if any. */
    latest(id: string): Readonly<CheckDefinition> | undefined;
    /** One exact revision, or the newest when `revision` is omitted. */
    get(id: string, revision?: number): Readonly<CheckDefinition> | undefined;
    /** Resolves a criterion's check reference; an unregistered check is refused (fail closed). */
    require(id: string): Readonly<CheckDefinition>;
    ids(): string[];
}
//# sourceMappingURL=checks.d.ts.map