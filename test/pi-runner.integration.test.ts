import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PiRunner } from '../src/pi/pi-runner';
import { PiExecutionRequest } from '../src/pi/pi-protocol';
import { executeTask } from '../src/orchestration/executor';
import { ArtifactStore } from '../src/persistence/artifact-store';
import { SessionStore } from '../src/persistence/session-store';
import { planToTasks, validatePlan } from '../src/models/validate';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER_SCRIPT = path.join(REPO_ROOT, 'python', 'executor_runner.py');
const FAKE_PI_SCRIPT = path.join(REPO_ROOT, 'python', 'tests', 'fake_pi.py');
const PYTHON = process.env.PYTHON_PATH ?? 'python';

interface FakeInvocation {
  run_id: string;
  pid: number;
  argv: string[];
}

function makeFakePi(dir: string): string {
  if (process.platform === 'win32') {
    const launcher = path.join(dir, 'fake-pi.cmd');
    fs.writeFileSync(launcher, `@echo off\r\n"${PYTHON}" "${FAKE_PI_SCRIPT}" %*\r\n`, 'utf8');
    return launcher;
  }
  const launcher = path.join(dir, 'fake-pi');
  fs.writeFileSync(launcher, `#!/bin/sh\nexec "${PYTHON}" "${FAKE_PI_SCRIPT}" "$@"\n`, 'utf8');
  fs.chmodSync(launcher, 0o755);
  return launcher;
}

function readLog(logPath: string): FakeInvocation[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FakeInvocation);
}

function makeRequest(workspace: string, piCommand: string, taskId: string, prompt: string): PiExecutionRequest {
  return {
    task_id: taskId,
    attempt: 1,
    pi: {
      command: piCommand,
      mode: 'json',
      noSession: true,
      tools: ['read', 'edit', 'write', 'bash'],
      trustProjectFiles: false,
      timeoutMs: 30000,
    },
    prompt,
    instructions: ['Do the task'],
    context: { workspaceRoot: workspace, files: [], artifacts: [], constraints: [], environment: {} },
  };
}

test('TS -> Python -> Pi runs each task as a new isolated Pi invocation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-int-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const fakePi = makeFakePi(root);
  const logPath = path.join(root, 'pi-log.jsonl');
  process.env.FAKE_PI_LOG = logPath;

  const runner = new PiRunner();
  const options = { pythonPath: PYTHON, runnerScript: RUNNER_SCRIPT, cwd: workspace };

  const first = await runner.run(makeRequest(workspace, fakePi, 'task-A', 'Task A does one thing'), options);
  const second = await runner.run(makeRequest(workspace, fakePi, 'task-B', 'Task B does another thing'), options);

  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'completed');
  assert.equal(first.pi.agent, 'pi');
  assert.equal(first.pi.sessionMode, 'no-session');
  assert.notEqual(first.pi.sessionId, second.pi.sessionId, 'each task must have its own Pi session');

  const log = readLog(logPath);
  assert.equal(log.length, 2, 'two tasks -> two Pi processes');
  assert.notEqual(log[0].run_id, log[1].run_id);
  for (const invocation of log) {
    assert.ok(invocation.argv.includes('--no-session'));
    for (const forbidden of ['--continue', '-c', '--resume', '-r', '--fork', '--session']) {
      assert.ok(!invocation.argv.includes(forbidden), `forbidden flag present: ${forbidden}`);
    }
  }

  delete process.env.FAKE_PI_LOG;
  fs.rmSync(root, { recursive: true, force: true });
});

test('Pi runtime check reports availability and required modes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-int-'));
  const fakePi = makeFakePi(root);
  const runner = new PiRunner();
  const report = await runner.checkRuntime(PYTHON, RUNNER_SCRIPT, fakePi);
  assert.equal(report.available, true);
  assert.equal(report.compatible, true);
  assert.equal(report.jsonMode, true);
  assert.equal(report.noSession, true);
  assert.equal(report.toolAllowlist, true);
  const models = await runner.listModels(PYTHON, RUNNER_SCRIPT, fakePi, 'configured-agent', root);
  assert.equal(models[0].model, 'configured-agent');
  fs.rmSync(root, { recursive: true, force: true });
});

test('host cancellation returns cancelled, never a successful envelope', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-cancel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = makeRequest(root, makeFakePi(root), 'task-A', 'test');
  request.context.environment = { FAKE_PI_SLEEP: '60' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const result = await new PiRunner().run(request, { pythonPath: PYTHON, runnerScript: RUNNER_SCRIPT,
      cwd: root, signal: controller.signal });
    assert.equal(result.status, 'cancelled');
  } finally { clearTimeout(timer); }
});

test('executor verifies commands and persists immutable snapshots across retries', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-executor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new SessionStore(root);
  const session = store.createSession({ workspaceRoot: root, request: 'test',
    planner: { provider: 'fake', model: 'fake' }, pi: { command: makeFakePi(root), mode: 'json', noSession: true } });
  const plan = validatePlan({ project: { title: 'test' }, tasks: [{ id: 'task-A', title: 'test',
    objective: 'test', executorPrompt: 'test', filesToModify: ['a.txt'], commands: ['python -m unittest'] }] });
  assert.ok(plan.ok);
  const task = planToTasks(plan.value, root)[0];
  task.context.environment = { FAKE_PI_WRITE_FILE: 'a.txt' };
  const artifactStore = new ArtifactStore(store.sessionDir(session.id));
  const input = { session, task, context: task.context, artifactStore, runnerScript: RUNNER_SCRIPT,
    config: { pythonPath: PYTHON, pi: { ...session.pi, timeoutMs: 5000, tools: ['write', 'bash'], trustProjectFiles: false },
      planner: { provider: 'fake', model: 'fake', thinking: '', timeoutMs: 5000, systemPrompt: '' },
      maxRetries: 2, fontSize: 0, autoExecute: false, contextWindow: 0 } };
  const first = await executeTask(input);
  assert.equal(first.status, 'completed');
  assert.equal(first.verification, 'checked');
  assert.equal(first.attempt, 1);
  assert.ok(first.artifacts[0].storagePath);
  task.retryCount = 0;
  const second = await executeTask(input);
  assert.equal(second.attempt, 2);
  assert.notEqual(first.artifacts[0].storagePath, second.artifacts[0].storagePath);
  assert.equal(artifactStore.readArtifact(first.artifacts[0].storagePath!)?.trim(), 'written by fake pi');
  task.commands = ['a command Pi did not run'];
  const third = await executeTask(input);
  assert.equal(third.status, 'failed');
  assert.match(third.errors.join(), /Required commands did not pass/);
});
