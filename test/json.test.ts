import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, stripCodeFences } from '../src/utils/json';

test('stripCodeFences removes markdown fences', () => {
  assert.equal(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}');
});

test('extractJson parses fenced JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('extractJson finds JSON embedded in prose', () => {
  const text = 'Here is the plan:\n{"project":{"title":"x"},"tasks":[]}\nDone.';
  assert.deepEqual(extractJson(text), { project: { title: 'x' }, tasks: [] });
});

test('extractJson handles braces inside strings', () => {
  const text = '{"prompt":"use { and } carefully"}';
  assert.deepEqual(extractJson(text), { prompt: 'use { and } carefully' });
});

test('extractJson throws when there is no JSON', () => {
  assert.throws(() => extractJson('no json here'), /no JSON object found/);
});
