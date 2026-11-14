/**
 * Compile-time integration example for main. It is not part of the app bundle and not executed by
 * tests: it proves that the trial component, hook, contracts and console transport line up exactly as
 * the handoff describes. main copies the same shape into App.tsx; this file must keep compiling.
 */
import type { ApplicationConfiguration, TrialNavigationAction } from '@personal-agent/contracts'
import type { ConsoleTransport } from '../../src/transport.ts'
import { TrialWorkspace } from '../../src/trial/TrialWorkspace.tsx'
import { useTrialReadiness } from '../../src/trial/useTrialReadiness.ts'

export interface TrialMainCallbacks {
  openModelSettings(): void
  openProjectImport(): void
  openExecutors(): void
  openConversation(): void
}

/** Exhaustive: a new navigation name would fail the build instead of silently doing nothing. */
export const trialActionHandler = (callbacks: TrialMainCallbacks) => (action: TrialNavigationAction): void => {
  switch (action) {
    case 'configure_model': callbacks.openModelSettings(); return
    case 'import_project': callbacks.openProjectImport(); return
    case 'inspect_executor': callbacks.openExecutors(); return
    case 'open_conversation': callbacks.openConversation(); return
  }
}

export function TrialViewWiringExample({ transport, configuration, activeProjectId, activeConversationTitle, active, callbacks }: {
  readonly transport: ConsoleTransport
  readonly configuration: ApplicationConfiguration | undefined
  readonly activeProjectId: string | undefined
  readonly activeConversationTitle: string | undefined
  readonly active: boolean
  readonly callbacks: TrialMainCallbacks
}) {
  const probe = useTrialReadiness(transport, active)
  return (
    <TrialWorkspace
      readiness={probe.readiness}
      loading={probe.loading}
      error={probe.error}
      unavailable={probe.unavailable}
      configuration={configuration}
      activeProjectId={activeProjectId}
      activeConversationTitle={activeConversationTitle}
      onReload={probe.reload}
      onAction={trialActionHandler(callbacks)}
    />
  )
}
