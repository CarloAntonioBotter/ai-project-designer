import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildTaskContext, collectWorkspaceSummary, MAX_FILE_CHARS } from '../src/orchestration/context-builder';

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-ctx-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# Readme');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export {};');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'dep.js'), '');
  return root;
}

test('buildTaskContext reads declared files and keeps explicit constraints', () => {
  const root = makeWorkspace();
  const context = buildTaskContext({
    workspaceRoot: root,
    filesToRead: ['README.md', 'missing.md'],
    constraints: ['no network'],
  });
  assert.equal(context.files[0].content, '# Readme');
  assert.match(context.files[1].content, /file not found/);
  assert.deepEqual(context.constraints, ['no network']);
});

test('buildTaskContext truncates oversized files', () => {
  const root = makeWorkspace();
  fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(MAX_FILE_CHARS + 100));
  const context = buildTaskContext({ workspaceRoot: root, filesToRead: ['big.txt'] });
  assert.equal(context.files[0].truncated, true);
  assert.equal(context.files[0].content.length, MAX_FILE_CHARS);
});

test('buildTaskContext rejects path traversal', () => {
  const root = makeWorkspace();
  assert.throws(
    () => buildTaskContext({ workspaceRoot: root, filesToRead: ['../../secret.txt'] }),
    /escapes allowed directory/
  );
});

test('collectWorkspaceSummary ignores node_modules', () => {
  const root = makeWorkspace();
  const summary = collectWorkspaceSummary(root);
  assert.match(summary, /README\.md/);
  assert.doesNotMatch(summary, /node_modules/);
});
