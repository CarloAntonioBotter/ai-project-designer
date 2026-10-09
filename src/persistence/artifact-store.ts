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

import { assertSafeId, atomicWrite, readBounded, resolveInside } from './paths';
export { resolveInside } from './paths';

export class ArtifactStore {
  constructor(private readonly sessionDir: string) {}

  get artifactsDir(): string {
    return resolveInside(this.sessionDir, 'artifacts');
  }

  taskDir(taskId: string): string {
    assertSafeId(taskId);
    return resolveInside(this.sessionDir, path.join('tasks', taskId));
  }

  private archiveCurrentAttempt(taskId: string): void {
    const dir = this.taskDir(taskId);
    const requestFile = resolveInside(dir, 'request.json');
    if (!fs.existsSync(requestFile)) {
      return;
    }
    let attempt = 1;
    try {
      attempt = Number(JSON.parse(fs.readFileSync(requestFile, 'utf8')).attempt ?? 1);
    } catch {
      attempt = 1;
    }
    if (!Number.isSafeInteger(attempt) || attempt < 1) { throw new Error('Invalid attempt number'); }
    const archiveDir = resolveInside(dir, `attempts/attempt-${attempt}`);
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.mkdirSync(archiveDir); // Never overwrite an existing attempt.
    for (const name of ['request.json', 'pi-events.jsonl', 'response.json', 'result.json']) {
      const from = resolveInside(dir, name);
      if (fs.existsSync(from)) {
        fs.renameSync(from, path.join(archiveDir, name));
      }
    }
  }

  nextAttempt(taskId: string): number {
    const dir = this.taskDir(taskId);
    const archived = resolveInside(dir, 'attempts');
    const numbers = fs.existsSync(archived)
      ? fs.readdirSync(archived).map((name) => Number(/^attempt-(\d+)$/.exec(name)?.[1] ?? 0)) : [];
    const current = resolveInside(dir, 'request.json');
    if (fs.existsSync(current)) {
      const attempt = JSON.parse(fs.readFileSync(current, 'utf8')).attempt;
      if (!Number.isSafeInteger(attempt) || attempt < 1) { throw new Error('Invalid persisted attempt'); }
      numbers.push(attempt);
    }
    return Math.max(0, ...numbers) + 1;
  }

  writeTaskRequest(taskId: string, request: unknown): void {
    this.archiveCurrentAttempt(taskId);
    const dir = this.taskDir(taskId);
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(resolveInside(dir, 'request.json'), JSON.stringify(request, null, 2));
    atomicWrite(resolveInside(dir, 'pi-events.jsonl'), '');
  }

  appendEvents(taskId: string, lines: string[]): void {
    if (lines.length === 0) {
      return;
    }
    const dir = this.taskDir(taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(resolveInside(dir, 'pi-events.jsonl'), lines.join('\n') + '\n', 'utf8');
  }

  writeResponse(taskId: string, envelope: unknown): void {
    const dir = this.taskDir(taskId);
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(resolveInside(dir, 'response.json'), JSON.stringify(envelope, null, 2));
  }

  writeResult(taskId: string, result: TaskResult): void {
    const dir = this.taskDir(taskId);
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(resolveInside(dir, 'result.json'), JSON.stringify(result, null, 2));
  }

  saveArtifact(relativePath: string, content: string, taskId: string, attempt: number): ArtifactReference {
    assertSafeId(taskId);
    if (!Number.isSafeInteger(attempt) || attempt < 1) { throw new Error('Invalid attempt number'); }
    const base = resolveInside(this.artifactsDir, `${taskId}/attempt-${attempt}`);
    const target = resolveInside(base, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { path: relativePath, kind: 'file', storagePath: path.relative(this.artifactsDir, target).split(path.sep).join('/') };
  }

  readArtifact(relativePath: string, maxChars = 20000): string | undefined {
    const target = resolveInside(this.artifactsDir, relativePath);
    if (!fs.existsSync(target)) {
      return undefined;
    }
    return readBounded(target, maxChars).content;
  }
}
