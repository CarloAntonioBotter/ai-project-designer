import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderSidebarHtml } from '../src/ui/sidebar/sidebar-html';

// renderSidebarHtml never touches the webview object, only emits the document.
const html = renderSidebarHtml({} as never);

// The controller imports 'vscode', so its confirmation flow is asserted on source.
const providerSource = fs.readFileSync(
  path.join(__dirname, '../../src/ui/sidebar/sidebar-provider.ts'),
  'utf8'
);

test('sidebar renders a plan notice box and routes plan notices into it', () => {
  assert.match(html, /id="planNotice"/);
  assert.match(html, /message\.where === 'plan'\) \{ setPlanNotice\(/);
});

test('sidebar clears the task detail when no task is selected (new session)', () => {
  assert.match(html, /renderDetail\(state\.detailTaskId\);/);
  assert.doesNotMatch(html, /if \(state\.detailTaskId\) \{ renderDetail/);
  assert.match(html, /if \(!task\) \{ section\.classList\.add\('hidden'\); return; \}/);
});

test('sidebar exposes a single stop control inside the busy box', () => {
  assert.match(html, /id="busy"[^>]*>[\s\S]*?id="stop"/);
  assert.equal((html.match(/id="stop"/g) || []).length, 1);
  assert.match(html, /el\('stop'\)\.disabled = !state\.busy/);
});

test('sidebar exposes an editable executor prompt for the selected task', () => {
  assert.match(html, /id="taskPrompt" class="md"/);
  assert.match(html, /id="savePrompt"/);
  assert.match(html, /type: 'saveTaskPrompt'/);
  assert.match(html, /promptTaskId = task\.id/);
  assert.match(html, /white-space: pre-wrap/);
  assert.match(
    html,
    /el\('promptEditor'\)\.classList\.toggle\('hidden', Boolean\(task\.result\)\)/
  );
  assert.doesNotMatch(html, /details class="prompt"/);
});

test('sidebar drops the previous session logs when the active session changes', () => {
  assert.match(html, /nextSessionId !== lastSessionId/);
  assert.match(html, /delete logs\[key\]/);
});

test('sidebar disables Retry Task and Save Prompt while a run is busy', () => {
  assert.match(html, /el\('savePrompt'\)\.disabled = state\.busy/);
  assert.match(html, /data-retry="[\s\S]{0,40}state\.busy \? ' disabled' : ''/);
});

test('sidebar disables New Session and Refresh Context while a run is busy', () => {
  assert.match(html, /el\('newSession'\)\.disabled = state\.busy/);
  assert.match(html, /el\('refresh'\)\.disabled = state\.busy/);
});

test('sidebar spinner is a rotating arc, not a uniform ring', () => {
  // A full ring reads as static while it spins: one accent border must trace the motion.
  assert.match(html, /\.spinner \{[\s\S]*?animation: spin /);
  assert.match(html, /\.spinner \{[\s\S]*?border-top-color: var\(--vscode-progressBar-background/);
});

test('sidebar scopes the plan failure notice to a session still in progress', () => {
  assert.match(html, /const CONCLUDED_SESSION = \{ completed: 1, failed: 1, cancelled: 1 \}/);
  assert.match(
    html,
    /const show = Boolean\(planNoticeText\) && !\(session && CONCLUDED_SESSION\[session\.status\]\)/
  );
  assert.match(html, /function setPlanNotice\(text\) \{\n    planNoticeText = text \|\| '';/);
});

test('sidebar fills each session row with the dark grey frame', () => {
  assert.match(html, /\.sessions li \{[\s\S]{0,300}background: #3d3d3d; color: #f0f0f0;/);
  assert.match(html, /\.sessions li \{[\s\S]{0,300}border: 1px solid #5a5a5a;/);
  assert.match(html, /\.sessions li:hover \{ background: #4a4a4a; \}/);
});

test('sidebar keeps the delete icon visible on the dark session frame', () => {
  // Theme-dependent secondary button colors can blend into the dark fill.
  assert.match(html, /\.sessions \.session-del \{\n    background: transparent; color: #f0f0f0; border: 1px solid #8a8a8a;/);
  assert.match(html, /\.sessions \.session-del:hover \{ background: rgba\(255, 255, 255, 0\.18\); \}/);
});

test('deleting any session from the list asks for confirmation', () => {  assert.match(
    providerSource,
    /const listed = store\.listSessions\(\)\.find\(\(summary\) => summary\.id === sessionId\)/
  );
  assert.match(providerSource, /if \(listed \|\| sessionId === this\.session\?\.id\) \{/);
  assert.match(providerSource, /confirmed !== 'Delete'/);
  // The modal dialog brings its own Cancel button: a second one is confusing.
  assert.doesNotMatch(providerSource, /\{ modal: true \},\n\s+'Delete',\n\s+'Cancel'/);
  assert.doesNotMatch(
    providerSource,
    /const target = sessionId === this\.session\?\.id \? this\.session : undefined/
  );
});

// Isolation and project trust stay defaults owned by the runtime, not form fields.
test('sidebar keeps no-session and project-trust toggles out of the form', () => {
  assert.doesNotMatch(html, /id="pi\.noSession"/);
  assert.doesNotMatch(html, /id="pi\.trustProjectFiles"/);
  assert.doesNotMatch(providerSource, /'pi\.noSession': pi\.noSession/);
  assert.doesNotMatch(providerSource, /'pi\.trustProjectFiles': Boolean/);
});

// "python" is a PATH lookup: the field keeps the editable command, the real
// interpreter is shown next to it instead of being written into the setting.
test('settings show the resolved python interpreter without rewriting the setting', () => {
  assert.match(html, /id="pythonResolved"/);
  assert.match(html, /'in use: ' \+ s\.pythonResolved/);
  assert.match(html, /is not a working Python interpreter/);
  assert.match(html, /hint\.classList\.toggle\('error', !s\.pythonResolved\)/);
  // Display only: the setting itself is edited in the VS Code settings.
  assert.doesNotMatch(html, /id="pythonPath"/);
  assert.doesNotMatch(providerSource, /pythonPath: String\(raw\.pythonPath/);
  assert.match(providerSource, /pythonResolved: this\.resolvedPython\(\)/);
  assert.match(providerSource, /this\.pythonProbe\.configured !== configured/);
});

// Generate/Run stay enabled, but a broken interpreter is reported on click.
test('every runner action reports an unusable python interpreter', () => {
  assert.match(providerSource, /private reportUnusablePython\(\): boolean \{/);
  assert.match(providerSource, /is not a working Python interpreter/);
  assert.equal(
    (providerSource.match(/if \(this\.reportUnusablePython\(\)\) \{ return; \}/g) || []).length,
    4
  );
});

test('settings put max repair attempts and font size on one row', () => {
  assert.match(
    html,
    /<div class="grid2 even">\s*<div class="field">\s*<label for="maxRetries">[\s\S]*?ui\.fontSize/
  );
  // Equal column widths for the pair, unlike the provider/model rows.
  assert.match(html, /\.grid2\.even \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\); \}/);
  // Provider/Thinking stay narrow so Model/Timeout keep the room.
  assert.match(
    html,
    /\.grid2 \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 2fr\); gap: 8px; \}/
  );
});

test('executor thinking and timeout share one 50/50 row', () => {
  assert.match(
    html,
    /<div class="grid2 even">\s*<div class="field">\s*<label for="pi\.thinking">[\s\S]*?pi\.timeout/
  );
});
