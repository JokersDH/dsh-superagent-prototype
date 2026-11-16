export type HistorySourceState = 'complete' | 'truncated' | 'unknown'
export type HistoryWindowState = 'complete' | 'truncated_local' | 'truncated_source' | 'unknown'
export interface HistoryWindowInput {
  readonly sourceState: string | null | undefined
  readonly total: number
  readonly offset: number
  readonly limit: number
}
export interface HistoryWindow {
  readonly sourceState: HistorySourceState
  readonly state: HistoryWindowState
  readonly complete: boolean
  readonly offset: number
  readonly limit: number
  readonly returned: number
  readonly availableKnown: boolean
  readonly available: number | null
  readonly localTruncated: boolean
  readonly truncated: boolean
  readonly nextOffset?: number
}
export function normalizeSourceState(value: string | null | undefined): HistorySourceState
export function composeHistoryWindow(input: HistoryWindowInput): HistoryWindow
