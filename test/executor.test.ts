import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { toWorkspaceRelative } from '../src/orchestration/executor';

const root = path.resolve('/tmp/ws');

test('toWorkspaceRelative keeps relative paths', () => {
  assert.equal(toWorkspaceRelative(root, 'md2pdf/cli.py'), 'md2pdf/cli.py');
});

test('toWorkspaceRelative makes absolute in-workspace paths relative', () => {
  const absolute = path.join(root, 'tests', 'fixtures', 'sample.md');
  assert.equal(toWorkspaceRelative(root, absolute), 'tests/fixtures/sample.md');
});

test('toWorkspaceRelative rejects paths outside the workspace', () => {
  assert.equal(toWorkspaceRelative(root, path.join(root, '..', 'secret.txt')), undefined);
  assert.equal(toWorkspaceRelative(root, '../secret.txt'), undefined);
});
