/**
 * TS side of the process boundary.
 *
 * The extension NEVER calls an LLM directly to execute a task. It spawns the
 * Python runner, which spawns a fresh isolated Pi execution. This class only
 * manages the Python child process, progress streaming and cancellation.
 */

import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  NormalizedPiResult,
  PiExecutionRequest,
  PiModelInfo,
  ProgressEvent,
  RawRunnerResult,
  normalizeRunnerResult,
  parseProgressLine,
} from './pi-protocol';
import { PiStatus } from '../models/types';

export interface PiRuntimeReport {
  available: boolean;
  command: string;
  version: string | null;
  jsonMode: boolean;
  noSession: boolean;
  toolAllowlist: boolean;
  error: string | null;
}

export interface PiRunOptions {
  pythonPath: string;
  runnerScript: string;
  cwd: string;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

function errorResult(taskId: string, message: string, attempt: number): NormalizedPiResult {
  return {
    taskId,
    status: 'error' as PiStatus,
    summary: message,
    attempt,
    pi: { agent: 'pi', sessionMode: 'no-session', command: 'pi', mode: 'json', exitCode: null },
    artifacts: [],
    filesChanged: [],
    tests: [],
    commandsExecuted: [],
    errors: [message],
    warnings: [],
  };
}

function cancelledResult(taskId: string, attempt: number): NormalizedPiResult {
  const message = 'task cancelled by host';
  return {
    taskId,
    status: 'cancelled' as PiStatus,
    summary: message,
    attempt,
    pi: { agent: 'pi', sessionMode: 'no-session', command: 'pi', mode: 'json', exitCode: null },
    artifacts: [],
    filesChanged: [],
    tests: [],
    commandsExecuted: [],
    errors: [message],
    warnings: [],
  };
}

function killTree(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === 'win32' && child.pid) {
    // Terminate the whole tree so the Pi grandchild dies with the runner.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

export class PiRunner {
  /** Run exactly one isolated task through Python -> Pi. */
  run(request: PiExecutionRequest, options: PiRunOptions): Promise<NormalizedPiResult> {
    return new Promise((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(options.pythonPath, [options.runnerScript], {
          cwd: options.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        resolve(errorResult(request.task_id, `failed to start python runner: ${String(error)}`, request.attempt));
        return;
      }

      let stdout = '';
      let stderrBuffer = '';
      let stderrRaw = '';
      let settled = false;

      const finish = (result: NormalizedPiResult) => {
        if (settled) {
          return;
        }
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

      const onAbort = () => {
        options.onProgress?.({ kind: 'diagnostic', message: 'cancellation requested; terminating runner' });
        killTree(child);
      };
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });

      child.stderr.on('data', (chunk: string) => {
        stderrRaw += chunk;
        stderrBuffer += chunk;
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const event = parseProgressLine(line);
          if (event) {
            options.onProgress?.(event);
          }
        }
      });

      child.on('error', (error) => {
        finish(errorResult(request.task_id, `python runner error: ${error.message}`, request.attempt));
      });

      child.on('close', (code) => {
        if (stderrBuffer.trim()) {
          const event = parseProgressLine(stderrBuffer);
          if (event) {
            options.onProgress?.(event);
          }
        }
        const trimmed = stdout.trim();
        if (!trimmed) {
          const cancelled = options.signal?.aborted ?? false;
          if (cancelled) {
            finish(cancelledResult(request.task_id, request.attempt));
            return;
          }
          const stderrTail = stderrRaw.trim().split('\n').filter(Boolean).slice(-8).join('\n');
          const detail = [
            `python runner produced no result envelope (exit ${code ?? 'null'})`,
            stderrTail ? `stderr:\n${stderrTail}` : 'stderr: (empty)',
          ].join('\n');
          finish(errorResult(request.task_id, detail, request.attempt));
          return;
        }
        try {
          const parsed = JSON.parse(trimmed) as RawRunnerResult;
          finish(normalizeRunnerResult(parsed));
        } catch (error) {
          finish(errorResult(request.task_id, `invalid runner envelope: ${String(error)}`, request.attempt));
        }
      });

      child.stdin.write(JSON.stringify(request));
      child.stdin.end();
    });
  }

  /** Verify presence, version and required modes of the Pi CLI. */
  checkRuntime(pythonPath: string, runnerScript: string, command: string): Promise<PiRuntimeReport> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let child: ChildProcess;
      try {
        child = spawn(pythonPath, [runnerScript, '--check-runtime', '--command', command], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        resolve(this.unavailable(command, `failed to start python: ${String(error)}`));
        return;
      }
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => (stdout += chunk));
      child.stderr?.on('data', (chunk: string) => (stderr += chunk));
      child.on('error', (error) => resolve(this.unavailable(command, error.message)));
      child.on('close', () => {
        try {
          resolve(JSON.parse(stdout.trim()) as PiRuntimeReport);
        } catch {
          resolve(this.unavailable(command, stderr.trim() || 'runtime probe failed'));
        }
      });
    });
  }

  /** List the models Pi reports as available (auth-aware). Empty on failure. */
  listModels(pythonPath: string, runnerScript: string, command: string): Promise<PiModelInfo[]> {
    return new Promise((resolve) => {
      let stdout = '';
      let child: ChildProcess;
      try {
        child = spawn(pythonPath, [runnerScript, '--list-models', '--command', command], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        resolve([]);
        return;
      }
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => (stdout += chunk));
      child.on('error', () => resolve([]));
      child.on('close', () => {
        try {
          const parsed = JSON.parse(stdout.trim()) as unknown;
          resolve(Array.isArray(parsed) ? (parsed as PiModelInfo[]) : []);
        } catch {
          resolve([]);
        }
      });
    });
  }

  private unavailable(command: string, error: string): PiRuntimeReport {
    return { available: false, command, version: null, jsonMode: false, noSession: false, toolAllowlist: false, error };
  }
}
