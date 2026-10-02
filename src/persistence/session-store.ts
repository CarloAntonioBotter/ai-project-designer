/** Local project session persistence under <workspace>/.ai-project. */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PiRuntimeMetadata, PlannerMetadata, Session } from '../models/types';

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

export class SessionStore {
  constructor(private readonly workspaceRoot: string) {}

  get baseDir(): string {
    return path.join(this.workspaceRoot, '.ai-project');
  }

  get sessionsDir(): string {
    return path.join(this.baseDir, 'sessions');
  }

  sessionDir(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId);
  }

  private sessionFile(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'session.json');
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
      const session = this.loadSession(entry.name);
      if (session) {
        summaries.push({
          id: session.id,
          name: session.name,
          status: session.status,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
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
    fs.writeFileSync(this.sessionFile(session.id), JSON.stringify(session, null, 2), 'utf8');
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
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Session;
    } catch {
      return undefined;
    }
  }
}
