import { z } from 'zod'
const path = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'), 'Path contains NUL')
export const ProjectEnvironmentInputSchema = z.discriminatedUnion('policy', [
  z.strictObject({ policy: z.literal('existing_only') }),
  z.strictObject({ policy: z.literal('offline_install'), storeDir: path.refine(value => value.startsWith('/'), 'An authorized offline store needs an absolute path') }),
])
export const ProjectRegistrationInputSchema = z.strictObject({
  path,
  displayName: z.string().trim().min(1).max(160).optional(),
  check: z.enum(['node_test', 'pnpm_test', 'npm_test']),
  environment: ProjectEnvironmentInputSchema.optional(),
})
export const WorkLocationSchema = z.strictObject({
  projectPath: path,
  workspacePath: path.nullable(),
  baseCommit: z
    .string()
    .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
    .nullable(),
})
export type ProjectRegistrationInput = z.infer<typeof ProjectRegistrationInputSchema>
export type WorkLocation = z.infer<typeof WorkLocationSchema>
export const WorkEnvironmentSchema = z.strictObject({
  protocol: z.literal('work-environment/1'),
  workId: z.string().min(1).max(256),
  status: z.enum(['not_configured', 'waiting', 'preparing', 'ready', 'blocked']),
  policy: z.enum(['existing_only', 'offline_install']).optional(),
  code: z.string().regex(/^[a-z_]{1,100}$/).optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})
export type WorkEnvironment = z.infer<typeof WorkEnvironmentSchema>
