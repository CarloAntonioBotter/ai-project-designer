import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRunnerResult, parseProgressLine, parseTokenCount, usageTokens } from '../src/pi/pi-protocol';

test('usageTokens reads the context Pi actually held', () => {
  assert.equal(usageTokens({ input: 1310, output: 40, totalTokens: 1350 }), 1310);
  assert.equal(usageTokens({ totalTokens: 900 }), 900);
  assert.equal(usageTokens({}), undefined);
  assert.equal(usageTokens(undefined), undefined);
});

test('parseProgressLine parses progress events', () => {
  const event = parseProgressLine('{"kind":"progress","type":"tool_start","tool":"bash"}');
  assert.equal(event?.kind, 'progress');
});

test('parseProgressLine treats plain output as a diagnostic', () => {
  const event = parseProgressLine('pi: starting');
  assert.deepEqual(event, { kind: 'diagnostic', message: 'pi: starting' });
});

test('parseProgressLine ignores blank lines', () => {
  assert.equal(parseProgressLine('   '), undefined);
});

test('normalizeRunnerResult maps the snake_case envelope', () => {
  const result = normalizeRunnerResult({
    task_id: 'task-003',
    status: 'completed',
    summary: 'done',
    attempt: 2,
    pi: { agent: 'pi', sessionMode: 'no-session', command: 'pi', mode: 'json', exitCode: 0, sessionId: 's1', version: '0.87.1' },
    files_changed: ['a.md'],
    commands_executed: ['python -m unittest'],
    errors: [],
    warnings: ['w'],
    artifacts: [{ path: 'a.md', kind: 'file' }],
  });
  assert.equal(result.taskId, 'task-003');
  assert.equal(result.status, 'completed');
  assert.equal(result.attempt, 2);
  assert.equal(result.pi.sessionMode, 'no-session');
  assert.deepEqual(result.filesChanged, ['a.md']);
  assert.equal(result.artifacts[0].path, 'a.md');
});

test('parseTokenCount reads Pi model-table sizes', () => {
  assert.equal(parseTokenCount('262.1K'), 262100);
  assert.equal(parseTokenCount('1M'), 1000000);
  assert.equal(parseTokenCount('200000'), 200000);
  assert.equal(parseTokenCount(''), undefined);
  assert.equal(parseTokenCount(undefined), undefined);
  assert.equal(parseTokenCount('n/a'), undefined);
});

test('normalizeRunnerResult maps unknown statuses to error', () => {
  const result = normalizeRunnerResult({ task_id: 't', status: 'weird' });
  assert.equal(result.status, 'error');
});
