import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSidebarHtml } from '../src/ui/sidebar/sidebar-html';

// renderSidebarHtml never touches the webview object, only emits the document.
const html = renderSidebarHtml({} as never);

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
