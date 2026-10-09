import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { missingDeclaredOutputs, toWorkspaceRelative } from '../src/orchestration/executor';

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

test('missingDeclaredOutputs lists the outputs a completed run failed to produce', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-'));
  fs.writeFileSync(path.join(workspace, 'present.json'), '[]', 'utf8');

  assert.deepEqual(missingDeclaredOutputs(workspace, ['present.json']), []);
  assert.deepEqual(missingDeclaredOutputs(workspace, ['present.json', 'data/raw/missing.json']), [
    'data/raw/missing.json',
  ]);
  // Empty declaration: nothing is required.
  assert.deepEqual(missingDeclaredOutputs(workspace, []), []);
  // A path escaping the workspace counts as missing, never as present.
  assert.deepEqual(missingDeclaredOutputs(workspace, ['../secret.txt']), ['../secret.txt']);
});

test('missingDeclaredOutputs accepts a .gitkeep whose folder exists', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-'));
  fs.mkdirSync(path.join(workspace, 'data', 'raw'), { recursive: true });

  // Folder created, placeholder file not: the folder was what the task promised.
  assert.deepEqual(missingDeclaredOutputs(workspace, ['data/raw/.gitkeep']), []);
  // Folder missing: the placeholder is still reported.
  assert.deepEqual(missingDeclaredOutputs(workspace, ['out/.gitkeep']), ['out/.gitkeep']);
});
