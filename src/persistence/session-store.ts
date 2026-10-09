/** Local project session persistence under <workspace>/.ai-project. */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PiRuntimeMetadata, PlannerMetadata, Session } from '../models/types';
import { hasDependencyCycle, validatePlan } from '../models/validate';
import { assertSafeId, atomicWrite, resolveInside } from './paths';

export interface SessionSummary {
  id: string;
  name: string;
  status: Session['status'];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  workspaceRoot: string;
  request: string;
  planner: PlannerMetadata;
  pi: PiRuntimeMetadata;
  name?: string;
}

function validateSession(value: any, id: string): asserts value is Session {
  const strings = (items: unknown): boolean => Array.isArray(items) && items.every((s) => typeof s === 'string');
  const refs = (items: unknown): boolean => Array.isArray(items) && items.every((r) =>
    r && typeof r.path === 'string' && typeof r.kind === 'string' &&
    (r.content === undefined || typeof r.content === 'string') &&
    (r.storagePath === undefined || typeof r.storagePath === 'string'));
  if (!value || value.id !== id || !['draft', 'planning', 'planned', 'running', 'completed', 'failed', 'cancelled'].includes(value.status) ||
      !['name', 'createdAt', 'updatedAt', 'workspaceRoot', 'request'].every((key) => typeof value[key] === 'string') ||
      !value.planner || typeof value.planner.model !== 'string' || !value.pi || typeof value.pi.command !== 'string') {
    throw new Error('Invalid session structure');
  }
  if (!value.plan) { return; }
  const plan = validatePlan(value.plan);
  if (!plan.ok || hasDependencyCycle(plan.value)) { throw new Error('Invalid persisted plan'); }
  for (const task of value.plan.tasks) {
    const c = task.context;
    const r = task.result;
    if (!['pending', 'running', 'completed', 'failed', 'blocked', 'skipped'].includes(task.status) ||
        !Number.isSafeInteger(task.retryCount) || task.retryCount < 0 ||
        !strings(task.dependencies) || !strings(task.filesToRead) || !strings(task.filesToModify) ||
        !strings(task.executorInstructions) || !strings(task.acceptanceCriteria) ||
        !refs(task.inputArtifacts) || !refs(task.outputArtifacts) || !c ||
        !Array.isArray(c.files) || !c.files.every((f: any) => f && typeof f.path === 'string' && typeof f.content === 'string') ||
        !refs(c.artifacts) || !strings(c.constraints) || !c.environment || typeof c.environment !== 'object' ||
        (r && (!['completed', 'failed', 'cancelled', 'timeout', 'error'].includes(r.status) ||
          typeof r.summary !== 'string' || !Number.isSafeInteger(r.attempt) || r.attempt < 1 ||
          !refs(r.artifacts) || !strings(r.filesChanged) || !strings(r.errors) || !strings(r.warnings) ||
          !strings(r.commandsExecuted) || !Array.isArray(r.tests) || !r.pi))) {
      throw new Error(`Invalid persisted task: ${task.id}`);
    }
  }
}

export class SessionStore {
  constructor(private readonly workspaceRoot: string) {}

  get baseDir(): string {
    return resolveInside(this.workspaceRoot, '.ai-project');
  }

  get sessionsDir(): string {
    return resolveInside(this.baseDir, 'sessions');
  }

  sessionDir(sessionId: string): string {
    assertSafeId(sessionId);
    return resolveInside(this.sessionsDir, sessionId);
  }

  private sessionFile(sessionId: string): string {
    return resolveInside(this.sessionDir(sessionId), 'session.json');
  }

  listSessions(): SessionSummary[] {
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }
    const summaries: SessionSummary[] = [];
    for (const entry of fs.readdirSync(this.sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const session = this.loadSession(entry.name);
        if (session) {
          summaries.push({ id: session.id, name: session.name, status: session.status,
            createdAt: session.createdAt, updatedAt: session.updatedAt });
        }
      } catch {
        summaries.push({ id: entry.name, name: `[Unreadable session] ${entry.name}`,
          status: 'failed', createdAt: '', updatedAt: '' });
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  createSession(input: CreateSessionInput): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      name: input.name ?? `Session ${now}`,
      createdAt: now,
      updatedAt: now,
      workspaceRoot: input.workspaceRoot,
      request: input.request,
      status: 'draft',
      planner: input.planner,
      pi: input.pi,
    };
    fs.mkdirSync(this.sessionDir(session.id), { recursive: true });
    this.saveSession(session);
    return session;
  }

  saveSession(session: Session): void {
    session.updatedAt = new Date().toISOString();
    fs.mkdirSync(this.sessionDir(session.id), { recursive: true });
    atomicWrite(this.sessionFile(session.id), JSON.stringify(session, null, 2));
  }

  deleteSession(sessionId: string): boolean {
    const dir = this.sessionDir(sessionId);
    if (!fs.existsSync(dir)) {
      return false;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  loadSession(sessionId: string): Session | undefined {
    const file = this.sessionFile(sessionId);
    if (!fs.existsSync(file)) {
      return undefined;
    }
    try {
      const session = JSON.parse(fs.readFileSync(file, 'utf8'));
      validateSession(session, sessionId);
      // The opened workspace, not persisted JSON, defines the trust root.
      session.workspaceRoot = this.workspaceRoot;
      return session;
    } catch (error) {
      throw new Error(`Cannot load session ${sessionId}; file preserved: ${String(error)}`);
    }
  }
}
