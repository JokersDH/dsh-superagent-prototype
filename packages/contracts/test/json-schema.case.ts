import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';
import { validFixtures, criterion, question } from './fixtures.ts';

const document = JSON.parse(readFileSync(new URL('../generated/contracts.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false });
const addFormats = createRequire(import.meta.url)('ajv-formats') as FormatsPlugin;
addFormats(ajv);
ajv.addSchema(document);
for (const [name, fixture] of Object.entries(validFixtures)) {
  test(`JSON Schema: ${name} compiles and validates its wire fixture`, () => {
    const validate = ajv.getSchema(`${document.$id}#/$defs/${name}`);
    assert.ok(validate, `Missing JSON Schema definition: ${name}`);
    assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  });
}
test('JSON Schema independently rejects empty/optional-only acceptance and unprepared begin', () => {
  const criteria = ajv.getSchema(`${document.$id}#/$defs/RequiredCriteria`)!;
  assert.equal(criteria([]), false);
  assert.equal(criteria([{ ...criterion, required: false }]), false);
  assert.equal(criteria([criterion]), true);
  const command = ajv.getSchema(`${document.$id}#/$defs/RunnerCommand`)!;
  assert.equal(command({ kind: 'begin', id: 'command-1' }), false);
  const user = ajv.getSchema(`${document.$id}#/$defs/UserCommand`)!;
  assert.equal(user({ ...validFixtures.UserCommand, actor: { kind: 'human' } }), false);
});
test('schema and manifest explicitly require runtime semantic validation', () => {
  assert.ok(document['x-runtime-validation']);
  const validate = ajv.getSchema(`${document.$id}#/$defs/UserQuestion`)!;
  // Cross-field native permission constraints are enforced by Zod, not concealed as JSON Schema certification.
  assert.equal(validate({ ...question, presentation: { kind: 'free_text' } }), true);
  assert.ok(document.$defs.UserQuestion['x-runtime-rules'].includes('question-kind-presentation'));
});
test('generated JSON, TypeScript aliases and identity are reproducible without writes', () => {
  execFileSync(process.execPath, ['tools/generate.ts', '--check'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe' });
});
