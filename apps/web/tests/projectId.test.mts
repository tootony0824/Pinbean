import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectId } from '../src/utils/projectId';

test('project IDs use native UUID when available', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  assert.equal(createProjectId({ randomUUID: () => id, getRandomValues: () => { throw new Error('unexpected fallback'); } }), id);
});

test('LAN HTTP fallback works without randomUUID and produces distinct UUID v4 identities', () => {
  const source = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  const ids = Array.from({ length: 100 }, () => createProjectId(source));
  assert.equal(new Set(ids).size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
