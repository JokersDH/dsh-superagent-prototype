import { z } from 'zod';
import { ContractRevisionSchema, CriticalFactSchema, QuestionAnswerSchema, RuntimeFactPayloadSchema, UserQuestionSchema } from './schemas.ts';
import type { ContractRevision, CriticalFact, QuestionAnswer, RuntimeFactPayload, UserQuestion } from './types.ts';

function invalid(message: string, path: PropertyKey[] = []): never {
  throw new z.ZodError([{ code: 'custom', message, path }]);
}

/** Registration belongs to the trusted project configuration, never a command payload. */
export function parseContractRevision(input: unknown, registeredMachineChecks: ReadonlySet<string>): ContractRevision {
  const contract = ContractRevisionSchema.parse(input);
  for (const criterion of contract.criteria) {
    if (criterion.kind === 'machine' && criterion.required && !registeredMachineChecks.has(criterion.checkDefinitionRef)) {
      invalid('Required machine criterion is not registered', ['criteria']);
    }
  }
  return contract;
}

/** This validates data only. The Broker still atomically checks current version, binding and generation. */
export function parseQuestionAnswer(questionInput: UserQuestion, input: unknown, now = new Date()): QuestionAnswer {
  const question = UserQuestionSchema.parse(questionInput);
  const answer = QuestionAnswerSchema.parse(input);
  if (!Number.isFinite(now.getTime())) invalid('Invalid validation time');
  if (question.validity !== 'open' || (question.expiresAt && Date.parse(question.expiresAt) <= now.getTime())) invalid('Question is no longer open');
  if (answer.kind === 'defer') return answer;
  const presentation = question.presentation;
  if (presentation.kind === 'choices' || presentation.kind === 'review') {
    if (answer.kind !== 'choices') invalid('Answer must use the original native option IDs');
    const multiple = presentation.kind === 'choices' && presentation.multiple;
    if (!multiple && answer.optionIds.length !== 1) invalid('This question accepts one option');
    const allowed = new Set(presentation.options.map(option => option.id));
    if (answer.optionIds.some(id => !allowed.has(id))) invalid('Unknown answer option');
  } else if (presentation.kind === 'free_text') {
    if (answer.kind !== 'free_text') invalid('A text answer is required');
  } else if (presentation.kind === 'url_flow') {
    if (answer.kind !== 'url_action') invalid('A native URL action is required');
  } else {
    if (answer.kind !== 'form') invalid('A form answer is required');
    const fields = new Map(presentation.fields.map(field => [field.id, field]));
    for (const id of Object.keys(answer.values)) if (!fields.has(id)) invalid('Unknown form field');
    for (const field of presentation.fields) {
      const value = answer.values[field.id];
      if (value === undefined) {
        if (field.required) invalid('Required form field is missing', [field.id]);
        continue;
      }
      if (field.kind === 'text') {
        if (typeof value !== 'string' || (field.required && !value.trim())) invalid('Invalid text field', [field.id]);
      } else if (field.kind === 'boolean') {
        if (typeof value !== 'boolean') invalid('Invalid boolean field', [field.id]);
      } else {
        const selected = field.kind === 'single' ? (typeof value === 'string' ? [value] : undefined) : (Array.isArray(value) ? value : undefined);
        if (!selected || (field.required && selected.length === 0) || new Set(selected).size !== selected.length || selected.some(id => !field.options.some(option => option.id === id))) invalid('Invalid form option', [field.id]);
      }
    }
  }
  return answer;
}

/** Payload references are resolved by the host; state/epoch freshness is checked in the ingress transaction. */
export function parseRuntimeFactPayload(factInput: CriticalFact, input: unknown): RuntimeFactPayload {
  const fact = CriticalFactSchema.parse(factInput);
  const payload = RuntimeFactPayloadSchema.parse(input);
  if (fact.kind !== payload.kind) invalid('Runtime fact kind and payload must agree');
  const matches = (ref: { ticketId: string; assignmentId: string; attemptId: string; fenceEpoch: number; contract: { workId: string; revision: number; digest: string } }) =>
    ref.ticketId === fact.ticketId && ref.assignmentId === fact.assignmentId && ref.attemptId === fact.attemptId && ref.fenceEpoch === fact.fenceEpoch && ref.contract.workId === fact.contract.workId && ref.contract.revision === fact.contract.revision && ref.contract.digest === fact.contract.digest;
  if (payload.kind === 'policy.prepared' && !matches(payload.value)) invalid('Prepared policy belongs to another attempt');
  if (payload.kind === 'question.opened' && !payload.value.targets.some(matches)) invalid('Question has no target belonging to the reporting attempt');
  return payload;
}
