/**
 * Core domain model for the AI Project Designer extension.
 *
 * PLANNING and EXECUTION are deliberately separate types:
 *  - the Planner produces a `PlannedTask` (a specification), and
 *  - the Executor consumes a `Task` whose `executorPrompt`/`context` fully
 *    describe ONE isolated Pi run.
 */

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped';

export type SessionStatus = 'draft' | 'planning' | 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ArtifactReference {
  path: string;
  kind: string;
  content?: string;
}

export interface ContextFile {
  path: string;
  content: string;
  truncated?: boolean;
}

export interface GitContext {
  branch?: string;
  modified: string[];
  staged: string[];
}

export interface TaskContext {
  workspaceRoot: string;
  files: ContextFile[];
  artifacts: ArtifactReference[];
  constraints: string[];
  environment: Record<string, string>;
  git?: GitContext;
}

export interface PiRunInfo {
  agent: string;
  sessionMode: string;
  command: string;
  mode: string;
  version?: string | null;
  exitCode?: number | null;
  sessionId?: string | null;
}

export type PiStatus = 'completed' | 'failed' | 'cancelled' | 'timeout' | 'error';

export interface TaskResult {
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

export interface Task {
  id: string;
  title: string;
  description: string;
  order: number;
  dependencies: string[];
  status: TaskStatus;
  objective: string;
  /** Complete prompt sent to Pi for this specific execution. */
  executorPrompt: string;
  executorInstructions: string[];
  context: TaskContext;
  expectedOutput: string;
  acceptanceCriteria: string[];
  inputArtifacts: ArtifactReference[];
  outputArtifacts: ArtifactReference[];
  filesToRead: string[];
  filesToModify: string[];
  commands?: string[];
  /** Integration configuration, NOT an alternative LLM provider. */
  executorRuntime: 'pi';
  retryCount: number;
  result?: TaskResult;
}

// ---------------------------------------------------------------------------
// Planner output (untrusted model output, validated before use)
// ---------------------------------------------------------------------------

export interface PlannedTask {
  id: string;
  title: string;
  description: string;
  order: number;
  dependencies: string[];
  objective: string;
  executorPrompt: string;
  executorInstructions: string[];
  filesToRead: string[];
  filesToModify: string[];
  expectedOutput: string;
  acceptanceCriteria: string[];
  commands?: string[];
}

export interface PlannedProject {
  title: string;
  summary: string;
  assumptions: string[];
}

export interface PlannedPlan {
  project: PlannedProject;
  tasks: PlannedTask[];
}

export interface Plan {
  project: PlannedProject;
  tasks: Task[];
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface PlannerMetadata {
  provider: string;
  model: string;
  thinking?: string;
}

export interface PiRuntimeMetadata {
  command: string;
  mode: string;
  noSession: boolean;
  version?: string | null;
}

export interface Session {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  workspaceRoot: string;
  request: string;
  status: SessionStatus;
  planner: PlannerMetadata;
  pi: PiRuntimeMetadata;
  plan?: Plan;
}
