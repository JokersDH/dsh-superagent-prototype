import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { UserCommandSchema } from '../src/index.ts';
import type { UserCommand, AgentDriverV1, ApplicationService, WorkView } from '../src/index.ts';

// The first frozen v1 consumer is deliberately limited to fields it understands.
function v1Consumer(input: unknown): string {
  const command: UserCommand = UserCommandSchema.parse(input);
  if (command.kind !== 'chat') throw new Error('This consumer handles chat only');
  return `${command.projectId}:${command.text}`;
}

test('frozen v1 client fixture remains readable by a narrow consumer', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/v1-client.json', import.meta.url), 'utf8'));
  assert.equal(v1Consumer(fixture), 'project-1:Discuss CSV export.');
  assert.equal(v1Consumer({ ...fixture, selectedProfileId: 'profile-1' }), 'project-1:Discuss CSV export.');
});

// Compile-only consumer contract: ports remain type-only and do not import a native runtime.
export function consumePorts(driver: AgentDriverV1, app: ApplicationService, view: WorkView): [AgentDriverV1, ApplicationService, string] {
  return [driver, app, view.work.id];
}
