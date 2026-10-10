import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { missingDeclaredOutputs, toWorkspaceRelative, requiredCommandPassed } from '../src/orchestration/executor';

test('required commands accept successful final commands after environment setup', () => {
  const command = 'powershell -Command "msbuild packages/Design.dproj /t:Build"';
  const report = (text: string, status: 'passed' | 'failed') => ({ command: text, status, detected: false });
  assert.equal(requiredCommandPassed(command, [report(command, 'passed')]), true);
  assert.equal(requiredCommandPassed(command, [report('export BDS=/studio\r\n' + command, 'passed')]), true);
  assert.equal(requiredCommandPassed(command, [report('export BDS=/studio\n' + command, 'failed')]), false);
  assert.equal(requiredCommandPassed(command, [report(command + '\necho done', 'passed')]), false);
  assert.equal(requiredCommandPassed(command, [report('echo ' + command, 'passed')]), false);
  assert.equal(requiredCommandPassed(command, [report('cat <<EOF\n' + command, 'passed')]), false);
  assert.equal(requiredCommandPassed(command, [report(command, 'passed'), report(command, 'failed')]), false);
  const logged = command + ' 2>&1 | tee -a demo/README.md\n'
    + 'status=${PIPESTATUS[0]}; printf \'exit code: %s\' "$status" >> demo/README.md; exit "$status"';
  assert.equal(requiredCommandPassed(command, [report(logged, 'passed')]), true);
  assert.equal(requiredCommandPassed(command, [report(logged, 'failed')]), false);
  assert.equal(requiredCommandPassed(command, [report(command + ' 2>&1 | tee log', 'passed')]), false);
  assert.equal(requiredCommandPassed(command, [report(logged.replace('PIPESTATUS[0]', 'PIPESTATUS[1]'), 'passed')]), false);
  assert.equal(requiredCommandPassed(command, [report(logged.replace('tee -a demo/README.md', 'tee log || true'), 'passed')]), false);
  assert.equal(requiredCommandPassed(command, []), false);
});

const root = path.resolve('/tmp/ws');

test('toWorkspaceRelative keeps relative paths', () => {
  assert.equal(toWorkspaceRelative(root, 'md2pdf/cli.py'), 'md2pdf/cli.py');
});

test('toWorkspaceRelative makes absolute in-workspace paths relative', () => {
  const absolute = path.join(root, 'tests', 'fixtures', 'sample.md');
  assert.equal(toWorkspaceRelative(root, absolute), 'tests/fixtures/sample.md');
});

test('toWorkspaceRelative rejects paths outside the workspace', () => {
  assert.equal(toWorkspaceRelative(root, path.join(root, '..', 'secret.txt')), undefined);
  assert.equal(toWorkspaceRelative(root, '../secret.txt'), undefined);
});

test('missingDeclaredOutputs lists the outputs a completed run failed to produce', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-'));
  fs.writeFileSync(path.join(workspace, 'present.json'), '[]', 'utf8');

  assert.deepEqual(missingDeclaredOutputs(workspace, ['present.json']), []);
  assert.deepEqual(missingDeclaredOutputs(workspace, ['present.json', 'data/raw/missing.json']), [
    'data/raw/missing.json',
  ]);
  // Empty declaration: nothing is required.
  assert.deepEqual(missingDeclaredOutputs(workspace, []), []);
  // A path escaping the workspace counts as missing, never as present.
  assert.deepEqual(missingDeclaredOutputs(workspace, ['../secret.txt']), ['../secret.txt']);
});

test('missingDeclaredOutputs accepts a .gitkeep whose folder exists', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-'));
  fs.mkdirSync(path.join(workspace, 'data', 'raw'), { recursive: true });

  // Folder created, placeholder file not: the folder was what the task promised.
  assert.deepEqual(missingDeclaredOutputs(workspace, ['data/raw/.gitkeep']), []);
  // Folder missing: the placeholder is still reported.
  assert.deepEqual(missingDeclaredOutputs(workspace, ['out/.gitkeep']), ['out/.gitkeep']);
});
