import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderSidebarHtml } from '../src/ui/sidebar/sidebar-html';
import { MAX_TOTAL_CONTEXT_CHARS } from '../src/orchestration/context-builder';

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
});

test('sidebar nests the executor prompt in the detail frame and collapses it', () => {
  // Prompt sits inside #detail, next to the re-rendered body, so it never gets wiped.
  assert.match(html, /<div id="detailBody"><\/div>\s*<div id="contextBox"[\s\S]*?<details id="promptEditor" class="collapse hidden">/);
  // The prompt sits above the execution log, not the other way round.
  assert.match(html, /<details id="promptEditor"[\s\S]*?<\/details>\s*<details id="logBox"/);
  assert.match(html, /<summary>Executor prompt \(editable before the first run\)<\/summary>/);
  assert.match(html, /el\('detailBody'\)\.innerHTML =/);
  assert.doesNotMatch(html, /el\('detail'\)\.innerHTML =/);
});

test('sidebar collapses the execution log and keeps the toggle across log lines', () => {
  // Static <details> under the prompt: the log text is written in place, so the element
  // (and its open/closed state) is never rebuilt by a log line.
  // Collapsed by default: the log is revealed by clicking the toggle.
  assert.match(html, /<details id="logBox" class="collapse">\s*<summary>Execution<\/summary>\s*<pre id="log" class="log"><\/pre>/);
  assert.doesNotMatch(html, /<details id="logBox" class="collapse" open>/);
  assert.match(html, /el\('log'\)\.textContent = log;/);
  assert.doesNotMatch(html, /logOpen/);
  // Native details, so the toggle needs no click handler of its own.
  assert.match(html, /details\.collapse > summary::before/);
  assert.match(html, /details\.collapse\[open\] > summary::before/);
});

test('sidebar joins the log with an escaped newline', () => {
  // The webview script lives in a template literal: the escape must reach the browser intact,
  // where it becomes the line separator of the <pre>.
  assert.ok(html.includes(".join('\\n')"), 'log join must escape the newline');
});

test('sidebar shows the context budget bar of the running attempt', () => {
  // Labelled, no toggle and no file list: the bar appears on its own once a run built its context.
  assert.match(html, /<div id="contextBox" class="hidden">\s*<p class="label">Context used<\/p>\s*<div id="contextBar" class="bar"><span id="contextFill"><\/span><\/div>/);
  assert.doesNotMatch(html, /<details id="contextBox"/);
  assert.doesNotMatch(html, /ctx-src/);
  assert.ok(html.includes(`const CONTEXT_BUDGET = ${MAX_TOTAL_CONTEXT_CHARS};`), 'the bar must use the real budget');
  // Injected files only: what the agent reads on its own is not ours to spend.
  assert.match(html, /const used = injected\.reduce\(function \(sum, file\) \{ return sum \+ \(file\.chars \|\| 0\); \}, 0\);/);
  assert.match(html, /const pct = Math\.min\(100, Math\.round\(\(used \/ CONTEXT_BUDGET\) \* 100\)\);/);
  assert.match(html, /el\('contextBox'\)\.classList\.toggle\('hidden', injected\.length === 0\)/);
  assert.match(html, /el\('contextBar'\)\.classList\.toggle\('full', pct >= 90\)/);
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
  assert.match(html, /\.sessions li \{[\s\S]{0,300}background: #232323; color: #f0f0f0;/);
  assert.match(html, /\.sessions li \{[\s\S]{0,300}border: 1px solid #3a3a3a;/);
  assert.match(html, /\.sessions li:hover \{ background: #303030; \}/);
});

test('sidebar emits a webview script that parses', () => {
  // The document is built by string interpolation, so a value dropped in unescaped
  // (a raw icon, say) becomes a SyntaxError that silently kills the whole sidebar:
  // no sessions, no plan, no tasks. Regex assertions cannot see that, this can.
  const scripts = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0, 'no inline script found');
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
});

test('sidebar keeps the delete control a visible red trash on the dark frame', () => {
  // Explicit colors: the secondary button ones are theme-dependent and can blend
  // into the dark fill. The icon is inline SVG, not a glyph.
  assert.match(html, /\.sessions \.session-del \{\n    background: rgba\(244, 135, 113, 0\.16\); color: var\(--vscode-charts-red, #f48771\);/);
  assert.match(html, /\.sessions \.session-del \{[\s\S]{0,120}border: none; border-radius: 50%;/);
  assert.match(html, /\.sessions \.session-del svg \{[\s\S]{0,120}stroke: currentColor;/);
  assert.match(html, /<button type="button" class="session-del"[^>]*aria-label="Delete session"/);
  // Emitted as a quoted JS string literal, not a bare token in the generated script.
  assert.match(html, /<button type="button" class="session-del"[^>]*>' \+[\s\S]{0,20}"<svg viewBox=/);
  assert.match(html, /<\/svg>" \+[\s\S]{0,40}<\/button>/);
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

test('sidebar textareas grow with their content instead of scrolling', () => {
  // resize: none hides the native grabber; the height is driven by scrollHeight.
  assert.match(html, /textarea \{ min-height: 90px; resize: none; overflow: hidden; \}/);
  assert.match(html, /area\.style\.height = 'auto';/);
  assert.match(html, /area\.style\.height = \(area\.scrollHeight/);
  assert.match(html, /function growAll\(\) \{ document\.querySelectorAll\('textarea'\)\.forEach\(grow\); \}/);
  assert.match(html, /addEventListener\('input'/);
});
