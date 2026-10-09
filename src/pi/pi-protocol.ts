/**
 * Stable TS <-> Python process protocol.
 *
 * TS writes one `PiExecutionRequest` JSON object to the Python runner's stdin.
 * Python writes normalized progress events to stderr (JSONL) and exactly one
 * `PiExecutionResult` envelope to stdout.
 */

import { ArtifactReference, PiRunInfo, PiStatus } from '../models/types';

export interface PiExecutionConfigPayload {
  command: string;
  mode: string;
  noSession: boolean;
  provider?: string;
  model?: string;
  thinking?: string;
  tools: string[];
  noTools?: boolean;
  trustProjectFiles: boolean;
  agentDir?: string;
  timeoutMs: number;
  extraArgs?: string[];
}

export interface PiContextFile {
  path: string;
  content: string;
}

export interface PiExecutionContext {
  workspaceRoot: string;
  files: PiContextFile[];
  artifacts: ArtifactReference[];
  constraints: string[];
  environment: Record<string, string>;
}

export interface PiExecutionRequest {
  task_id: string;
  attempt: number;
  pi: PiExecutionConfigPayload;
  prompt: string;
  instructions: string[];
  context: PiExecutionContext;
  /** Send `prompt` verbatim instead of wrapping it in the executor contract. */
  rawPrompt?: boolean;
}

export interface RawRunnerResult {
  task_id: string;
  status: string;
  summary?: string;
  attempt?: number;
  pi?: {
    agent?: string;
    sessionMode?: string;
    command?: string;
    mode?: string;
    version?: string | null;
    exitCode?: number | null;
    sessionId?: string | null;
  };
  artifacts?: Array<{ path: string; kind?: string; origin?: string }>;
  files_changed?: string[];
  tests?: Array<Record<string, unknown>>;
  commands_executed?: string[];
  errors?: string[];
  warnings?: string[];
  events?: Array<Record<string, unknown>>;
  started_at?: string;
  finished_at?: string;
}

export interface NormalizedPiResult {
  taskId: string;
  status: PiStatus;
  summary: string;
  attempt: number;
  pi: PiRunInfo;
  artifacts: ArtifactReference[];
  filesChanged: string[];
  tests: Array<Record<string, unknown>>;
  commandsExecuted: string[];
  errors: string[];
  warnings: string[];
  startedAt?: string;
  finishedAt?: string;
}

export type ProgressEvent =
  | { kind: 'progress'; type: string; [key: string]: unknown }
  | { kind: 'diagnostic'; message: string };

export interface PiModelInfo {
  provider: string;
  model: string;
  context?: string;
  maxOutput?: string;
  thinking?: boolean;
  images?: boolean;
}

/** Parse a Pi model-table size ("262.1K", "1M", "200000") into a token count. */
export function parseTokenCount(value?: string): number | undefined {
  const match = /^([\d.]+)\s*([KM])?$/i.exec((value ?? '').trim());
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  const suffix = match[2]?.toUpperCase();
  return Math.round(amount * (suffix === 'M' ? 1_000_000 : suffix === 'K' ? 1_000 : 1));
}

const VALID_STATUSES: PiStatus[] = ['completed', 'failed', 'cancelled', 'timeout', 'error'];

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    : [];
}

export function parseProgressLine(line: string): ProgressEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== '{') {
    return trimmed ? { kind: 'diagnostic', message: trimmed } : undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.kind === 'progress') {
      return { kind: 'progress', type: String(parsed.type ?? 'unknown'), ...parsed };
    }
    if (parsed.kind === 'diagnostic') {
      return { kind: 'diagnostic', message: String(parsed.message ?? trimmed) };
    }
  } catch {
    // fall through to raw diagnostic
  }
  return { kind: 'diagnostic', message: trimmed };
}

export function normalizeRunnerResult(raw: RawRunnerResult): NormalizedPiResult {
  const status = VALID_STATUSES.includes(raw.status as PiStatus)
    ? (raw.status as PiStatus)
    : 'error';
  const pi = raw.pi ?? {};
  return {
    taskId: String(raw.task_id ?? 'unknown'),
    status,
    summary: String(raw.summary ?? ''),
    attempt: typeof raw.attempt === 'number' ? raw.attempt : 1,
    pi: {
      agent: String(pi.agent ?? 'pi'),
      sessionMode: String(pi.sessionMode ?? 'no-session'),
      command: String(pi.command ?? 'pi'),
      mode: String(pi.mode ?? 'json'),
      version: pi.version ?? null,
      exitCode: pi.exitCode ?? null,
      sessionId: pi.sessionId ?? null,
    },
    artifacts: Array.isArray(raw.artifacts)
      ? raw.artifacts.map((artifact) => ({ path: String(artifact.path), kind: String(artifact.kind ?? 'file') }))
      : [],
    filesChanged: asStringArray(raw.files_changed),
    tests: asRecordArray(raw.tests),
    commandsExecuted: asStringArray(raw.commands_executed),
    errors: asStringArray(raw.errors),
    warnings: asStringArray(raw.warnings),
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
  };
}
