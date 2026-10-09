/**
 * Planner orchestration.
 *
 * The planner LLM only produces a validated JSON plan. It never writes to the
 * workspace: its Pi run is granted read-only tools at most. Malformed output
 * triggers a bounded repair retry: the validation errors and a snippet of the
 * offending response are fed back to the model.
 */

import { Plan } from '../models/types';
import { hasDependencyCycle, planToTasks, validatePlan } from '../models/validate';
import { extractJson } from '../utils/json';
import { LLMProvider } from '../llm/provider';
import { ProgressEvent } from '../pi/pi-protocol';
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserPrompt } from '../llm/planner-prompt';

export interface GeneratePlanInput {
  request: string;
  workspaceRoot: string;
  workspaceSummary: string;
  constraints: string[];
  systemPrompt?: string;
  provider: LLMProvider;
  maxRepairAttempts?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

const MAX_DESCRIPTION_IN_ERROR = 12;

/** Collapse the offending response to one short, readable line for the cause. */
function snippet(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function repairSuffix(errors: string[]): string {
  const listed = errors.slice(0, MAX_DESCRIPTION_IN_ERROR).map((error) => `- ${error}`).join('\n');
  return `\n\nYour previous response was invalid. Fix these problems and return ONLY valid JSON:\n${listed}`;
}

/**
 * Status line for the plan as the model streams it. One JSON document is
 * streamed, so the `"order"` keys seen so far are the tasks already written.
 */
export function planStreamStatus(streamed: string): string {
  const started = streamed.match(/"order"\s*:/g);
  return started && started.length > 0 ? `Generating task ${started.length}…` : 'Drafting project and tasks…';
}

/** Map a runtime progress event to one short status line for the sidebar. */
function plannerStatus(event: ProgressEvent, streamed: string): string {
  if (event.kind === 'diagnostic') {
    return 'Waiting for the planner model…';
  }
  switch (event.type) {
    case 'text':
      return planStreamStatus(streamed);
    case 'tool_start':
      return `Planner is reading the workspace (${String(event.tool ?? 'tool')})…`;
    case 'tool_end':
      return 'Planner is reading the workspace…';
    case 'session':
      return 'Planner session started…';
    case 'retry':
      return `Planner model retry: ${String(event.message ?? '')}`.trim();
    case 'phase':
      return 'Finalizing plan…';
    default:
      return 'Planner is working…';
  }
}

export async function generatePlan(input: GeneratePlanInput): Promise<Plan> {
  const baseUser = buildPlannerUserPrompt({
    request: input.request,
    workspaceRoot: input.workspaceRoot,
    workspaceSummary: input.workspaceSummary,
    constraints: input.constraints,
  });

  const systemPrompt = (input.systemPrompt ?? '').trim() || PLANNER_SYSTEM_PROMPT;
  const attempts = Math.max(1, (input.maxRepairAttempts ?? 2) + 1);
  let lastErrors: string[] = [];
  let user = baseUser;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    input.onProgress?.(
      attempt === 1 ? 'Starting planner…' : `Plan invalid — asking the planner to fix it (attempt ${attempt}/${attempts})…`
    );
    let streamed = '';
    const response = await input.provider.generate({
      system: systemPrompt,
      user,
      signal: input.signal,
      onProgress: (event) => {
        if (event.kind === 'progress' && event.type === 'text') {
          streamed += String(event.delta ?? '');
        }
        input.onProgress?.(plannerStatus(event, streamed));
      },
    });
    input.onProgress?.('Validating plan…');

    let raw: unknown;
    try {
      raw = extractJson(response.text);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      lastErrors = [
        `response was not valid JSON: ${cause}`,
        `response began with: "${snippet(response.text)}"`,
      ];
      user = baseUser + repairSuffix(lastErrors);
      continue;
    }

    const validation = validatePlan(raw);
    if (!validation.ok) {
      // Every attempt is a fresh no-session Pi run, so the offending response
      // must travel in the repair prompt: without it the model never sees what
      // it produced and the retry is just a reroll that repeats the same shape.
      lastErrors = [...validation.errors, `your previous response was: "${snippet(response.text)}"`];
      user = baseUser + repairSuffix(lastErrors);
      continue;
    }

    if (hasDependencyCycle(validation.value)) {
      lastErrors = ['task dependencies contain a cycle'];
      user = baseUser + repairSuffix(lastErrors);
      continue;
    }

    return {
      project: validation.value.project,
      tasks: planToTasks(validation.value, input.workspaceRoot),
    };
  }

  throw new Error(`planner failed validation after ${attempts} attempts: ${lastErrors.join('; ')}`);
}
