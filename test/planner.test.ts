import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan } from '../src/orchestration/planner';
import { LLMProvider, LLMRequest, LLMResponse } from '../src/llm/provider';

const VALID_PLAN = JSON.stringify({
  project: { title: 'T', summary: 'S', assumptions: [] },
  tasks: [
    {
      id: 'task-001',
      title: 'One',
      description: 'd',
      order: 1,
      dependencies: [],
      objective: 'o',
      executorPrompt: 'p',
      executorInstructions: [],
      filesToRead: [],
      filesToModify: [],
      expectedOutput: 'e',
      acceptanceCriteria: ['a'],
      commands: [],
    },
  ],
});

function providerFrom(replies: string[]): LLMProvider {
  let index = 0;
  return {
    id: 'fake',
    model: 'fake-model',
    async generate(_request: LLMRequest): Promise<LLMResponse> {
      return { text: replies[Math.min(index++, replies.length - 1)] };
    },
  };
}

function baseInput(provider: LLMProvider) {
  return {
    request: 'do something',
    workspaceRoot: '/ws',
    workspaceSummary: 'files: none',
    constraints: [],
    provider,
  };
}

test('generatePlan parses a valid JSON plan', async () => {
  const plan = await generatePlan(baseInput(providerFrom([VALID_PLAN])));
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].status, 'pending');
});

test('generatePlan repairs an invalid response', async () => {
  const plan = await generatePlan(baseInput(providerFrom(['I will inspect the files first.', VALID_PLAN])));
  assert.equal(plan.tasks[0].id, 'task-001');
});

test('generatePlan reports live progress while the planner streams tasks', async () => {
  const messages: string[] = [];
  const provider: LLMProvider = {
    id: 'fake',
    model: 'fake-model',
    async generate(request: LLMRequest): Promise<LLMResponse> {
      request.onProgress?.({ kind: 'progress', type: 'text', delta: '{"project":{"title":"T"},"tasks":[{"order": 1,' });
      request.onProgress?.({ kind: 'progress', type: 'text', delta: '{"order": 2,' });
      return { text: VALID_PLAN };
    },
  };
  await generatePlan({ ...baseInput(provider), onProgress: (message) => messages.push(message) });
  assert.ok(messages.includes('Generating task 1…'), messages.join(' | '));
  assert.ok(messages.includes('Generating task 2…'), messages.join(' | '));
  assert.ok(messages.includes('Validating plan…'), messages.join(' | '));
});

test('generatePlan falls back to the English-only default system prompt', async () => {
  let system = '';
  const provider: LLMProvider = {
    id: 'fake',
    model: 'fake-model',
    async generate(request: LLMRequest): Promise<LLMResponse> {
      system = request.system ?? '';
      return { text: VALID_PLAN };
    },
  };
  await generatePlan({ ...baseInput(provider), systemPrompt: '   ' });
  assert.match(system, /Write every plan string in English/);
});

test('generatePlan reports the offending response when no JSON is ever produced', async () => {
  const reply = 'I will inspect the workspace files to understand the current structure.';
  await assert.rejects(
    generatePlan(baseInput(providerFrom([reply]))),
    (error: Error) => {
      assert.match(error.message, /response was not valid JSON/);
      assert.match(error.message, /response began with: "I will inspect the workspace files/);
      assert.match(error.message, /after 3 attempts/);
      return true;
    }
  );
});
