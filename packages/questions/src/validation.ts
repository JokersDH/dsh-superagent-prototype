import type { QuestionAnswer, Scope, UserQuestion } from '@personal-agent/contracts'

/** Conservative set containment over declared scope atoms, not an invented glob-inclusion engine. */
export function scopeWithin(scope: Scope, grant: Scope): boolean {
  return (
    scope.projectId === grant.projectId &&
    scope.allowedPaths.every((path) => grant.allowedPaths.includes(path)) &&
    grant.excludedPaths.every((path) => scope.excludedPaths.includes(path)) &&
    scope.externalActions.every((action) => grant.externalActions.includes(action)) &&
    (!grant.expiresAt || (!!scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(grant.expiresAt)))
  )
}

export function answerMatches(question: UserQuestion, answer: QuestionAnswer): boolean {
  if (answer.kind === 'defer') return true
  const presentation = question.presentation
  if (presentation.kind === 'url_flow') return answer.kind === 'url_action'
  if (presentation.kind === 'free_text') return answer.kind === 'free_text'
  if (presentation.kind === 'choices' || presentation.kind === 'review') {
    if (answer.kind !== 'choices') return false
    if (
      (question.kind !== 'clarification' || presentation.kind === 'review' || !presentation.multiple) &&
      answer.optionIds.length !== 1
    )
      return false
    return answer.optionIds.every((id) => presentation.options.some((option) => option.id === id))
  }
  if (answer.kind !== 'form') return false
  if (Object.keys(answer.values).some((id) => !presentation.fields.some((field) => field.id === id))) return false
  return presentation.fields.every((field) => {
    const value = answer.values[field.id]
    if (value === undefined) return !field.required
    if (field.kind === 'text') return typeof value === 'string' && (!field.required || value.trim().length > 0)
    if (field.kind === 'boolean') return typeof value === 'boolean'
    if (field.kind === 'single') return typeof value === 'string' && field.options.some((option) => option.id === value)
    return (
      Array.isArray(value) &&
      (!field.required || value.length > 0) &&
      new Set(value).size === value.length &&
      value.every((id) => field.options.some((option) => option.id === id))
    )
  })
}
