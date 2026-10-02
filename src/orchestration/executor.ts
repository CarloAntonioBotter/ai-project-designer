/**
 * Task executor.
 *
 * Every task goes: TS -> Python process -> new isolated Pi run. There is no
 * direct LLM path here. This module builds the machine-readable request,
 * persists the attempt, and normalizes the result.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Session, Task, TaskContext, TaskResult } from '../models/types';
import { ArtifactStore, resolveInside } from '../persistence/artifact-store';
import { ExtensionConfig } from '../pi/pi-config';
import { PiExecutionRequest, ProgressEvent } from '../pi/pi-protocol';
import { PiRunner } from '../pi/pi-runner';

const MAX_ARTIFACT_CHARS = 200000;

export interface ExecuteTaskInput {
  session: Session;
  task: Task;
  context: TaskContext;
  config: ExtensionConfig;
  runnerScript: string;
  artifactStore: ArtifactStore;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export async function executeTask(input: ExecuteTaskInput): Promise<TaskResult> {
  const { session, task, context, config, artifactStore } = input;
  const attempt = (task.retryCount ?? 0) + 1;

  const request: PiExecutionRequest = {
    task_id: task.id,
    attempt,
    pi: { ...config.pi },
    prompt: task.executorPrompt,
    instructions: task.executorInstructions,
    context: {
      workspaceRoot: context.workspaceRoot || session.workspaceRoot,
      files: context.files,
      artifacts: context.artifacts,
      constraints: context.constraints,
      environment: context.environment,
    },
  };

  artifactStore.writeTaskRequest(task.id, request);

  const progressLines: string[] = [];
  const runner = new PiRunner();
  const normalized = await runner.run(request, {
    pythonPath: config.pythonPath,
    runnerScript: input.runnerScript,
    cwd: request.context.workspaceRoot,
    signal: input.signal,
    onProgress: (event: ProgressEvent) => {
      progressLines.push(JSON.stringify(event));
      input.onProgress?.(event);
    },
  });

  artifactStore.appendEvents(task.id, progressLines);
  artifactStore.writeResponse(task.id, normalized);

  // Pi may report absolute paths; every consumer below (artifact store,
  // dependency context) only accepts workspace-relative paths.
  const workspaceRoot = context.workspaceRoot || session.workspaceRoot;
  const filesChanged = normalized.filesChanged
    .map((reported) => toWorkspaceRelative(workspaceRoot, reported))
    .filter((relative): relative is string => relative !== undefined);
  const artifacts = normalized.artifacts
    .map((artifact) => ({ ...artifact, path: toWorkspaceRelative(workspaceRoot, artifact.path) }))
    .filter((artifact): artifact is { path: string; kind: string } => artifact.path !== undefined);

  const result: TaskResult = {
    status: normalized.status,
    summary: normalized.summary,
    attempt: normalized.attempt,
    pi: normalized.pi,
    artifacts,
    filesChanged,
    tests: normalized.tests,
    commandsExecuted: normalized.commandsExecuted,
    errors: normalized.errors,
    warnings: normalized.warnings,
    startedAt: normalized.startedAt,
    finishedAt: normalized.finishedAt,
  };

  if (normalized.status === 'completed') {
    persistChangedFiles(workspaceRoot, filesChanged, artifactStore);
  }

  artifactStore.writeResult(task.id, result);
  return result;
}

/** Convert a Pi-reported path (absolute or relative) to a workspace-relative path, or undefined if outside the workspace. */
export function toWorkspaceRelative(workspaceRoot: string, reported: string): string | undefined {
  const base = path.resolve(workspaceRoot);
  const relative = path.relative(base, path.resolve(base, reported));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join('/');
}

/** Copy files produced by a successful task into the session artifact store. */
function persistChangedFiles(workspaceRoot: string, filesChanged: string[], store: ArtifactStore): void {
  for (const relativePath of filesChanged) {
    try {
      const absolute = resolveInside(workspaceRoot, relativePath);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        continue;
      }
      const content = fs.readFileSync(absolute, 'utf8');
      if (content.length <= MAX_ARTIFACT_CHARS) {
        store.saveArtifact(relativePath, content);
      }
    } catch {
      // Artifact capture is best-effort and must never fail a completed task.
    }
  }
}
