import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PiRunner } from '../src/pi/pi-runner';
import { PiExecutionRequest } from '../src/pi/pi-protocol';

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
  assert.equal(report.jsonMode, true);
  assert.equal(report.noSession, true);
  assert.equal(report.toolAllowlist, true);
  fs.rmSync(root, { recursive: true, force: true });
});
