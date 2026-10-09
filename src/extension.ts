import * as vscode from 'vscode';
import { SidebarProvider } from './ui/sidebar/sidebar-provider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SidebarProvider(context);
  context.subscriptions.push(provider);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const register = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: unknown[]) => {
      try { return await handler(...args); }
      catch (error) { void vscode.window.showErrorMessage(String(error)); }
    }));
  };

  register('aiProjectDesigner.newSession', () => provider.newSession());
  register('aiProjectDesigner.generatePlan', () => provider.generatePlan());
  register('aiProjectDesigner.runPlan', () => provider.runPlan());
  register('aiProjectDesigner.runCurrentTask', () => provider.runCurrentTask());
  register('aiProjectDesigner.stopExecution', () => provider.stop());
  register('aiProjectDesigner.retryTask', (taskId?: unknown) =>
    provider.retryTask(typeof taskId === 'string' ? taskId : undefined)
  );
  register('aiProjectDesigner.openSession', (sessionId?: unknown) =>
    provider.openSession(typeof sessionId === 'string' ? sessionId : undefined)
  );
  register('aiProjectDesigner.refreshContext', () => provider.refreshContext());
  register('aiProjectDesigner.checkPiRuntime', () => provider.checkRuntime());
}

export function deactivate(): void {
  // Nothing to dispose beyond subscriptions.
}
