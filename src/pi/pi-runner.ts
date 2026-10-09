/** Process boundary: each task runs in a fresh Python -> Pi invocation. */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  NormalizedPiResult, PiExecutionRequest, PiModelInfo, ProgressEvent,
  RawRunnerResult, normalizeRunnerResult, parseProgressLine,
} from './pi-protocol';
import { PiStatus } from '../models/types';

export interface PiRuntimeReport {
  available: boolean;
  compatible?: boolean;
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

function failure(request: PiExecutionRequest, message: string, status: PiStatus = 'error'): NormalizedPiResult {
  return {
    taskId: request.task_id, status, summary: message, attempt: request.attempt,
    pi: { agent: 'pi', sessionMode: 'no-session', command: request.pi.command, mode: 'json', exitCode: null },
    artifacts: [], filesChanged: [], tests: [], commandsExecuted: [], errors: [message], warnings: [], usage: {},
  };
}

function killTree(child: ChildProcess, force = false): void {
  if (!child.pid) { return; }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    killer.on('error', () => { child.kill(); });
  } else {
    try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); } catch { /* Already exited. */ }
  }
}

export class PiRunner {
  private static readonly active = new Set<() => void>();

  static stopAll(): void {
    for (const stop of PiRunner.active) { stop(); }
  }

  run(request: PiExecutionRequest, options: PiRunOptions): Promise<NormalizedPiResult> {
    if (options.signal?.aborted) { return Promise.resolve(failure(request, 'task cancelled by host', 'cancelled')); }
    return new Promise((resolve) => {
      const child = spawn(options.pythonPath, [options.runnerScript], {
        cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      });
      let stdout = '';
      let stderrBuffer = '';
      let stderrTail = '';
      let settled = false;
      let stopping = false;
      let forcedResult: NormalizedPiResult | undefined;
      let grace: NodeJS.Timeout | undefined;
      const finish = (result: NormalizedPiResult): void => {
        if (settled) { return; }
        settled = true;
        clearTimeout(deadline);
        if (grace) { clearTimeout(grace); }
        PiRunner.active.delete(onAbort);
        options.signal?.removeEventListener('abort', onAbort);
        resolve(forcedResult ?? result);
      };
      const terminate = (result: NormalizedPiResult): void => {
        if (settled || stopping) { return; }
        stopping = true;
        forcedResult = result;
        killTree(child);
        grace = setTimeout(() => { killTree(child, true); finish(result); }, 5000);
      };
      const onAbort = (): void => terminate(failure(request, 'task cancelled by host', 'cancelled'));
      // Python enforces the task timeout; this watchdog also covers a stuck runner/probe.
      const deadline = setTimeout(() => terminate(failure(request, 'runner deadline exceeded', 'timeout')),
        Math.min(2147483647, Math.max(1, request.pi.timeoutMs) + 15000));
      PiRunner.active.add(onAbort);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const progress = (line: string): void => {
        if (settled) { return; }
        const event = parseProgressLine(line);
        if (event) {
          try { options.onProgress?.(event); }
          catch (error) { terminate(failure(request, `Progress handling failed: ${String(error)}`)); }
        }
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (stdout.length + chunk.length > 8 * 1024 * 1024) {
          terminate(failure(request, 'runner result exceeded 8 MiB')); return;
        }
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-8192);
        stderrBuffer += chunk;
        let newline: number;
        while ((newline = stderrBuffer.indexOf('\n')) >= 0) {
          progress(stderrBuffer.slice(0, newline));
          stderrBuffer = stderrBuffer.slice(newline + 1);
        }
        if (stderrBuffer.length > 1024 * 1024) {
          terminate(failure(request, 'runner progress record exceeded 1 MiB'));
          stderrBuffer = '';
        }
      });
      child.on('error', (error) => finish(failure(request, `python runner error: ${error.message}`)));
      child.stdin.on('error', (error) => terminate(failure(request, `runner stdin error: ${error.message}`)));
      child.on('close', (code) => {
        if (stderrBuffer.trim()) { progress(stderrBuffer); }
        if (!stdout.trim()) {
          finish(failure(request, `python runner produced no result envelope (exit ${code})\nstderr:\n${stderrTail.trim()}`));
          return;
        }
        try { finish(normalizeRunnerResult(JSON.parse(stdout.trim()) as RawRunnerResult)); }
        catch (error) { finish(failure(request, `invalid runner envelope: ${String(error)}`)); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }

  private probe(pythonPath: string, runnerScript: string, command: string, mode: string,
    agentDir?: string, cwd?: string): Promise<unknown> {
    return new Promise((resolve) => {
      const child = spawn(pythonPath, [runnerScript, mode, '--command', command], {
        cwd, env: { ...process.env, ...(agentDir ? { PI_CODING_AGENT_DIR: agentDir } : {}) },
        stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32',
      });
      let output = '';
      let settled = false;
      let grace: NodeJS.Timeout | undefined;
      const finish = (value?: unknown): void => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        PiRunner.active.delete(stop);
        resolve(value);
      };
      const stop = (): void => {
        if (settled) { return; }
        killTree(child);
        grace = setTimeout(() => killTree(child, true), 5000);
        finish();
      };
      const timer = setTimeout(stop, 30000);
      PiRunner.active.add(stop);
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        if (output.length + chunk.length > 2 * 1024 * 1024) { stop(); return; }
        output += chunk;
      });
      child.on('error', () => finish());
      child.on('close', () => {
        if (grace) { clearTimeout(grace); }
        try { finish(JSON.parse(output)); } catch { finish(); }
      });
    });
  }

  async checkRuntime(pythonPath: string, runnerScript: string, command: string, agentDir?: string, cwd?: string): Promise<PiRuntimeReport> {
    const result = await this.probe(pythonPath, runnerScript, command, '--check-runtime', agentDir, cwd);
    if (result && typeof result === 'object' && 'available' in result) { return result as PiRuntimeReport; }
    return { available: false, compatible: false, command, version: null, jsonMode: false,
      noSession: false, toolAllowlist: false, error: 'runtime probe failed or timed out' };
  }

  async listModels(pythonPath: string, runnerScript: string, command: string, agentDir?: string, cwd?: string): Promise<PiModelInfo[]> {
    const result = await this.probe(pythonPath, runnerScript, command, '--list-models', agentDir, cwd);
    return Array.isArray(result) ? result as PiModelInfo[] : [];
  }
}
