import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as vscode from 'vscode';
import { PiExecutionConfigPayload, PiModelInfo } from './pi-protocol';
import { PiRunner, PiRuntimeReport } from './pi-runner';

export type { PiRuntimeReport } from './pi-runner';
export type { PiModelInfo } from './pi-protocol';

export function runnerScriptPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionUri.fsPath, 'python', 'executor_runner.py');
}

export interface ExtensionConfig {
  planner: {
    provider: string;
    model: string;
    thinking: string;
    timeoutMs: number;
    systemPrompt: string;
  };
  pi: PiExecutionConfigPayload;
  pythonPath: string;
  maxRetries: number;
  fontSize: number;
  autoExecute: boolean;
  /** Effective executor context window in tokens; 0 = use what Pi reports. */
  contextWindow: number;
}

function settings(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('aiProjectDesigner');
}

/**
 * Absolute interpreter behind a `pythonPath` setting (for display only): "python"
 * is a PATH lookup, so the user needs to see what it actually resolves to.
 * `undefined` means the configured command is not a working interpreter.
 */
export function resolvePython(pythonPath: string): string | undefined {
  try {
    const out = execFileSync(pythonPath, ['-c', 'import sys; print(sys.executable)'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export function readConfig(): ExtensionConfig {
  const trustProjectFiles = settings().get<boolean>('pi.trustProjectFiles', false);
  return {
    planner: {
      provider: settings().get<string>('planner.provider', ''),
      model: settings().get<string>('planner.model', ''),
      thinking: settings().get<string>('planner.thinking', ''),
      timeoutMs: settings().get<number>('planner.timeout', 300000),
      systemPrompt: settings().get<string>('planner.systemPrompt', ''),
    },
    pi: {
      command: settings().get<string>('pi.command', 'pi'),
      mode: settings().get<string>('pi.mode', 'json'),
      noSession: settings().get<boolean>('pi.noSession', true),
      provider: settings().get<string>('pi.provider', '') || undefined,
      model: settings().get<string>('pi.model', '') || undefined,
      thinking: settings().get<string>('pi.thinking', '') || undefined,
      tools: settings().get<string[]>('pi.tools', ['read', 'edit', 'write', 'bash', 'grep', 'find', 'ls']),
      trustProjectFiles,
      agentDir: settings().get<string>('pi.agentDir', '') || undefined,
      timeoutMs: settings().get<number>('pi.timeout', 120000),
      extraArgs: [],
    },
    pythonPath: settings().get<string>('pythonPath', 'python'),
    maxRetries: settings().get<number>('maxRetries', 2),
    fontSize: settings().get<number>('ui.fontSize', 0),
    autoExecute: settings().get<boolean>('autoExecute', false),
    contextWindow: settings().get<number>('pi.contextWindow', 0),
  };
}

export type ConfigScope = 'user' | 'workspace';

/**
 * Keys the workspace settings file already defines, i.e. keys that would
 * silently win over a user-scope save. The sidebar form reads the merged
 * configuration, so those keys must be written where they take effect.
 */
export function workspaceDefinedKeys(keys: string[]): string[] {
  const configuration = settings();
  return keys.filter((key) => configuration.inspect(key)?.workspaceValue !== undefined);
}

/**
 * Write a patch of `aiProjectDesigner.*` settings. Lets the in-sidebar
 * configuration form reuse VS Code's native settings storage instead of
 * inventing a second config file.
 */
export async function applySettings(patch: Record<string, unknown>, scope: ConfigScope): Promise<void> {
  const target = scope === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  const configuration = settings();
  for (const [key, value] of Object.entries(patch)) {
    await configuration.update(key, value, target);
  }
}

export async function checkPiRuntime(_context: vscode.ExtensionContext): Promise<PiRuntimeReport> {
  const config = readConfig();
  const runner = new PiRunner();
  return runner.checkRuntime(config.pythonPath, runnerScriptPath(_context), config.pi.command,
    config.pi.agentDir, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
}

/** Discover the models the Pi agent can actually use, via the Python boundary. */
export async function listPiModels(_context: vscode.ExtensionContext): Promise<PiModelInfo[]> {
  const config = readConfig();
  const runner = new PiRunner();
  return runner.listModels(config.pythonPath, runnerScriptPath(_context), config.pi.command,
    config.pi.agentDir, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
}
