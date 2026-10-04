/** Provider-agnostic Planner LLM abstraction. */

import { ProgressEvent } from '../pi/pi-protocol';

export interface LLMRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Live runtime progress, e.g. the planner streaming its JSON answer. */
  onProgress?: (event: ProgressEvent) => void;
}

export interface LLMResponse {
  text: string;
  raw?: unknown;
}

export interface LLMProvider {
  /** Stable provider id used for persistence metadata. */
  readonly id: string;
  /** Model id used for persistence metadata. */
  readonly model: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
}
