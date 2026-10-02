import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactStore, resolveInside } from '../src/persistence/artifact-store';
import { SessionStore } from '../src/persistence/session-store';

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-'));
}

test('SessionStore creates, lists and reloads sessions', () => {
  const root = workspace();
  const store = new SessionStore(root);
  const session = store.createSession({
    workspaceRoot: root,
    request: 'Build a todo app',
    planner: { provider: 'deepseek', model: 'm', thinking: 'high' },
    pi: { command: 'pi', mode: 'json', noSession: true },
  });
  assert.equal(store.listSessions().length, 1);
  const reloaded = store.loadSession(session.id);
  assert.equal(reloaded?.request, 'Build a todo app');
  assert.equal(reloaded?.status, 'draft');
});

test('ArtifactStore archives the previous attempt before a retry', () => {
  const root = workspace();
  const store = new ArtifactStore(root);
  store.writeTaskRequest('task-001', { task_id: 'task-001', attempt: 1 });
  store.appendEvents('task-001', ['{"kind":"progress"}']);
  store.writeResult('task-001', { attempt: 1, status: 'failed' } as never);

  store.writeTaskRequest('task-001', { task_id: 'task-001', attempt: 2 });

  const archived = path.join(root, 'tasks', 'task-001', 'attempts', 'attempt-1', 'request.json');
  assert.equal(fs.existsSync(archived), true);
  const current = JSON.parse(fs.readFileSync(path.join(root, 'tasks', 'task-001', 'request.json'), 'utf8'));
  assert.equal(current.attempt, 2);
});

test('ArtifactStore saves and reads artifacts', () => {
  const root = workspace();
  const store = new ArtifactStore(root);
  store.saveArtifact('architecture.md', '# Arch');
  assert.equal(store.readArtifact('architecture.md'), '# Arch');
  assert.equal(store.readArtifact('missing.md'), undefined);
});

test('resolveInside rejects path traversal', () => {
  const root = workspace();
  assert.throws(() => resolveInside(root, '../../etc/passwd'), /escapes allowed directory/);
  assert.equal(resolveInside(root, 'a/b.txt'), path.join(path.resolve(root), 'a', 'b.txt'));
});
