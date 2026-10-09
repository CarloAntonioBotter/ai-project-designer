/**
 * Task executor.
 *
 * Every task goes: TS -> Python process -> new isolated Pi run. There is no
 * direct LLM path here. This module builds the machine-readable request,
 * persists the attempt, and normalizes the result.
 *
 * A completed Pi exit code is necessary but not sufficient: the declared outputs
 * are verified on disk before a task is allowed to stay `completed`.
 */

import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { ArtifactReference, Session, Task, TaskContext, TaskResult } from '../models/types';
import { ArtifactStore, resolveInside } from '../persistence/artifact-store';
import { readBounded } from '../persistence/paths';
import { ExtensionConfig } from '../pi/pi-config';
import { NormalizedPiResult, PiExecutionRequest, ProgressEvent } from '../pi/pi-protocol';
import { PiRunner } from '../pi/pi-runner';

const MAX_ARTIFACT_CHARS = 200000;

// A streaming model emits one event per token; persisting each event with a
// synchronous append (a file open/close on the extension host thread) starves
// the host and freezes the UI. Buffer instead and flush on a short timer, with
// a size cap: at most this much of the log is lost if the run is hard-killed.
const EVENT_FLUSH_MS = 500;
const EVENT_FLUSH_MAX = 500;

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
  const attempt = artifactStore.nextAttempt(task.id);
  const workspaceRoot = context.workspaceRoot || session.workspaceRoot;
  const before = new Map(task.filesToModify.map((file) => [file, fileFingerprint(workspaceRoot, file)]));
  const runner = new PiRunner();

  const request: PiExecutionRequest = {
    task_id: task.id,
    attempt,
    // The task may override the executor thinking level for its own run.
    pi: { ...config.pi, thinking: task.thinking || config.pi.thinking },
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

  const pendingEvents: string[] = [];
  let eventError: unknown;
  const flushEvents = (): void => {
    if (pendingEvents.length === 0) {
      return;
    }
    try {
      artifactStore.appendEvents(task.id, pendingEvents);
      pendingEvents.length = 0;
    } catch (error) {
      eventError = error;
      pendingEvents.length = 0;
    }
  };
  const flushTimer = setInterval(flushEvents, EVENT_FLUSH_MS);

  let normalized: NormalizedPiResult;
  try {
    normalized = await runner.run(request, {
      pythonPath: config.pythonPath,
      runnerScript: input.runnerScript,
      cwd: request.context.workspaceRoot,
      signal: input.signal,
      onProgress: (event: ProgressEvent) => {
        pendingEvents.push(JSON.stringify(event));
        if (pendingEvents.length >= EVENT_FLUSH_MAX) {
          flushEvents();
        }
        input.onProgress?.(event);
      },
    });
  } finally {
    clearInterval(flushTimer);
    flushEvents();
  }

  if (eventError) { throw eventError; }
  artifactStore.writeResponse(task.id, normalized);

  // Pi may report absolute paths; every consumer below (artifact store,
  // dependency context) only accepts workspace-relative paths.
  const observed = task.filesToModify.filter((file) => before.get(file) !== fileFingerprint(workspaceRoot, file));
  const filesChanged = [...new Set([...normalized.filesChanged, ...observed])]
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

  // Pi exits 0 even when the model gives up, so "exit 0 + assistant text" is not
  // evidence the task happened: a completed run must have produced the files it
  // declared. Existence is checked on disk, so files written via bash count too.
  if (result.status === 'completed') {
    // A declared file that existed before and is now absent is an observed deletion.
    const missing = missingDeclaredOutputs(workspaceRoot, task.filesToModify ?? [])
      .filter((file) => before.get(file) === undefined);
    if (missing.length > 0) {
      result.status = 'failed';
      result.errors.push(`pi reported completion but the declared output is missing: ${missing.join(', ')}`);
    }
  }

  const commands = task.commands ?? [];
  const uncheckedCommands = commands.filter((command) =>
    result.tests.filter((report) => report.command === command).at(-1)?.status !== 'passed');
  if (result.status === 'completed' && uncheckedCommands.length) {
    result.status = 'failed';
    result.errors.push(`Required commands did not pass: ${uncheckedCommands.join(', ')}`);
  }
  result.verification = result.status === 'completed' &&
    ((task.filesToModify.length > 0 && observed.length === task.filesToModify.length) || commands.length > 0)
    ? 'checked' : 'unverified';
  if (result.status === 'completed' && result.verification === 'unverified') {
    result.warnings.push('Process completed; no complete output-change or required-command evidence. Review acceptance criteria.');
  }
  if (result.status === 'completed') {
    result.artifacts = persistChangedFiles(workspaceRoot, filesChanged, artifactStore, task.id, attempt, result.warnings);
  }

  artifactStore.writeResult(task.id, result);
  return result;
}

/** Declared output files a completed run left missing. Empty = all present. */
export function missingDeclaredOutputs(workspaceRoot: string, filesToModify: string[]): string[] {
  return filesToModify.filter((relativePath) => {
    try {
      const absolute = resolveInside(workspaceRoot, relativePath);
      // A `.gitkeep` is a placeholder for its folder: a task that promised the
      // folder keeps its promise by creating the folder, file or not.
      if (path.basename(absolute) === '.gitkeep' && fs.statSync(path.dirname(absolute)).isDirectory()) {
        return false;
      }
      return !fs.existsSync(absolute);
    } catch {
      return true;
    }
  });
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
function persistChangedFiles(workspaceRoot: string, filesChanged: string[], store: ArtifactStore,
  taskId: string, attempt: number, warnings: string[]): ArtifactReference[] {
  const artifacts: ArtifactReference[] = [];
  for (const relativePath of filesChanged) {
    try {
      const absolute = resolveInside(workspaceRoot, relativePath);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        continue;
      }
      const { content, truncated } = readBounded(absolute, MAX_ARTIFACT_CHARS);
      if (!truncated) {
        artifacts.push(store.saveArtifact(relativePath, content, taskId, attempt));
      } else { warnings.push(`Artifact too large to snapshot: ${relativePath}`); }
    } catch (error) {
      warnings.push(`Artifact capture failed for ${relativePath}: ${String(error)}`);
    }
  }
  return artifacts;
}

export function fileFingerprint(root: string, file: string): string | undefined {
  const target = resolveInside(root, file);
  if (!fs.existsSync(target)) { return undefined; }
  if (fs.statSync(target).isDirectory()) { return 'directory'; }
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(65536);
  const fd = fs.openSync(target, 'r');
  try {
    let length: number;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) { hash.update(buffer.subarray(0, length)); }
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
