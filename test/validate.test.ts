import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDependencyCycle, planToTasks, validatePlan } from '../src/models/validate';

const validPlan = {
  project: { title: 'Demo', summary: 'A demo project', assumptions: ['none'] },
  tasks: [
    {
      id: 'task-001',
      title: 'Analyze',
      description: 'Analyze the codebase',
      order: 1,
      dependencies: [],
      objective: 'Produce an analysis',
      executorPrompt: 'Analyze the repository and write architecture.md',
      executorInstructions: ['Read the tree', 'Write architecture.md'],
      filesToRead: ['README.md'],
      filesToModify: ['architecture.md'],
      expectedOutput: 'architecture.md',
      acceptanceCriteria: ['architecture.md exists'],
    },
    {
      id: 'task-002',
      title: 'Implement',
      description: 'Implement the feature',
      order: 2,
      dependencies: ['task-001'],
      objective: 'Implement the feature',
      executorPrompt: 'Implement the feature based on architecture.md',
      executorInstructions: ['Read architecture.md'],
      filesToRead: ['architecture.md'],
      filesToModify: ['src/index.ts'],
      expectedOutput: 'working feature',
      acceptanceCriteria: ['tests pass'],
    },
  ],
};

test('validatePlan accepts a well formed plan', () => {
  const result = validatePlan(validPlan);
  assert.equal(result.ok, true);
});

test('validatePlan reports missing required fields', () => {
  const broken = JSON.parse(JSON.stringify(validPlan));
  delete broken.tasks[0].executorPrompt;
  const result = validatePlan(broken);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('executorPrompt')));
  }
});

test('validatePlan rejects duplicate ids and unknown dependencies', () => {
  const broken = JSON.parse(JSON.stringify(validPlan));
  broken.tasks[1].dependencies = ['task-999'];
  broken.tasks[1].id = 'task-001';
  const result = validatePlan(broken);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes('duplicate')));
    assert.ok(result.errors.some((error) => error.includes('task-999')));
  }
});

test('hasDependencyCycle detects cycles', () => {
  const cyclic = JSON.parse(JSON.stringify(validPlan));
  cyclic.tasks[0].dependencies = ['task-002'];
  const result = validatePlan(cyclic);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(hasDependencyCycle(result.value), true);
  }
});

test('planToTasks assigns executable defaults', () => {
  const result = validatePlan(validPlan);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const tasks = planToTasks(result.value, '/workspace');
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].status, 'pending');
  assert.equal(tasks[0].executorRuntime, 'pi');
  assert.equal(tasks[0].retryCount, 0);
  assert.equal(tasks[0].context.workspaceRoot, '/workspace');
  assert.equal(tasks[1].order, 2);
});
