import { z } from 'zod'
const path = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'), 'Path contains NUL')
export const ProjectRegistrationInputSchema = z.strictObject({
  path,
  displayName: z.string().trim().min(1).max(160).optional(),
  check: z.enum(['node_test', 'pnpm_test', 'npm_test']),
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
