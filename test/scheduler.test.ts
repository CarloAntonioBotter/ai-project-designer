import test from 'node:test';
import assert from 'node:assert/strict';
import { Task } from '../src/models/types';
import {
  dependencyState,
  isPlanComplete,
  nextRunnableTask,
  refreshBlockedTasks,
  tasksInOrder,
} from '../src/orchestration/scheduler';

function makeTask(id: string, order: number, dependencies: string[] = [], status: Task['status'] = 'pending'): Task {
  const now = new Date().toISOString();
  return {
    id,
    title: id,
    description: '',
    order,
    dependencies,
    status,
    objective: '',
    executorPrompt: '',
    executorInstructions: [],
    context: { workspaceRoot: '/ws', files: [], artifacts: [], constraints: [], environment: {} },
    expectedOutput: '',
    acceptanceCriteria: [],
    inputArtifacts: [],
    outputArtifacts: [],
    filesToRead: [],
    filesToModify: [],
    executorRuntime: 'pi',
    retryCount: 0,
  };
}

test('dependencyState reports blocked dependencies', () => {
  const a = makeTask('task-001', 1);
  const b = makeTask('task-002', 2, ['task-001']);
  assert.deepEqual(dependencyState(b, [a, b]), { ready: false, blockedBy: ['task-001'] });
  a.status = 'completed';
  assert.deepEqual(dependencyState(b, [a, b]), { ready: true, blockedBy: [] });
});

test('nextRunnableTask skips blocked tasks', () => {
  const a = makeTask('task-001', 1);
  const b = makeTask('task-002', 2, ['task-001']);
  assert.equal(nextRunnableTask([b, a])?.id, 'task-001');
});

test('refreshBlockedTasks marks unsatisfied dependents', () => {
  const a = makeTask('task-001', 1);
  const b = makeTask('task-002', 2, ['task-001']);
  refreshBlockedTasks([a, b]);
  assert.equal(a.status, 'pending');
  assert.equal(b.status, 'blocked');
});

test('refreshBlockedTasks unblocks dependents once dependencies complete', () => {
  const a = makeTask('task-001', 1, [], 'completed');
  const b = makeTask('task-002', 2, ['task-001']);
  refreshBlockedTasks([a, b]);
  assert.equal(b.status, 'pending');
});

test('isPlanComplete only when everything is completed or skipped', () => {
  const a = makeTask('task-001', 1, [], 'completed');
  const b = makeTask('task-002', 2, [], 'pending');
  assert.equal(isPlanComplete([a, b]), false);
  b.status = 'skipped';
  assert.equal(isPlanComplete([a, b]), true);
});

test('tasksInOrder sorts by order', () => {
  const a = makeTask('task-002', 2);
  const b = makeTask('task-001', 1);
  assert.deepEqual(tasksInOrder([a, b]).map((task) => task.id), ['task-001', 'task-002']);
});
