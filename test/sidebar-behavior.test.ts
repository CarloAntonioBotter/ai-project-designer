import test from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'node:vm';
import { renderSidebarHtml } from '../src/ui/sidebar/sidebar-html';

function webview() {
  const nodes = new Map<string, any>();
  const element = (id: string): any => {
    if (nodes.has(id)) { return nodes.get(id); }
    const classes = new Set<string>();
    const node = { value: '', textContent: '', innerHTML: '', disabled: false, offsetParent: null,
      handlers: {} as Record<string, Function>, style: { setProperty() {}, removeProperty() {} },
      classList: { add: (s: string) => classes.add(s), remove: (s: string) => classes.delete(s),
        contains: (s: string) => classes.has(s), toggle: (s: string, on: boolean) => on ? classes.add(s) : classes.delete(s) },
      addEventListener(type: string, fn: Function) { this.handlers[type] = fn; } };
    nodes.set(id, node); return node;
  };
  let message: Function = () => {};
  const context = vm.createContext({ console, acquireVsCodeApi: () => ({ postMessage() {} }),
    document: { getElementById: element, querySelectorAll: () => [], querySelector: () => ({ value: 'user' }),
      addEventListener() {}, body: element('body'), documentElement: element('document') },
    window: { addEventListener: (type: string, fn: Function) => { if (type === 'message') { message = fn; } } },
  });
  const html = renderSidebarHtml({} as never);
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1];
  vm.runInContext(script, context);
  return { element, send: (data: unknown) => message({ data }) };
}

const state = (overrides = {}) => ({ session: { id: 'session-A', request: 'saved', status: 'planned' },
  tasks: [], sessions: [], busy: false, settings: null, ...overrides });

test('runtime updates preserve the request draft; switching sessions resets it', () => {
  const view = webview();
  view.send({ type: 'state', state: state() });
  const request = view.element('request');
  request.value = 'draft'; request.handlers.input();
  view.send({ type: 'state', state: state({ runtime: { available: true } }) });
  assert.equal(request.value, 'draft');
  view.send({ type: 'state', state: state({ session: { id: 'session-B', request: 'other' } }) });
  assert.equal(request.value, 'other');
});

test('executed prompt is hidden; errors remain visible in failed sessions', () => {
  const view = webview();
  view.send({ type: 'state', state: state({ detailTaskId: 'task-A', tasks: [
    { id: 'task-A', executed: true, status: 'failed', executorPrompt: 'prompt' },
  ] }) });
  assert.equal(view.element('promptEditor').classList.contains('hidden'), true);
  view.send({ type: 'notice', where: 'plan', message: 'Task failed' });
  view.send({ type: 'state', state: state({ session: { id: 'session-A', status: 'failed', request: 'saved' } }) });
  assert.equal(view.element('planNotice').textContent, 'Task failed');
  assert.equal(view.element('planNotice').classList.contains('hidden'), false);
});

test('streaming updates only bounded logs; new attempts do not inherit text', () => {
  const view = webview();
  view.send({ type: 'state', state: state({ detailTaskId: 'task-A', tasks: [{ id: 'task-A', summary: 'original', status: 'running' }] }) });
  view.element('taskSummary').innerHTML = 'sentinel';
  for (let i = 0; i < 300; i++) {
    view.send({ type: 'taskLog', taskId: 'task-A', line: 'x'.repeat(1000) });
  }
  view.send({ type: 'taskText', taskId: 'task-A', delta: 'first' });
  view.send({ type: 'taskText', taskId: 'task-A', delta: ' second' });
  assert.match(view.element('log').textContent, /assistant: first second$/);
  assert.ok(view.element('log').textContent.length <= 64000);
  assert.equal(view.element('taskSummary').innerHTML, 'sentinel');
  view.send({ type: 'taskLogReset', taskId: 'task-A' });
  view.send({ type: 'taskText', taskId: 'task-A', delta: 'new attempt' });
  assert.equal(view.element('log').textContent, 'assistant: new attempt');
});

// Load the controller against a minimal VS Code API; exercise its actual command methods.
const Module = require('node:module');
const load = Module._load;
let SidebarProvider: any;
try {
  Module._load = function (id: string, ...args: unknown[]) {
    if (id === 'vscode') { return { window: { showInformationMessage() {}, showWarningMessage() {} } }; }
    return load.call(this, id, ...args);
  };
  SidebarProvider = require('../src/ui/sidebar/sidebar-provider').SidebarProvider;
} finally { Module._load = load; }

function controller() {
  const provider = Object.create(SidebarProvider.prototype);
  provider.busy = false;
  provider.reportUnusablePython = () => false;
  provider.pushState = async () => {};
  provider.sessionStore = () => ({ saveSession() {} });
  provider.session = { status: 'planned', plan: { tasks: [
    { id: 'A', status: 'pending', dependencies: [], order: 1 },
    { id: 'B', status: 'blocked', dependencies: ['A'], order: 2 },
  ] } };
  return provider;
}

test('Run Current Task cannot replace a live controller or clear its busy state', async () => {
  const provider = controller();
  const original = new AbortController();
  provider.busy = true; provider.abortController = original;
  provider.runTask = async () => { assert.fail('must not run'); };
  await provider.runCurrentTask();
  assert.equal(provider.busy, true);
  assert.equal(provider.abortController, original);
});

test('single task reconciles dependencies and final session status', async () => {
  const provider = controller();
  provider.runTask = async (task: any) => { task.status = 'completed'; };
  await provider.runCurrentTask();
  assert.equal(provider.session.plan.tasks[1].status, 'pending');
  assert.equal(provider.session.status, 'planned');
  await provider.runCurrentTask();
  assert.equal(provider.session.status, 'completed');
  assert.equal(provider.busy, false);
});

test('Stop during single-task execution yields cancelled session and retains pending task', async () => {
  const provider = controller();
  provider.runTask = async () => { provider.stop(); };
  await provider.runCurrentTask();
  assert.equal(provider.session.status, 'cancelled');
  assert.equal(provider.session.plan.tasks[0].status, 'pending');
});
