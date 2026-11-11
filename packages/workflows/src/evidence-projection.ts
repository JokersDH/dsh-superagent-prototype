/**
 * Deterministic projection of bounded work evidence (0025 semantics) so main does not infer table
 * contents itself. It is not a quality score or permission: `recorded` only means the current
 * accepted outcome is inside the observed window.
 */
export type WorkEvidenceProjection = 'recorded' | 'source_missing' | 'not_in_window' | 'not_accepted'

export function projectWorkEvidence(input: {
  /** The application's current work phase indicates a delivered/ended candidate. */
  delivered: boolean
  /** A trusted accepted outcome exists for the current contract revision/digest and verification. */
  currentAccepted: boolean
  /** Window reported by WorkflowIndex.evidencePage (or timeline truncation mapped to bounded). */
  window: 'complete' | 'caller_limit' | 'storage_cap'
}): WorkEvidenceProjection {
  if (input.currentAccepted) return 'recorded'
  if (!input.delivered) return 'not_accepted'
  return input.window === 'complete' ? 'source_missing' : 'not_in_window'
}
