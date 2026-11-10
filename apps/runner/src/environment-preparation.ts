import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { AttemptRefSchema, IdSchema, JsonSchema } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { AttemptSpec, AttemptIO } from '@personal-agent/contracts'
import { prepareAuthoritativeEnvironment, verifyPreparedEnvironment } from '../../../packages/environment-preparation/src/index.ts'
import { RunnerCommandProcess } from './command-process.ts'
import type { ProcessHost } from './process-host.ts'

const absolute = z.string().min(1).max(4096).refine(isAbsolute).refine(value => !value.includes('\0'))
export const EnvironmentPlanSchema = z.strictObject({
  kind: z.literal('runner-environment-plan/1'),
  attempt: AttemptRefSchema,
  requestId: IdSchema,
  projectPath: absolute,
  workspacePath: absolute,
  authorityRoot: absolute,
  policy: z.enum(['existing_only', 'offline_install']),
  managerCommand: absolute.optional(),
  storeDir: absolute.optional(),
})
export const PreparedEnvironmentRefSchema = z.strictObject({
  protocol: z.literal('environment-ref/2'), authorityRoot: absolute,
  receiptId: z.string().regex(/^[a-f0-9]{64}$/), requestId: IdSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), workspacePath: absolute,
})
export const EnvironmentOutcomeSchema = z.strictObject({
  kind: z.literal('runner-environment-outcome/1'),
  planRef: IdSchema,
  attempt: AttemptRefSchema,
  status: z.enum(['ready', 'blocked']),
  ref: PreparedEnvironmentRefSchema.optional(),
  code: z.string().regex(/^[a-z_]{1,100}$/).optional(),
}).superRefine((value, ctx) => {
  if ((value.status === 'ready') !== !!value.ref || (value.status === 'blocked') !== !!value.code)
    ctx.addIssue({ code: 'custom', message: 'Preparation outcome needs exact proof or a blocked code' })
})
export type EnvironmentPlan = z.infer<typeof EnvironmentPlanSchema>
export type EnvironmentOutcome = z.infer<typeof EnvironmentOutcomeSchema>

function privateRoot(root: string) {
  const stat = lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid()))
    throw new Error('Unsafe environment outcome root')
}

export function readEnvironmentOutcome(plan: EnvironmentPlan): EnvironmentOutcome {
  privateRoot(plan.authorityRoot)
  const fd = openSync(join(plan.authorityRoot, 'outcome.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 16384 || stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid()))
      throw new Error('Unsafe preparation outcome')
    return EnvironmentOutcomeSchema.parse(JSON.parse(readFileSync(fd, 'utf8')))
  } finally { closeSync(fd) }
}

function writeOutcome(plan: EnvironmentPlan, outcome: EnvironmentOutcome) {
  mkdirSync(plan.authorityRoot, { recursive: true, mode: 0o700 })
  privateRoot(plan.authorityRoot)
  const bytes = Buffer.from(JSON.stringify(EnvironmentOutcomeSchema.parse(outcome)) + '\n')
  const fd = openSync(join(plan.authorityRoot, 'outcome.json'), 'wx', 0o600)
  try {
    for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  const directory = openSync(plan.authorityRoot, 'r')
  try { fsyncSync(directory) } finally { closeSync(directory) }
}

export async function prepareRunnerEnvironment(
  planRef: string, spec: AttemptSpec,
  context: { io: AttemptIO; processHost: ProcessHost; signal: AbortSignal },
): Promise<void> {
  const payload = await context.io.payloads.read(planRef)
  if (planRef !== `payload:${canonicalDigest(payload)}`) throw new Error('Preparation plan payload is not immutable')
  const plan = EnvironmentPlanSchema.parse(payload)
  const identity = AttemptRefSchema.parse({ ticketId: spec.ticketId, assignmentId: spec.assignmentId,
    attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract })
  if (canonicalDigest(JsonSchema.parse(plan.attempt)) !== canonicalDigest(JsonSchema.parse(identity)) || plan.requestId !== spec.attemptId)
    throw new Error('Preparation plan targets another attempt')
  const port = new RunnerCommandProcess(context.processHost)
  const prepared = await prepareAuthoritativeEnvironment({
    projectPath: plan.projectPath, workspacePath: plan.workspacePath,
    requestId: plan.requestId, authorityRoot: plan.authorityRoot,
    policy: plan.policy, processPort: port, signal: context.signal,
    ...(plan.managerCommand ? { managerCommand: plan.managerCommand } : {}),
    ...(plan.storeDir ? { storeDir: plan.storeDir } : {}),
    // Only actual environment paths will later be admitted by the coordinator adapter.
    exclusion: { excludedPaths: () => [] },
  })
  const outcome: EnvironmentOutcome = prepared.status === 'ready' && prepared.environmentRef
    ? { kind: 'runner-environment-outcome/1', planRef, attempt: identity, status: 'ready', ref: prepared.environmentRef }
    : { kind: 'runner-environment-outcome/1', planRef, attempt: identity, status: 'blocked', code: prepared.status === 'blocked' ? prepared.code : 'environment_proof_missing' }
  writeOutcome(plan, outcome)
  if (outcome.status !== 'ready' || !outcome.ref || context.signal.aborted ||
      realpathSync(outcome.ref.workspacePath) !== realpathSync(plan.workspacePath) || verifyPreparedEnvironment(outcome.ref).status !== 'valid')
    throw Object.assign(new Error('Project environment preparation is blocked'), { reason: outcome.code ?? 'environment_invalid' })
}
