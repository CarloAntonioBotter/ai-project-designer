/**
 * Builds a fresh TaskContext for every task.
 *
 * Context is always constructed from scratch: the request, explicitly selected
 * files, explicit artifacts and constraints. Nothing is inherited from a
 * previous Pi run or conversation.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArtifactReference, ContextFile, GitContext, TaskContext } from '../models/types';
import { resolveInside } from '../persistence/artifact-store';

export const MAX_FILE_CHARS = 20000;
export const MAX_CONTEXT_FILES = 15;
export const MAX_TOTAL_CONTEXT_CHARS = 120000;

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  'build',
  '.venv',
  'venv',
  '__pycache__',
  '.ai-project',
]);

export function readContextFile(workspaceRoot: string, relativePath: string): ContextFile {
  const absolute = resolveInside(workspaceRoot, relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    return { path: relativePath, content: `(file not found: ${relativePath})` };
  }
  const raw = fs.readFileSync(absolute, 'utf8');
  if (raw.length > MAX_FILE_CHARS) {
    return { path: relativePath, content: raw.slice(0, MAX_FILE_CHARS), truncated: true };
  }
  return { path: relativePath, content: raw };
}

export function collectGitContext(workspaceRoot: string): GitContext | undefined {
  try {
    const output = execFileSync('git', ['status', '--porcelain', '--branch'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 5000,
    });
    const lines = output.split('\n').filter((line) => line.trim().length > 0);
    const branchLine = lines.find((line) => line.startsWith('##'));
    return {
      branch: branchLine?.replace(/^##\s*/, ''),
      modified: lines.filter((line) => /^\s?M/.test(line)).map((line) => line.slice(3).trim()),
      staged: lines.filter((line) => /^[MADRC]/.test(line)).map((line) => line.slice(3).trim()),
    };
  } catch {
    return undefined;
  }
}

export interface BuildContextInput {
  workspaceRoot: string;
  filesToRead: string[];
  explicitFiles?: ContextFile[];
  artifacts?: ArtifactReference[];
  constraints?: string[];
  environment?: Record<string, string>;
}

export function buildTaskContext(input: BuildContextInput): TaskContext {
  const files: ContextFile[] = [];
  let totalChars = 0;

  for (const relativePath of input.filesToRead.slice(0, MAX_CONTEXT_FILES)) {
    const file = readContextFile(input.workspaceRoot, relativePath);
    if (totalChars + file.content.length > MAX_TOTAL_CONTEXT_CHARS) {
      files.push({ path: file.path, content: '(omitted: context budget exceeded)', truncated: true });
      continue;
    }
    totalChars += file.content.length;
    files.push(file);
  }

  for (const file of input.explicitFiles ?? []) {
    files.push(file);
  }

  return {
    workspaceRoot: input.workspaceRoot,
    files,
    artifacts: input.artifacts ?? [],
    constraints: input.constraints ?? [],
    environment: input.environment ?? {},
    git: collectGitContext(input.workspaceRoot),
  };
}

/** Compact, bounded workspace listing used as planner context. */
export function collectWorkspaceSummary(workspaceRoot: string, maxEntries = 200, maxDepth = 3): string {
  const entries: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (entries.length >= maxEntries || depth > maxDepth) {
      return;
    }
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (entries.length >= maxEntries) {
        return;
      }
      if (IGNORED_DIRS.has(child.name)) {
        continue;
      }
      const relative = path.relative(workspaceRoot, path.join(dir, child.name));
      if (child.isDirectory()) {
        entries.push(`${relative}/`);
        walk(path.join(dir, child.name), depth + 1);
      } else {
        entries.push(relative);
      }
    }
  };
  walk(workspaceRoot, 0);
  return entries.join('\n');
}
