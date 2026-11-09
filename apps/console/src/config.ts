/** Console local configuration; the product API never accepts an actor or identity from here. */
const list = (value: unknown, fallback: readonly string[]): readonly string[] => {
  if (typeof value !== 'string' || !value.trim()) return fallback
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

export const conversationId: string = import.meta.env.VITE_CONVERSATION_ID ?? 'conv-main'
/** Profiles the trusted composition accepts; the console only offers registered IDs. */
export const profileIds: readonly string[] = list(import.meta.env.VITE_PROFILE_IDS, ['profile-codex-local'])
export const defaultProfileId: string = import.meta.env.VITE_DEFAULT_PROFILE ?? profileIds[0] ?? 'profile-codex-local'
/** Registered machine check referenced by the create-work form. */
export const checkDefinitionRef: string = import.meta.env.VITE_CHECK_DEFINITION ?? 'check:unit'
export const checkCriterionId: string = import.meta.env.VITE_CHECK_CRITERION_ID ?? 'unit'
