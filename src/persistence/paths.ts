import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id);
}

export function assertSafeId(id: string): void {
  if (!isSafeId(id)) { throw new Error(`Invalid storage id: ${id}`); }
}

/** Reject links below the trusted root, including dangling links and junctions. */
export function resolveInside(base: string, relativePath: string): string {
  const root = path.resolve(base);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (path.isAbsolute(relativePath) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`path escapes allowed directory: ${relativePath}`);
  }
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    if (part.includes(':')) { throw new Error(`Invalid path component: ${part}`); }
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`path escapes allowed directory through link: ${relativePath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
    }
  }
  // shortcut: local checks cannot prevent concurrent filesystem replacement; use OS sandboxing for hostile concurrent writers.
  return target;
}

export function atomicWrite(file: string, content: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function readBounded(file: string, maxChars: number): { content: string; truncated: boolean } {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc((maxChars + 1) * 4);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytes).toString('utf8');
    return { content: text.slice(0, maxChars), truncated: text.length > maxChars || fs.fstatSync(fd).size > bytes };
  } finally { fs.closeSync(fd); }
}
