const INJECTION_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'ignore_previous_instructions', pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i },
  { label: 'disregard_system_prompt', pattern: /disregard\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|message)/i },
  { label: 'role_reassignment', pattern: /\byou\s+are\s+now\s+(?:a|an|the)\b/i },
  { label: 'zh_ignore_instructions', pattern: /忽略(?:以上|之前|前面)(?:的)?(?:所有)?(?:指令|要求|提示)/ },
  { label: 'fake_system_turn', pattern: /(?:^|\n)\s*(?:system|developer|assistant)\s*[:：]/i },
  { label: 'tool_authorization_claim', pattern: /\b(?:grant|enable|allow)\s+(?:me|the\s+assistant)\s+(?:to\s+)?(?:run|execute|write|delete)/i },
]

/**
 * Records instruction-like text so the UI can warn. The result is observability only: it never
 * changes authorization, budgets or the trust level of the content.
 */
export function detectInjectionPatterns(content: string): readonly string[] {
  const labels: string[] = []
  for (const { label, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(content)) labels.push(label)
  }
  return labels
}
