/**
 * Read-only support/diagnostic summary for the trial workspace. It never runs commands, reads private
 * state or exports credentials: every value comes from props or the published readiness projection and
 * is rendered as plain text. Package/source labels are supplied by main/D; missing labels stay explicit.
 */
import type { TrialReadiness } from '@personal-agent/contracts'

export interface TrialSupportInfo {
  /** Exact installation/build label supplied by main/D, e.g. "8296720 / tar 049267…". */
  readonly packageLabel?: string | undefined
  /** Current source identity supplied by main, e.g. "main 303b2c6a". */
  readonly sourceLabel?: string | undefined
  /** Optional short note; rendered as text and bounded. */
  readonly note?: string | undefined
}

export interface TrialSupportRow {
  readonly label: string
  readonly value: string
}

const bounded = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max)}…`)

export function trialSupportRows(input: {
  readonly readiness: TrialReadiness | undefined
  readonly projectLabel: string
  readonly conversationLabel: string
  readonly windowDays: 7 | 30 | undefined
  readonly info: TrialSupportInfo | undefined
}): readonly TrialSupportRow[] {
  const { readiness } = input
  const mode = readiness === undefined ? '未观察'
    : readiness.mode === 'fixture' ? '固定流程' : readiness.mode === 'product' ? '产品模式' : '个人模式'
  const startup = readiness === undefined ? '未观察' : readiness.startupMode === 'recovery_readonly' ? '只读恢复' : '正常启动'
  const info = input.info
  return [
    { label: '运行模式', value: readiness === undefined ? mode : `${mode} · ${startup}` },
    { label: '当前项目', value: input.projectLabel },
    { label: '当前对话', value: input.conversationLabel },
    { label: '观察窗口', value: input.windowDays === undefined ? '未选择' : `${input.windowDays} 天` },
    { label: '配置', value: readiness === undefined ? '未观察' : readiness.configurationRevision.slice(0, 8) },
    { label: '观察时间', value: readiness === undefined ? '未观察' : readiness.observedAt },
    { label: '包', value: info?.packageLabel === undefined ? '未提供' : bounded(info.packageLabel, 200) },
    { label: '来源', value: info?.sourceLabel === undefined ? '未声明' : bounded(info.sourceLabel, 200) },
  ]
}
