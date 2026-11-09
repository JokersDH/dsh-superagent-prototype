import { setTimeout } from 'node:timers/promises'
import type { AssistantStreamUpdate } from '@personal-agent/contracts'

/** Ephemeral display snapshots; only the committed conversation message is a durable answer. */
export class AssistantStreams {
  private readonly replies = new Map<string, AssistantStreamUpdate>()
  private readonly controllers = new Map<string, AbortController>()
  start(input: Pick<AssistantStreamUpdate, 'messageId' | 'conversationId' | 'projectId' | 'replyId' | 'model'>) {
    for (const [id, reply] of this.replies) {
      if (this.replies.size < 64) break
      if (reply.phase !== 'streaming') this.replies.delete(id)
    }
    this.replies.set(input.messageId, {
      ...input,
      protocol: 'assistant-stream/1',
      revision: 1,
      phase: 'streaming',
      text: '',
    })
    const controller = new AbortController()
    this.controllers.set(input.messageId, controller)
    return controller.signal
  }
  append(messageId: string, text: string) {
    const previous = this.replies.get(messageId)
    if (!previous || previous.phase !== 'streaming') return
    if (previous.text.length + text.length > 32768) throw new RangeError('Assistant display limit exceeded')
    this.replies.set(messageId, { ...previous, revision: previous.revision + 1, text: previous.text + text })
  }
  finish(messageId: string, phase: 'complete' | 'interrupted') {
    this.controllers.delete(messageId)
    const previous = this.replies.get(messageId)
    if (previous) this.replies.set(messageId, { ...previous, revision: previous.revision + 1, phase })
  }
  close() {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }
  async *changes(conversationId: string, signal: AbortSignal): AsyncIterable<AssistantStreamUpdate> {
    const seen = new Map<string, number>()
    while (!signal.aborted) {
      for (const reply of this.replies.values()) {
        if (reply.conversationId !== conversationId || seen.get(reply.messageId) === reply.revision) continue
        seen.set(reply.messageId, reply.revision)
        yield reply
      }
      try {
        await setTimeout(75, undefined, { signal })
      } catch (error) {
        if (!signal.aborted) throw error
      }
    }
  }
}
