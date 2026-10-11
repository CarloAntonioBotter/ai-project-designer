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
    /el\('taskPrompt'\)\.readOnly = state\.busy \|\| Boolean\(task\.executed\)/
  );
});

test('sidebar nests two accessible tab panels in the detail frame', () => {
  assert.match(html, /<div id="detailBody"><\/div>[\s\S]*?role="tablist" aria-label="Task detail"/);
  assert.match(html, /id="tabPrompt"[^>]*role="tab"[^>]*aria-controls="promptEditor">Executor prompt \(editable before the first run\)/);
  assert.match(html, /id="tabExecution"[^>]*role="tab"[^>]*aria-controls="logBox"[^>]*>Execution/);
  assert.match(html, /id="promptEditor" role="tabpanel" aria-labelledby="tabPrompt"/);
  assert.match(html, /el\('detailBody'\)\.innerHTML =/);
  assert.doesNotMatch(html, /el\('detail'\)\.innerHTML =/);
});

test('sidebar keeps the execution result and log inside its tab panel', () => {
  assert.match(html, /<div id="logBox" class="hidden" role="tabpanel" aria-labelledby="tabExecution">\s*<div id="taskSummary" class="md summary hidden"><\/div>\s*<pre id="log" class="log"><\/pre>/);
  assert.doesNotMatch(html, /<details/);
  assert.match(html, /renderLog\(taskId\)/);
  assert.match(html, /el\('taskSummary'\)\.innerHTML = summary;/);
  // detailBody builds only metadata/errors/retry: the summary must not be in it.
  assert.match(html, /'<button class="secondary" data-retry="' \+ esc\(task\.id\)/);
  assert.doesNotMatch(html, /detailBody'\)\.innerHTML =[\s\S]{0,600}renderMarkdown\(task\.summary\)/);
  assert.doesNotMatch(html, /logOpen/);
  assert.match(html, /log\.scrollTop = log\.scrollHeight;/);
});

test('sidebar joins the log with an escaped newline', () => {
  // The webview script lives in a template literal: the escape must reach the browser intact,
  // where it becomes the line separator of the <pre>.
  assert.ok(html.includes(".join('\\n')"), 'log join must escape the newline');
});

test('sidebar shows the context token bar scaled to the model window', () => {
  // Labelled, no toggle and no file list: the bar appears on its own once a run built its context.
  assert.match(html, /<div id="contextBox" class="hidden">\s*<p class="label">Context used<\/p>\s*<div id="contextBar" class="bar"><span id="contextFill"><\/span><\/div>/);
  assert.doesNotMatch(html, /<details id="contextBox"/);
  assert.doesNotMatch(html, /ctx-src/);
  // Denominator is the executor model's token window (from Pi), not the char budget.
  assert.ok(html.includes(`const CONTEXT_BUDGET_TOKENS = ${Math.round(MAX_TOTAL_CONTEXT_CHARS / 4)};`), 'fallback budget must be tokens');
  assert.match(html, /const windowTokens = state\.contextWindowTokens \|\| CONTEXT_BUDGET_TOKENS;/);
  // Prefer what Pi reported for the last turn; fall back to the prompt estimate.
  assert.match(html, /const usedTokens = usage\[task\.id\] \|\| task\.contextTokens \|\| Math\.round\(\(task\.contextChars \|\| 0\) \/ CHARS_PER_TOKEN\);/);
  assert.match(html, /const pct = Math\.min\(100, Math\.round\(\(usedTokens \/ windowTokens\) \* 100\)\);/);
  assert.match(html, /tokens · ' \+ pct \+ '%'/);
  assert.match(html, /el\('contextBox'\)\.classList\.toggle\('hidden', usedTokens === 0\)/);
  assert.match(html, /el\('contextBar'\)\.classList\.toggle\('full', pct >= 90\)/);
  assert.match(html, /message\.type === 'taskUsage'/);
  assert.match(html, /id="pi\.contextWindow"/);
});

test('sidebar offers a run-from-scratch control once a task has executed', () => {
  assert.match(html, /<button id="runAll">Run All<\/button>\s*<button id="rerunAll"/);
  assert.match(html, /const hasExecuted = state\.tasks\.some\(function \(t\) \{ return t\.executed; \}\);/);
  assert.match(html, /el\('rerunAll'\)\.classList\.toggle\('hidden', !hasExecuted\)/);
  assert.match(html, /el\('rerunAll'\)\.addEventListener\('click', function \(\) \{ vscode\.postMessage\(\{ type: 'rerunPlan' \}\); \}\);/);
  assert.match(providerSource, /async rerunPlan\(\): Promise<void> \{/);
  assert.match(providerSource, /task\.result = undefined;/);
  assert.match(providerSource, /case 'rerunPlan':/);
  // The plan itself is kept: only results and status are reset.
  assert.doesNotMatch(providerSource, /rerunPlan[\s\S]{0,400}session\.plan = undefined/);
});

test('sidebar can mark an executed task as to do after confirmation', () => {
  // Offered only for a task that already produced a result.
  assert.match(html, /task\.executed\s*\? '<button class="secondary" data-mark=/);
  assert.match(html, /vscode\.postMessage\(\{ type: 'markTaskPending', id: target\.dataset\.mark \}\)/);
  assert.match(html, /\[data-delete\],\[data-task\],\[data-retry\],\[data-mark\],\[data-session\]/);
  assert.match(providerSource, /async markTaskPending\(taskId: string\): Promise<void> \{/);
  assert.match(providerSource, /showWarningMessage\(\s*`Mark task \$\{task\.id\} as to do\?/);
  assert.match(providerSource, /confirmed !== 'Mark as To Do'/);
  assert.match(providerSource, /case 'markTaskPending':/);
  // The result is discarded and the task becomes runnable again.
  assert.match(providerSource, /private resetTask\(task: Task\): void \{/);
  assert.match(providerSource, /task\.status = 'pending';/);
});

test('sidebar lets the detail set a per-task thinking level', () => {
  assert.match(html, /<label for="taskThinking">Thinking \(this task\)<\/label>\s*<select id="taskThinking"><\/select>/);
  assert.match(html, /fillThinking\('taskThinking', task\.thinking \|\| ''\)/);
  assert.match(html, /type: 'saveTaskThinking', id: state\.detailTaskId, thinking: el\('taskThinking'\)\.value/);
  assert.match(providerSource, /async saveTaskThinking\(taskId: string, thinking: string\)/);
  assert.match(providerSource, /thinking: task\.thinking \?\? ''/);
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

test('sidebar preserves final failure notices', () => {
  assert.match(html, /const show = Boolean\(planNoticeText\);/);
  assert.match(html, /function setPlanNotice\(text\) \{\n    planNoticeText = text \|\| '';/);
});

test('sidebar fills each session row with the dark grey frame', () => {
  assert.match(html, /\.sessions li \{[\s\S]{0,300}background: #232323; color: #f0f0f0;/);
  assert.match(html, /\.sessions li \{[\s\S]{0,300}border: 1px solid #3a3a3a;/);
  assert.match(html, /\.sessions li:hover \{ background: #303030; \}/);
  // The row's own frame is the only frame: the name button must not paint the
  // theme's secondary (blue) button border on top of it.
  assert.match(html, /\.sessions \.session-name \{[\s\S]{0,200}background: transparent; border: none;/);
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
  assert.match(providerSource, /private async runSingleTask/);
  assert.ok((providerSource.match(/this\.reportUnusablePython\(\)/g) || []).length >= 5);
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

test('user request and planner system prompt share dimensions and scroll instead of auto-growing', () => {
  assert.match(html, /textarea\.scroll \{ max-height: 320px; overflow: auto; resize: none; \}/);
  assert.match(html, /id="planner\.systemPrompt" class="md scroll"/);
  assert.match(html, /id="request" class="md scroll"/);
  assert.match(html, /textarea\.md \{ min-height: 240px;/);
  assert.match(html, /area\.classList\.contains\('scroll'\)/);
});

test('sidebar textareas grow with their content instead of scrolling', () => {
  // resize: none hides the native grabber; the height is driven by scrollHeight.
  assert.match(html, /textarea \{ min-height: 90px; resize: none; overflow: hidden; \}/);
  assert.match(html, /area\.style\.height = 'auto';/);
  assert.match(html, /area\.style\.height = \(area\.scrollHeight/);
  assert.match(html, /function growAll\(\) \{ document\.querySelectorAll\('textarea'\)\.forEach\(grow\); \}/);
  assert.match(html, /addEventListener\('input'/);
});
