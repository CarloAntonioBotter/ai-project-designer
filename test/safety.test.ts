import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionStore } from '../src/persistence/session-store';
import { ArtifactStore } from '../src/persistence/artifact-store';
import { atomicWrite, resolveInside } from '../src/persistence/paths';
import { validatePlan, planToTasks } from '../src/models/validate';
import { buildTaskContext, MAX_TOTAL_CONTEXT_CHARS } from '../src/orchestration/context-builder';
import { fileFingerprint } from '../src/orchestration/executor';

function fixture(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const plan = (id: string) => ({ project: { title: 'test' }, tasks: [{ id, title: 'test', objective: 'test', executorPrompt: 'test' }] });

test('unsafe and Windows-reserved IDs are rejected before writes and deletion', (t) => {
  const root = fixture(t);
  const sessions = new SessionStore(root);
  const artifacts = new ArtifactStore(root);
  fs.mkdirSync(path.join(root, 'victim'));
  for (const id of ['../victim', '../../victim', 'a/b', 'a\\b', '..', '.', 'CON', 'nul', 'a:b']) {
    assert.equal(validatePlan(plan(id)).ok, false, id);
    assert.throws(() => artifacts.writeTaskRequest(id, { attempt: 1 }));
    assert.throws(() => sessions.deleteSession(id));
  }
  assert.ok(fs.existsSync(path.join(root, 'victim')));
});

test('links and junctions cannot escape managed roots', (t) => {
  const root = fixture(t);
  const inside = path.join(root, 'inside');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(inside); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(inside, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => resolveInside(inside, 'link/secret.txt'), /link/);
  assert.throws(() => resolveInside(inside, 'link/new.txt'), /link/);
  assert.throws(() => buildTaskContext({ workspaceRoot: inside, filesToRead: ['link/secret.txt'] }));
  fs.symlinkSync(outside, path.join(inside, '.ai-project'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => new SessionStore(inside).listSessions(), /link/);
});

test('attempt numbers survive resets; archive collisions fail without overwriting', (t) => {
  const store = new ArtifactStore(fixture(t));
  for (let n = 1; n <= 3; n++) {
    assert.equal(store.nextAttempt('task-A'), n);
    store.writeTaskRequest('task-A', { attempt: n });
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(store.taskDir('task-A'), 'attempts/attempt-1/request.json'), 'utf8')).attempt, 1);
  // Simulate a duplicate number in legacy data.
  atomicWrite(path.join(store.taskDir('task-A'), 'request.json'), '{"attempt":1}');
  assert.throws(() => store.writeTaskRequest('task-A', { attempt: 4 }));
  assert.ok(fs.existsSync(path.join(store.taskDir('task-A'), 'request.json')));
});

test('artifact references are immutable across tasks and attempts', (t) => {
  const store = new ArtifactStore(fixture(t));
  const first = store.saveArtifact('shared.txt', 'A1', 'task-A', 1);
  const second = store.saveArtifact('shared.txt', 'B1', 'task-B', 1);
  const retry = store.saveArtifact('shared.txt', 'A2', 'task-A', 2);
  assert.equal(store.readArtifact(first.storagePath!), 'A1');
  assert.equal(store.readArtifact(second.storagePath!), 'B1');
  assert.equal(store.readArtifact(retry.storagePath!), 'A2');
  assert.throws(() => store.saveArtifact('shared.txt', 'overwrite', 'task-A', 1));
});

test('malformed sessions stay on disk and are visible as unreadable', (t) => {
  const root = fixture(t);
  const store = new SessionStore(root);
  const session = store.createSession({ workspaceRoot: root, request: 'test', planner: { provider: 'p', model: 'm' }, pi: { command: 'pi', mode: 'json', noSession: true } });
  const file = path.join(store.sessionDir(session.id), 'session.json');
  fs.writeFileSync(file, '{');
  assert.throws(() => store.loadSession(session.id), /preserved/);
  assert.match(store.listSessions()[0].name, /Unreadable/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{');
  fs.writeFileSync(file, JSON.stringify({ ...session, id: '../../evil' }));
  assert.throws(() => store.loadSession(session.id));
  const parsed = validatePlan(plan('task-A'));
  assert.ok(parsed.ok);
  session.plan = { project: parsed.value.project, tasks: planToTasks(parsed.value, root) };
  store.saveSession(session);
  assert.equal(store.loadSession(session.id)?.plan?.tasks[0].status, 'pending');
  fs.writeFileSync(file, JSON.stringify({ ...session, workspaceRoot: path.dirname(root) }));
  assert.equal(store.loadSession(session.id)?.workspaceRoot, root);
});

test('failed atomic replacement preserves original destination and cleans temporary file', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'session.json');
  atomicWrite(file, 'first'); atomicWrite(file, 'second');
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  const dir = path.join(root, 'destination'); fs.mkdirSync(dir);
  assert.throws(() => atomicWrite(dir, 'invalid'));
  assert.ok(fs.statSync(dir).isDirectory());
  assert.equal(fs.readdirSync(root).filter((name) => name.endsWith('.tmp')).length, 0);
});

test('one context budget covers explicit files, artifacts, prompts and constraints', (t) => {
  const root = fixture(t);
  const context = buildTaskContext({ workspaceRoot: root, filesToRead: [], prompt: 'p'.repeat(10000),
    explicitFiles: Array.from({ length: 20 }, (_, n) => ({ path: `${n}.txt`, content: 'x'.repeat(30000) })),
    artifacts: [{ path: 'large', kind: 'report', content: 'x'.repeat(240001) }], constraints: ['constraint'] });
  assert.ok(context.initialChars! <= MAX_TOTAL_CONTEXT_CHARS);
  assert.ok(context.files.length <= 15);
  assert.ok(context.omitted!.length > 0);
  assert.ok(context.files.every((file) => file.content.length <= 20000));
  assert.throws(() => buildTaskContext({ workspaceRoot: root, filesToRead: [], prompt: 'p'.repeat(120001) }), /budget/);
});

test('fingerprints distinguish modifications, no-ops and deletions', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'a.txt');
  assert.equal(fileFingerprint(root, 'a.txt'), undefined);
  fs.writeFileSync(file, 'old');
  const before = fileFingerprint(root, 'a.txt');
  assert.equal(fileFingerprint(root, 'a.txt'), before);
  fs.writeFileSync(file, 'new');
  assert.notEqual(fileFingerprint(root, 'a.txt'), before);
  fs.unlinkSync(file);
  assert.equal(fileFingerprint(root, 'a.txt'), undefined);
});
