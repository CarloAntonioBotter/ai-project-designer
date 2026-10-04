/** Static HTML/CSS/JS for the sidebar webview: Plan tab + Settings tab. */

import * as vscode from 'vscode';
import { renderMarkdown } from './markdown';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

export function renderSidebarHtml(webview: vscode.Webview): string {
  const n = nonce();
  const csp = [`default-src 'none'`, `style-src 'nonce-${n}'`, `script-src 'nonce-${n}'`].join('; ');
  const markdownSource = renderMarkdown.toString();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AI Project Designer</title>
<style nonce="${n}">
  :root { color-scheme: light dark; --radius: 6px; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--ui-font-size, calc(var(--vscode-font-size) - 1px));
    color: var(--vscode-foreground);
    padding: 10px;
    margin: 0;
    overflow-wrap: anywhere; /* long paths/URLs must not force a horizontal scrollbar */
  }
  /* One type scale for the whole sidebar: everything inherits the base font
     size (like the Project section); hierarchy comes from weight/case/opacity. */
  h1, h2, h3, h4, h5, h6 { font-size: inherit; }
  h1 { margin: 0 0 8px; font-weight: 600; }
  /* One label style for section headers and fieldset legends: they must look
     identical, only the markup differs. */
  h2, legend { text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.75; font-weight: 600; }
  h2 { margin: 16px 0 6px; }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: var(--radius); padding: 5px 12px; cursor: pointer;
    font-family: inherit; font-size: inherit;
  }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    border: 1px solid var(--vscode-button-border, var(--vscode-panel-border, rgba(128,128,128,0.6)));
  }
  button:disabled { opacity: 0.45; cursor: default; }
  textarea, input[type="text"], input[type="password"], input[type="number"], select {
    width: 100%; box-sizing: border-box;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4));
    border-radius: var(--radius); padding: 5px 6px; font-family: inherit; font-size: inherit;
  }
  textarea { min-height: 90px; resize: none; }
  textarea:focus, input:focus, select:focus {
    outline: none;
    border-color: var(--vscode-input-focusBorder, var(--vscode-focusBorder));
  }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(128,128,128,0.4)); border-radius: 5px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(128,128,128,0.7)); }
  ::-webkit-scrollbar-corner { background: transparent; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .meta { opacity: 0.8; }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35)); margin-bottom: 10px; }
  .tab { background: transparent; color: var(--vscode-foreground); border-radius: 0; border-bottom: 2px solid transparent; padding: 6px 10px; }
  .tab.active { border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
  .field { margin-bottom: 14px; }
  .field label { display: block; margin-bottom: 6px; opacity: 0.9; }
  .field .help { opacity: 0.65; margin-top: 2px; }
  .check { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
  .check input { width: auto; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .tasks { list-style: none; padding: 0; margin: 0; }
  .task { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35)); border-radius: var(--radius); padding: 6px 8px; margin-bottom: 4px; cursor: pointer; }
  .task:hover { background: var(--vscode-list-hoverBackground); }
  .task .title { display: flex; gap: 6px; align-items: flex-start; }
  .task .id { opacity: 0.6; flex: 0 0 auto; white-space: nowrap; }
  .task .desc { opacity: 0.85; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .badge {
    display: inline-flex; align-items: center; line-height: 1.2; font-size: 0.85em;
    padding: 1px 7px; border-radius: 8px; border: 1px solid currentColor;
    margin-left: auto; flex: 0 0 auto; white-space: nowrap;
  }
  .s-pending { color: var(--vscode-descriptionForeground); }
  .s-running { color: var(--vscode-charts-blue, #3794ff); }
  .s-completed { color: var(--vscode-charts-green, #89d185); }
  .s-failed { color: var(--vscode-charts-red, #f48771); }
  .s-blocked, .s-skipped { color: var(--vscode-descriptionForeground); }
  .detail { margin-top: 8px; padding: 8px; border-radius: var(--radius); border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-textBlockQuote-background); }
  .md > :first-child { margin-top: 0; }
  .md > :last-child { margin-bottom: 0; }
  .md pre { max-height: none; }
  .summary { margin-top: 4px; }
  pre { white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto; }
  .log { background: var(--vscode-textCodeBlock-background); padding: 6px; border-radius: var(--radius); }
  .error { color: var(--vscode-charts-red, #f48771); }
  .ok { color: var(--vscode-charts-green, #89d185); }
  .notice { margin: 8px 0; padding: 6px 8px; border-radius: var(--radius); background: var(--vscode-textCodeBlock-background); }
  .sessions { list-style: none; padding: 0; margin: 0; }
  .sessions li { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 3px; }
  .sessions li:hover { background: var(--vscode-list-hoverBackground); border-radius: var(--radius); }
  .sessions .session-name { flex: 1 1 auto; cursor: pointer; overflow-wrap: anywhere; }
  /* Icon buttons share one square box, so the stop control matches the ✕ buttons. */
  .sessions .session-del, #stop {
    flex: none; box-sizing: border-box; width: 1.6em; height: 1.6em; padding: 0; margin: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .busy { display: flex; align-items: center; gap: 8px; }
  #stop {
    margin-left: auto;
    color: var(--vscode-charts-red, #f48771); border-color: currentColor;
  }
  /* CSS square instead of the ■ glyph, whose font metrics are not centered. */
  #stop::before {
    content: ''; display: block; width: 0.5em; height: 0.5em;
    background: currentColor; border-radius: 1px;
  }
  .spinner {
    width: 14px; height: 14px; flex: none; border-radius: 50%;
    border: 2px solid var(--vscode-descriptionForeground, rgba(128,128,128,0.5));
    border-top-color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hidden { display: none; }
  textarea.md { min-height: 240px; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family, monospace); }
  .md-preview { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35)); border-radius: var(--radius); padding: 8px 10px; margin-top: 8px; }
  .md-preview h1, .md-preview h2, .md-preview h3, .md-preview h4 { margin: 8px 0 4px; }
  .md-preview p { margin: 4px 0; }
  .md-preview pre { margin: 6px 0; padding: 6px; border-radius: var(--radius); background: var(--vscode-textCodeBlock-background); }
  .md-preview code, .md code, .md pre { font-family: var(--vscode-editor-font-family, monospace); }
  .md-preview blockquote { margin: 4px 0; padding-left: 8px; border-left: 3px solid var(--vscode-focusBorder); opacity: 0.9; }
  fieldset { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35)); border-radius: var(--radius); margin: 0 0 16px; padding: 4px 12px 12px; }
  /* Bottom padding must be the real gap: no child (or grid cell) margin adds to it. */
  fieldset > :last-child, fieldset > .grid2:last-child > .field, .detail > :last-child, .md-preview > :last-child { margin-bottom: 0; }
  fieldset.planner-llm { margin-top: 20px; }
  .models-row { margin-bottom: 12px; align-items: center; }
  legend { padding: 0 6px; }
</style>
</head>
<body>
  <h1>AI Project Designer</h1>
  <div class="tabs">
    <button id="tabPlan" class="tab active">Plan</button>
    <button id="tabSettings" class="tab">Settings</button>
  </div>

  <div id="planView">
    <div class="row">
      <button id="newSession">New Session</button>
      <button id="refresh" class="secondary">Refresh Context</button>
    </div>
    <div id="runtime" class="meta"></div>
    <div id="planNotice" class="notice error hidden"></div>

    <div id="sessionsSection" class="hidden">
      <h2>Sessions</h2>
      <ul id="sessions" class="sessions"></ul>
    </div>

    <h2>User Request</h2>
    <textarea id="request" placeholder="Describe the project or change you want planned..."></textarea>
    <div class="row">
      <button id="generate">Generate Plan</button>
    </div>
    <div id="busy" class="notice busy hidden"><span class="spinner"></span><span id="busyText"></span><button id="stop" class="secondary" type="button" title="Stop the running activity"></button></div>

    <div id="projectSection" class="hidden">
      <h2>Project</h2>
      <div id="project" class="meta"></div>
    </div>

    <div id="planSection" class="hidden">
      <h2>Plan</h2>
      <ul id="tasks" class="tasks"></ul>
      <div class="row">
        <button id="runAll">Run All</button>
      </div>
    </div>

    <div id="detailSection" class="hidden">
      <h2>Task Detail</h2>
      <div id="detail" class="detail"></div>
      <div id="promptEditor" class="hidden">
        <div class="field">
          <label for="taskPrompt">Executor prompt (editable before the first run)</label>
          <textarea id="taskPrompt" class="md" spellcheck="false"></textarea>
          <div class="help">Used by this task's first run.</div>
        </div>
        <div class="row">
          <button id="savePrompt">Save Prompt</button>
        </div>
      </div>
    </div>
  </div>

  <div id="settingsView" class="hidden">
    <div id="settingsNotice" class="notice hidden"></div>

    <div class="row models-row">
      <button id="refreshModels" class="secondary">Refresh models from Pi</button>
      <span class="help" id="piModelsState"></span>
    </div>

    <fieldset class="planner-llm">
      <legend>Planner LLM (model from Pi agent)</legend>
      <div class="grid2">
        <div class="field">
          <label for="planner.provider">Provider</label>
          <select id="planner.provider"></select>
        </div>
        <div class="field">
          <label for="planner.model">Model</label>
          <select id="planner.model"></select>
        </div>
      </div>
      <div class="grid2">
        <div class="field">
          <label for="planner.thinking">Thinking</label>
          <select id="planner.thinking"></select>
        </div>
        <div class="field">
          <label for="planner.timeout">Timeout (s)</label>
          <input type="number" id="planner.timeout" min="1" />
        </div>
      </div>
    </fieldset>

    <fieldset>
      <legend>Planner system prompt (Markdown)</legend>
      <div class="field">
        <label for="planner.systemPrompt">System prompt</label>
        <textarea id="planner.systemPrompt" class="md" spellcheck="false" placeholder="Leave empty to use the built-in prompt"></textarea>
        <div class="help">Markdown is preserved and sent verbatim to the planner model. Empty = built-in prompt.</div>
      </div>
      <div class="row">
        <button id="togglePromptPreview" class="secondary" type="button">Preview</button>
        <button id="resetPrompt" class="secondary" type="button">Reset to built-in</button>
      </div>
      <div id="promptPreview" class="md-preview hidden"></div>
    </fieldset>

    <fieldset>
      <legend>Executor — Pi Agent</legend>
      <div class="grid2">
        <div class="field">
          <label for="pi.provider">Provider</label>
          <select id="pi.provider"></select>
        </div>
        <div class="field">
          <label for="pi.model">Model</label>
          <select id="pi.model"></select>
        </div>
      </div>
      <div class="field">
        <label for="pi.thinking">Thinking</label>
        <select id="pi.thinking"></select>
      </div>
      <div class="field">
        <label for="pi.command">Pi command</label>
        <input type="text" id="pi.command" placeholder="pi" />
      </div>
      <div class="field">
        <label for="pi.mode">Mode</label>
        <input type="text" id="pi.mode" readonly />
      </div>
      <div class="field">
        <label for="pi.tools">Tool allowlist (comma separated)</label>
        <input type="text" id="pi.tools" placeholder="read, edit, write, bash" />
      </div>
      <div class="field">
        <label for="pi.agentDir">Pi config dir (PI_CODING_AGENT_DIR, optional)</label>
        <input type="text" id="pi.agentDir" placeholder="empty = Pi default" />
      </div>
      <div class="field">
        <label for="pi.allowedExtensions">Allowed Pi extensions (comma separated)</label>
        <input type="text" id="pi.allowedExtensions" placeholder="empty = none loaded" />
      </div>
      <div class="field">
        <label for="pi.timeout">Timeout (s)</label>
        <input type="number" id="pi.timeout" min="1" />
      </div>
      <label class="check"><input type="checkbox" id="pi.noSession" /> Ephemeral no-session runs (required for isolation)</label>
      <label class="check"><input type="checkbox" id="pi.trustProjectFiles" /> Trust project-local files (--approve)</label>
    </fieldset>

    <fieldset>
      <legend>Runtime &amp; behavior</legend>
      <div class="field">
        <label for="pythonPath">Python path</label>
        <input type="text" id="pythonPath" placeholder="python" />
      </div>
      <div class="field">
        <label for="maxRetries">Max plan repair attempts</label>
        <input type="number" id="maxRetries" />
      </div>
      <div class="field">
        <label for="ui.fontSize">Font size (px)</label>
        <input type="number" id="ui.fontSize" min="8" max="24" />
        <div class="help">0 = follow the VS Code font size.</div>
      </div>
      <label class="check"><input type="checkbox" id="autoExecute" /> Auto-execute plan after generation</label>
      <div class="field">
        <label>Save scope</label>
        <label class="check"><input type="radio" name="scope" value="user" checked /> User settings</label>
        <label class="check"><input type="radio" name="scope" value="workspace" /> Workspace settings</label>
      </div>
    </fieldset>

    <div class="row">
      <button id="saveSettings">Save Settings</button>
      <button id="checkRuntime" class="secondary">Check Pi Runtime</button>
      <button id="testPlanner" class="secondary">Test Planner</button>
    </div>
    <div id="settingsResult" class="meta"></div>
  </div>

<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const renderMarkdown = ${markdownSource};
  let state = { tasks: [], sessions: [], busy: false, settings: null };
  let activeTab = 'plan';
  let settingsDirty = false;
  let lastSessionId;
  let liveStatus = '';
  let promptTaskId;
  const logs = {};

  const STATUS_ICON = { pending: '○', running: '●', completed: '✓', failed: '✗', blocked: '⊘', skipped: '–' };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(id) { return document.getElementById(id); }
  // One base size for the whole sidebar; 0 means "inherit the VS Code size".
  function applyFontSize() {
    const size = state.settings && state.settings.fontSize;
    if (size > 0) {
      document.documentElement.style.setProperty('--ui-font-size', size + 'px');
    } else {
      document.documentElement.style.removeProperty('--ui-font-size');
    }
  }
  function val(id) { const e = el(id); return e ? e.value : ''; }
  function num(id) { const v = parseFloat(val(id)); return isNaN(v) ? 0 : v; }
  function chk(id) { const e = el(id); return e ? e.checked : false; }
  function list(id) { return val(id).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  // Timeouts are stored in ms (the runtime contract) but edited in seconds.
  function toSeconds(ms) { return ms > 0 ? Math.round(ms / 1000) : 0; }
  function toMs(seconds) { return seconds > 0 ? Math.round(seconds * 1000) : 0; }

  function setTab(tab) {
    activeTab = tab;
    el('tabPlan').classList.toggle('active', tab === 'plan');
    el('tabSettings').classList.toggle('active', tab === 'settings');
    el('planView').classList.toggle('hidden', tab !== 'plan');
    el('settingsView').classList.toggle('hidden', tab !== 'settings');
    if (tab === 'settings' && !settingsDirty) { populateSettings(); }
  }

  el('tabPlan').addEventListener('click', function () { setTab('plan'); });
  el('tabSettings').addEventListener('click', function () { setTab('settings'); });

  // Mark the form dirty as soon as the user edits it, so incoming state
  // updates never overwrite unsaved input.
  el('settingsView').addEventListener('input', function (event) {
    settingsDirty = true;
    if (event.target && event.target.id === 'planner.systemPrompt' && !el('promptPreview').classList.contains('hidden')) {
      el('promptPreview').innerHTML = renderMarkdown(el('planner.systemPrompt').value);
    }
  });

  const THINKING_LEVELS = ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

  function fillProvider(selectId, selected) {
    const providers = Array.from(new Set((state.piModels || []).map(function (m) { return m.provider; }))).sort();
    if (selected && providers.indexOf(selected) === -1) { providers.unshift(selected); }
    const sel = el(selectId);
    sel.innerHTML = '<option value="">(Pi default)</option>' + providers.map(function (p) {
      return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
    }).join('');
    sel.value = selected || '';
  }

  function fillModels(modelSelectId, provider, selected) {
    const list = (state.piModels || []).filter(function (m) { return !provider || m.provider === provider; });
    let html = '<option value="">(Pi default)</option>' + list.map(function (m) {
      const meta = [m.context ? 'ctx ' + m.context : '', m.thinking ? 'thinking' : '', m.images ? 'images' : ''].filter(Boolean).join(' · ');
      return '<option value="' + esc(m.model) + '">' + esc(m.model) + (meta ? ' — ' + esc(meta) : '') + '</option>';
    }).join('');
    if (selected && !list.some(function (m) { return m.model === selected; })) {
      html += '<option value="' + esc(selected) + '">' + esc(selected) + ' (not in Pi list)</option>';
    }
    const sel = el(modelSelectId);
    sel.innerHTML = html;
    sel.value = selected || '';
  }

  function fillThinking(selectId, selected) {
    const sel = el(selectId);
    sel.innerHTML = THINKING_LEVELS.map(function (level) {
      return '<option value="' + esc(level) + '">' + (level || '(Pi default)') + '</option>';
    }).join('');
    sel.value = selected || '';
  }

  function populateSettings() {
    const s = state.settings;
    if (!s) { return; }
    fillProvider('planner.provider', s.planner.provider);
    fillModels('planner.model', s.planner.provider, s.planner.model);
    fillThinking('planner.thinking', s.planner.thinking);
    el('planner.timeout').value = toSeconds(s.planner.timeout);
    el('planner.systemPrompt').value = s.planner.systemPrompt || s.planner.systemPromptDefault;
    el('pi.command').value = s.pi.command;
    el('pi.mode').value = s.pi.mode;
    fillProvider('pi.provider', s.pi.provider || '');
    fillModels('pi.model', s.pi.provider || '', s.pi.model || '');
    fillThinking('pi.thinking', s.pi.thinking || '');
    el('pi.tools').value = (s.pi.tools || []).join(', ');
    el('pi.agentDir').value = s.pi.agentDir || '';
    el('pi.allowedExtensions').value = (s.pi.allowedExtensions || []).join(', ');
    el('pi.timeout').value = toSeconds(s.pi.timeout);
    el('pi.noSession').checked = !!s.pi.noSession;
    el('pi.trustProjectFiles').checked = !!s.pi.trustProjectFiles;
    el('pythonPath').value = s.pythonPath;
    el('maxRetries').value = s.maxRetries;
    el('ui.fontSize').value = s.fontSize;
    el('autoExecute').checked = !!s.autoExecute;
    renderPiModels();
  }

  function renderPiModels() {
    const models = state.piModels || [];
    el('piModelsState').textContent = models.length
      ? models.length + ' model(s) from Pi agent (configured models only)'
      : (state.piModelsError || 'No models found.');
  }

  function collectSettings() {
    return {
      scope: document.querySelector('input[name="scope"]:checked').value,
      planner: {
        provider: val('planner.provider'),
        model: val('planner.model'),
        thinking: val('planner.thinking'),
        timeout: toMs(num('planner.timeout')),
        systemPrompt: val('planner.systemPrompt')
      },
      pi: {
        command: val('pi.command'),
        mode: val('pi.mode'),
        provider: val('pi.provider'),
        model: val('pi.model'),
        thinking: val('pi.thinking'),
        tools: list('pi.tools'),
        agentDir: val('pi.agentDir'),
        allowedExtensions: list('pi.allowedExtensions'),
        timeout: toMs(num('pi.timeout')),
        noSession: chk('pi.noSession'),
        trustProjectFiles: chk('pi.trustProjectFiles')
      },
      pythonPath: val('pythonPath'),
      maxRetries: num('maxRetries'),
      fontSize: num('ui.fontSize'),
      autoExecute: chk('autoExecute')
    };
  }

  el('saveSettings').addEventListener('click', function () {
    el('settingsResult').textContent = 'Saving...';
    vscode.postMessage({ type: 'saveSettings', settings: collectSettings() });
  });
  el('checkRuntime').addEventListener('click', function () {
    el('settingsResult').textContent = 'Checking Pi runtime...';
    vscode.postMessage({ type: 'checkRuntime' });
  });
  el('testPlanner').addEventListener('click', function () {
    el('settingsResult').textContent = 'Testing planner...';
    vscode.postMessage({ type: 'testPlanner' });
  });
  el('refreshModels').addEventListener('click', function () {
    el('piModelsState').textContent = 'Refreshing...';
    vscode.postMessage({ type: 'refreshModels' });
  });
  el('togglePromptPreview').addEventListener('click', function () {
    const box = el('promptPreview');
    const show = box.classList.contains('hidden');
    box.classList.toggle('hidden', !show);
    if (show) { box.innerHTML = renderMarkdown(el('planner.systemPrompt').value); }
  });
  el('resetPrompt').addEventListener('click', function () {
    const s = state.settings;
    el('planner.systemPrompt').value = (s && s.planner.systemPromptDefault) || '';
    settingsDirty = true;
    if (!el('promptPreview').classList.contains('hidden')) {
      el('promptPreview').innerHTML = renderMarkdown(el('planner.systemPrompt').value);
    }
  });
  [['planner.provider', 'planner.model'], ['pi.provider', 'pi.model']].forEach(function (pair) {
    el(pair[0]).addEventListener('change', function () {
      fillModels(pair[1], el(pair[0]).value, '');
      settingsDirty = true;
    });
  });

  function render() {
    const session = state.session;
    el('request').value = session ? session.request : '';
    el('runtime').textContent = state.runtime
      ? (state.runtime.available
          ? 'Pi ' + (state.runtime.version || 'unknown') + ' · json=' + state.runtime.jsonMode + ' · no-session=' + state.runtime.noSession
          : 'Pi not available: ' + (state.runtime.error || 'unknown'))
      : '';

    const sessionsSection = el('sessionsSection');
    sessionsSection.classList.toggle('hidden', state.sessions.length === 0);
    el('sessions').innerHTML = state.sessions.map(function (s) {
      return '<li data-session="' + esc(s.id) + '">' +
        '<span class="session-name">' + esc(s.name) + ' <span class="meta">· ' + esc(s.status) + '</span></span>' +
        '<button type="button" class="secondary session-del" data-delete="' + esc(s.id) + '" title="Delete session">✕</button>' +
        '</li>';
    }).join('');

    const project = session && session.plan ? session.plan.project : null;
    el('projectSection').classList.toggle('hidden', !project);
    el('project').innerHTML = project ? '<strong>' + esc(project.title) + '</strong><br />' + esc(project.summary) : '';

    el('planSection').classList.toggle('hidden', !session || !session.plan);
    el('tasks').innerHTML = state.tasks.map(function (task) {
      const icon = STATUS_ICON[task.status] || '○';
      return '<li class="task" data-task="' + esc(task.id) + '">' +
        '<div class="title"><span class="s-' + esc(task.status) + '">' + icon + '</span>' +
        '<span class="id">' + esc(task.id) + '</span><span class="desc">' + esc(task.title) + '</span>' +
        '<span class="badge s-' + esc(task.status) + '">' + esc(task.status) + '</span></div></li>';
    }).join('');

    const busyBox = el('busy');
    busyBox.classList.toggle('hidden', !state.busy);
    if (state.busy) {
      el('busyText').textContent = liveStatus ||
        (session && session.status === 'planning' ? 'Generating plan…' : 'Running tasks…');
    }

    el('generate').disabled = state.busy;
    el('runAll').disabled = state.busy || !session || !session.plan;
    el('stop').disabled = !state.busy;

    // Always re-render: with no selection (e.g. a new session) renderDetail hides the section.
    renderDetail(state.detailTaskId);
    if (activeTab === 'settings' && !settingsDirty) { populateSettings(); }
  }

  function renderDetail(taskId) {
    const task = state.tasks.find(function (t) { return t.id === taskId; });
    const section = el('detailSection');
    if (!task) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    if (task.id !== promptTaskId) {
      // Only reload on task change: keeps in-progress edits while the run streams logs.
      promptTaskId = task.id;
      el('taskPrompt').value = task.executorPrompt || '';
    }
    // Editing is allowed only before the task has ever run.
    el('promptEditor').classList.toggle('hidden', Boolean(task.result));
    const log = (logs[taskId] || []).slice(-200).join('\\n');
    el('detail').innerHTML =
      '<p><strong>' + esc(task.id) + ' — ' + esc(task.title) + '</strong></p>' +
      '<p><em>' + esc(task.objective) + '</em></p>' +
      '<p class="meta">dependencies: ' + esc((task.dependencies || []).join(', ') || 'none') + ' · attempt: ' + esc(task.attempt) + '</p>' +
      (task.summary ? '<div class="md summary">' + renderMarkdown(task.summary) + '</div>' : '') +
      (task.errors && task.errors.length ? '<p class="error">' + task.errors.map(esc).join('<br>') + '</p>' : '') +
      '<div class="row"><button class="secondary" data-retry="' + esc(task.id) + '">Retry Task</button></div>' +
      '<pre class="log">' + esc(log) + '</pre>';
  }

  el('newSession').addEventListener('click', function () { vscode.postMessage({ type: 'newSession' }); });
  el('refresh').addEventListener('click', function () { vscode.postMessage({ type: 'refreshContext' }); });
  el('generate').addEventListener('click', function () { vscode.postMessage({ type: 'generatePlan', request: el('request').value }); });
  el('runAll').addEventListener('click', function () { vscode.postMessage({ type: 'runPlan' }); });
  el('stop').addEventListener('click', function () { vscode.postMessage({ type: 'stop' }); });
  el('savePrompt').addEventListener('click', function () {
    if (!state.detailTaskId) { return; }
    vscode.postMessage({ type: 'saveTaskPrompt', id: state.detailTaskId, prompt: el('taskPrompt').value });
  });

  document.body.addEventListener('click', function (event) {
    const target = event.target.closest('[data-delete],[data-task],[data-retry],[data-session]');
    if (!target) { return; }
    if (target.dataset.delete) {
      event.stopPropagation();
      vscode.postMessage({ type: 'deleteSession', id: target.dataset.delete });
      return;
    }
    if (target.dataset.retry) { vscode.postMessage({ type: 'retryTask', id: target.dataset.retry }); }
    else if (target.dataset.task) { state.detailTaskId = target.dataset.task; renderDetail(target.dataset.task); }
    else if (target.dataset.session) { vscode.postMessage({ type: 'openSession', id: target.dataset.session }); }
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (message.type === 'state') {
      const prevRuntime = JSON.stringify(state.runtime);
      const nextSessionId = message.state.session ? message.state.session.id : undefined;
      if (!message.state.busy) { liveStatus = ''; }
      if (nextSessionId !== lastSessionId) {
        // Different (or no) session: drop every log of the previous one.
        lastSessionId = nextSessionId;
        promptTaskId = undefined;
        for (const key in logs) { delete logs[key]; }
        setPlanNotice('');
      } else if (message.state.session && message.state.session.status === 'planning') {
        setPlanNotice('');
      }
      state = message.state;
      applyFontSize();
      render();
      if (activeTab === 'settings' && JSON.stringify(state.runtime) !== prevRuntime) { showRuntime(state.runtime); }
    } else if (message.type === 'planProgress') {
      liveStatus = message.text || '';
      el('busyText').textContent = liveStatus;
    } else if (message.type === 'taskLog') {
      if (!logs[message.taskId]) { logs[message.taskId] = []; }
      if (message.replaceLast && logs[message.taskId].length > 0) {
        logs[message.taskId][logs[message.taskId].length - 1] = message.line;
      } else {
        logs[message.taskId].push(message.line);
      }
      if (state.detailTaskId === message.taskId) { renderDetail(message.taskId); }
    } else if (message.type === 'settingsSaved') {
      settingsDirty = false;
      setNotice('Settings saved.', true);
      populateSettings();
    } else if (message.type === 'notice') {
      if (message.where === 'settings') { setNotice(message.message, message.ok); }
      else if (message.where === 'plan') { setPlanNotice(message.message); }
      else { console.log(message.message); }
    } else if (message.type === 'runtimeReport') {
      showRuntime(message.report);
    }
  });

  function setPlanNotice(text) {
    const box = el('planNotice');
    box.textContent = text || '';
    box.classList.toggle('hidden', !text);
  }
  function setNotice(text, ok) {
    const box = el('settingsNotice');
    box.textContent = text;
    box.classList.remove('hidden');
    box.className = 'notice ' + (ok ? 'ok' : 'error');
    el('settingsResult').textContent = '';
  }
  function showRuntime(report) {
    if (!report) { return; }
    el('settingsResult').textContent = report.available
      ? 'Pi ' + report.version + ' OK (json=' + report.jsonMode + ', no-session=' + report.noSession + ', tools=' + report.toolAllowlist + ')'
      : 'Pi unavailable: ' + (report.error || 'unknown');
  }

  vscode.postMessage({ type: 'webviewReady' });
</script>
</body>
</html>`;
}
