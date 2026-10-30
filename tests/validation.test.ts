import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateToolArgs, getToolValidator } from '../src/mcp/validation';
import { allTools } from '../src/mcp/tools';

/**
 * Runtime validation of tool arguments.
 *
 * Before the validator existed the JSON Schemas the server advertised in
 * `tools/list` were advisory only: the server passed `arguments` straight
 * to the handler, so an unknown enum value, a missing required property
 * or an undeclared property were all silently accepted — and a handler
 * that fell back to a default would do so without a word.
 */

function schemaOf(name: string) {
  const found = allTools.find((t) => t.name === name);
  assert.ok(found, `tool "${name}" is not registered`);
  return found.inputSchema;
}

function check(name: string, args: unknown) {
  return validateToolArgs(name, schemaOf(name), args);
}

test('every registered tool schema compiles into a validator', () => {
  for (const tool of allTools) {
    assert.doesNotThrow(
      () => getToolValidator(tool.name, tool.inputSchema),
      `schema of "${tool.name}" does not compile`,
    );
  }
});

test('valid arguments pass validation', () => {
  const result = check('list-tariffs', { period: 'monthly' });
  assert.equal(result.ok, true);
});

test('an unknown enum value is rejected and the allowed values are listed', () => {
  const result = check('list-tariffs', { period: 'weekly' });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : '', /"period"/);
  assert.match(result.ok === false ? result.message : '', /must be one of: "monthly", "annual"/);
});

test('an undeclared property is rejected by name', () => {
  const result = check('list-tariffs', { period: 'monthly', period_typo: 'monthly' });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : '', /"period_typo"/);
  assert.match(result.ok === false ? result.message : '', /unexpected property/);
});

test('a wrong type is rejected instead of being coerced', () => {
  const result = check('list-models', { active_only: 'true' });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : '', /"active_only": must be boolean/);
});

test('a missing required property is reported by name', () => {
  const result = check('wait-for-response', {});
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : '', /"chat_id": is required/);
});

test('a nested argument path is reported', () => {
  const result = check('upload-files', { files: [{ filename: 'x.txt' }] });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : '', /files\[0\]/);
});

test('anyOf branch errors collapse into a single readable violation', () => {
  const result = check('upload-files', { files: [{ filename: 'x.txt' }] });
  assert.equal(result.ok, false);
  const message = result.ok === false ? result.message : '';
  const violations = message.split('\n').filter((line) => line.startsWith('  - '));
  assert.equal(violations.length, 1);
  assert.match(violations[0], /does not match any accepted shape/);
});

test('no arguments at all is treated as an empty object', () => {
  const result = check('list-tariffs', undefined);
  assert.equal(result.ok, true);
});

test('a tool with required properties rejects an empty argument object', () => {
  const result = check('rename-chat', {});
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : '', /"chat_id": is required/);
  assert.match(result.ok === false ? result.message : '', /"title": is required/);
});
