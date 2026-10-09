/**
 * Builds a fresh TaskContext for every task.
 *
 * Context is always constructed from scratch: the request, explicitly selected
 * files, explicit artifacts and constraints. Nothing is inherited from a
 * previous Pi run or conversation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArtifactReference, ContextFile, TaskContext } from '../models/types';
import { readBounded, resolveInside } from '../persistence/paths';

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
  return { path: relativePath, ...readBounded(absolute, MAX_FILE_CHARS) };
}

export interface BuildContextInput {
  workspaceRoot: string;
  filesToRead: string[];
  explicitFiles?: ContextFile[];
  artifacts?: ArtifactReference[];
  constraints?: string[];
  environment?: Record<string, string>;
  prompt?: string;
  instructions?: string[];
}

export function buildTaskContext(input: BuildContextInput): TaskContext {
  const context: TaskContext = {
    workspaceRoot: input.workspaceRoot, files: [], artifacts: [],
    constraints: input.constraints ?? [], environment: input.environment ?? {}, omitted: [],
  };
  // Reserve room for the Python prompt wrapper as well as explicit instructions.
  const fixedChars = 2000 + (input.prompt?.length ?? 0) + JSON.stringify(input.instructions ?? []).length;
  const size = (): number => fixedChars + JSON.stringify(context).length;
  if (size() > MAX_TOTAL_CONTEXT_CHARS) { throw new Error('Prompt and constraints exceed context budget'); }
  const add = (item: ContextFile | ArtifactReference, artifact: boolean): void => {
    const list = artifact ? context.artifacts : context.files;
    if (!artifact && list.length >= MAX_CONTEXT_FILES) {
      context.omitted!.push(item.path); return;
    }
    const content = item.content ?? '';
    const bounded = { ...item, content: content.slice(0, MAX_FILE_CHARS) };
    if (content.length > MAX_FILE_CHARS && !artifact) { (bounded as ContextFile).truncated = true; }
    (list as Array<ContextFile | ArtifactReference>).push(bounded);
    if (size() > MAX_TOTAL_CONTEXT_CHARS) { list.pop(); context.omitted!.push(item.path); }
    else if (content.length > MAX_FILE_CHARS) { context.omitted!.push(`${item.path} (truncated)`); }
  };
  for (const file of input.explicitFiles ?? []) { add(file, false); }
  for (const name of input.filesToRead) {
    if (context.files.length >= MAX_CONTEXT_FILES) { context.omitted!.push(name); continue; }
    add(readContextFile(input.workspaceRoot, name), false);
  }
  for (const artifact of input.artifacts ?? []) { add(artifact, true); }
  if (size() > MAX_TOTAL_CONTEXT_CHARS) { throw new Error('Context metadata exceeds budget'); }
  context.initialChars = size();
  return context;
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
