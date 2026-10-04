/**
 * Artifact store for a session.
 *
 * Layout:
 *   .ai-project/sessions/<id>/tasks/<task-id>/request.json
 *                                           /pi-events.jsonl
 *                                           /response.json
 *                                           /result.json
 *                                           /attempts/attempt-<n>/...
 *   .ai-project/sessions/<id>/artifacts/<...>
 *
 * This is project persistence, deliberately separate from Pi's own session
 * storage, which is never used for cross-task memory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArtifactReference, TaskResult } from '../models/types';

/** Resolve `relativePath` inside `base`, rejecting traversal escapes. */
export function resolveInside(base: string, relativePath: string): string {
  const baseResolved = path.resolve(base);
  const target = path.resolve(baseResolved, relativePath);
  const relative = path.relative(baseResolved, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path escapes allowed directory: ${relativePath}`);
  }
  return target;
}

export class ArtifactStore {
  constructor(private readonly sessionDir: string) {}

  get artifactsDir(): string {
    return path.join(this.sessionDir, 'artifacts');
  }

  taskDir(taskId: string): string {
    return path.join(this.sessionDir, 'tasks', taskId);
  }

  private archiveCurrentAttempt(taskId: string): void {
    const dir = this.taskDir(taskId);
    const requestFile = path.join(dir, 'request.json');
    if (!fs.existsSync(requestFile)) {
      return;
    }
    let attempt = 1;
    try {
      attempt = Number(JSON.parse(fs.readFileSync(requestFile, 'utf8')).attempt ?? 1);
    } catch {
      attempt = 1;
    }
    const archiveDir = path.join(dir, 'attempts', `attempt-${attempt}`);
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const name of ['request.json', 'pi-events.jsonl', 'response.json', 'result.json']) {
      const from = path.join(dir, name);
      if (fs.existsSync(from)) {
        fs.renameSync(from, path.join(archiveDir, name));
      }
    }
  }

  writeTaskRequest(taskId: string, request: unknown): void {
    this.archiveCurrentAttempt(taskId);
    const dir = this.taskDir(taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'pi-events.jsonl'), '', 'utf8');
  }

  appendEvents(taskId: string, lines: string[]): void {
    if (lines.length === 0) {
      return;
    }
    const dir = this.taskDir(taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'pi-events.jsonl'), lines.join('\n') + '\n', 'utf8');
  }

  writeResponse(taskId: string, envelope: unknown): void {
    const dir = this.taskDir(taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'response.json'), JSON.stringify(envelope, null, 2), 'utf8');
  }

  writeResult(taskId: string, result: TaskResult): void {
    const dir = this.taskDir(taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  }

  readResult(taskId: string): TaskResult | undefined {
    const file = path.join(this.taskDir(taskId), 'result.json');
    if (!fs.existsSync(file)) {
      return undefined;
    }
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as TaskResult;
    } catch {
      return undefined;
    }
  }

  saveArtifact(relativePath: string, content: string): ArtifactReference {
    const target = resolveInside(this.artifactsDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    return { path: relativePath, kind: 'file' };
  }

  readArtifact(relativePath: string, maxChars = 20000): string | undefined {
    const target = resolveInside(this.artifactsDir, relativePath);
    if (!fs.existsSync(target)) {
      return undefined;
    }
    const content = fs.readFileSync(target, 'utf8');
    return content.length > maxChars ? content.slice(0, maxChars) : content;
  }
}
