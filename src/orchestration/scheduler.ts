/**
 * Pure dependency-graph logic for the task checklist.
 *
 * The initial implementation runs sequentially; these helpers already support
 * independent tasks so parallel execution can be layered on later.
 */

import { Task } from '../models/types';

export function tasksInOrder(tasks: Task[]): Task[] {
  return tasks.slice().sort((a, b) => a.order - b.order);
}

export interface DependencyState {
  ready: boolean;
  blockedBy: string[];
}

export function dependencyState(task: Task, tasks: Task[]): DependencyState {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  const blockedBy: string[] = [];
  for (const dependencyId of task.dependencies) {
    const dependency = byId.get(dependencyId);
    if (!dependency || dependency.status !== 'completed') {
      blockedBy.push(dependencyId);
    }
  }
  return { ready: blockedBy.length === 0, blockedBy };
}

/** Mark pending tasks whose dependencies are not (yet) completed as blocked. */
export function refreshBlockedTasks(tasks: Task[]): void {
  for (const task of tasks) {
    if (task.status !== 'pending' && task.status !== 'blocked') {
      continue;
    }
    task.status = dependencyState(task, tasks).ready ? 'pending' : 'blocked';
  }
}

export function nextRunnableTask(tasks: Task[]): Task | undefined {
  return tasksInOrder(tasks).find((task) => {
    if (task.status !== 'pending') {
      return false;
    }
    return dependencyState(task, tasks).ready;
  });
}

export function isPlanComplete(tasks: Task[]): boolean {
  return tasks.every((task) => task.status === 'completed' || task.status === 'skipped');
}
