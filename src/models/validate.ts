/**
 * Runtime validation for planner output.
 *
 * Planner JSON is untrusted model output, so it is validated structurally
 * before a single task is created. A validation failure can be fed back to the
 * planner for a controlled repair retry.
 */

import { PlannedPlan, PlannedTask, Task, TaskContext } from './types';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string, errors: string[], required = true): string {
  const value = source[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (required) {
    errors.push(`${key} must be a non-empty string`);
  }
  return '';
}

function readStringArray(source: Record<string, unknown>, key: string, errors: string[]): string[] {
  const value = source[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    errors.push(`${key} must be an array of strings`);
    return [];
  }
  return value as string[];
}

function readOrder(source: Record<string, unknown>, fallback: number, errors: string[]): number {
  const value = source.order;
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push('order must be a number');
    return fallback;
  }
  return value;
}

export function validatePlan(raw: unknown): ValidationResult<PlannedPlan> {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ['plan must be a JSON object'] };
  }

  const projectRaw = raw.project;
  if (!isRecord(projectRaw)) {
    return { ok: false, errors: ['plan.project must be an object'] };
  }
  const project = {
    title: readString(projectRaw, 'title', errors),
    summary: readString(projectRaw, 'summary', errors, false),
    assumptions: readStringArray(projectRaw, 'assumptions', errors),
  };

  const tasksRaw = raw.tasks;
  if (!Array.isArray(tasksRaw) || tasksRaw.length === 0) {
    return { ok: false, errors: ['plan.tasks must be a non-empty array'] };
  }

  const tasks: PlannedTask[] = [];
  const seenIds = new Set<string>();
  tasksRaw.forEach((taskRaw, index) => {
    if (!isRecord(taskRaw)) {
      errors.push(`tasks[${index}] must be an object`);
      return;
    }
    const id = readString(taskRaw, 'id', errors);
    if (id && seenIds.has(id)) {
      errors.push(`duplicate task id: ${id}`);
    }
    if (id) {
      seenIds.add(id);
    }
    tasks.push({
      id,
      title: readString(taskRaw, 'title', errors),
      description: readString(taskRaw, 'description', errors, false),
      order: readOrder(taskRaw, index + 1, errors),
      dependencies: readStringArray(taskRaw, 'dependencies', errors),
      objective: readString(taskRaw, 'objective', errors),
      executorPrompt: readString(taskRaw, 'executorPrompt', errors),
      executorInstructions: readStringArray(taskRaw, 'executorInstructions', errors),
      filesToRead: readStringArray(taskRaw, 'filesToRead', errors),
      filesToModify: readStringArray(taskRaw, 'filesToModify', errors),
      expectedOutput: readString(taskRaw, 'expectedOutput', errors, false),
      acceptanceCriteria: readStringArray(taskRaw, 'acceptanceCriteria', errors),
      commands: readStringArray(taskRaw, 'commands', errors),
    });
  });

  // Dependency integrity: every dependency must reference an existing task.
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!seenIds.has(dependency)) {
        errors.push(`task ${task.id} depends on unknown task ${dependency}`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: { project, tasks } };
}

export function hasDependencyCycle(plan: PlannedPlan): boolean {
  const graph = new Map<string, string[]>();
  for (const task of plan.tasks) {
    graph.set(task.id, task.dependencies);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visited.has(id)) {
      return false;
    }
    if (visiting.has(id)) {
      return true;
    }
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) {
      if (visit(dependency)) {
        return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return plan.tasks.some((task) => visit(task.id));
}

export function createEmptyContext(workspaceRoot: string): TaskContext {
  return {
    workspaceRoot,
    files: [],
    artifacts: [],
    constraints: [],
    environment: {},
  };
}

/** Convert a validated planner plan into executable tasks with fresh context. */
export function planToTasks(plan: PlannedPlan, workspaceRoot: string): Task[] {
  return plan.tasks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((planned, index) => ({
      id: planned.id,
      title: planned.title,
      description: planned.description,
      order: index + 1,
      dependencies: [...planned.dependencies],
      status: 'pending' as const,
      objective: planned.objective,
      executorPrompt: planned.executorPrompt,
      executorInstructions: [...planned.executorInstructions],
      context: createEmptyContext(workspaceRoot),
      expectedOutput: planned.expectedOutput,
      acceptanceCriteria: [...planned.acceptanceCriteria],
      inputArtifacts: [],
      outputArtifacts: [],
      filesToRead: [...planned.filesToRead],
      filesToModify: [...planned.filesToModify],
      commands: planned.commands,
      executorRuntime: 'pi' as const,
      retryCount: 0,
    }));
}
