/**
 * Planner LLM transport: a one-shot, tool-less Pi run.
 *
 * Both the Planner and the Executor use models configured in the Pi agent, so
 * the Planner reuses the same process boundary and Pi CLI authentication as the
 * Executor. No credentials or model catalogs are duplicated here.
 */

import { PiExecutionConfigPayload, PiExecutionRequest } from '../pi/pi-protocol';
import { PiRunner } from '../pi/pi-runner';
import { LLMProvider, LLMRequest, LLMResponse } from './provider';

export interface PiPlannerConfig {
  pythonPath: string;
  runnerScript: string;
  cwd: string;
  /** Provider/model/thinking/timeout come from the Planner settings. */
  pi: PiExecutionConfigPayload;
}

export class PiPlannerProvider implements LLMProvider {
  readonly id: string;
  readonly model: string;

  constructor(private readonly config: PiPlannerConfig) {
    this.id = config.pi.provider || 'pi';
    this.model = config.pi.model || 'pi-default';
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const payload: PiExecutionRequest = {
      task_id: 'planner',
      attempt: 1,
      rawPrompt: true,
      // Planning is read-only: the executor runner grants the tools, but the
      // planner must never be able to write. Tool use is allowed because
      // agentic models otherwise emit tool-call markup instead of JSON.
      pi: { ...this.config.pi, noSession: true },
      prompt: `${request.system}\n\n${request.user}`,
      instructions: [],
      context: {
        workspaceRoot: this.config.cwd,
        files: [],
        artifacts: [],
        constraints: [],
        environment: {},
      },
    };

    const result = await new PiRunner().run(payload, {
      pythonPath: this.config.pythonPath,
      runnerScript: this.config.runnerScript,
      cwd: this.config.cwd,
      signal: request.signal,
      onProgress: request.onProgress,
    });

    if (result.status !== 'completed') {
      const detail = result.errors.join('; ') || result.summary;
      throw new Error(`planner Pi run ${result.status}: ${detail}`);
    }
    if (!result.summary.trim()) {
      throw new Error('planner Pi run returned no assistant text');
    }
    return { text: result.summary };
  }
}
