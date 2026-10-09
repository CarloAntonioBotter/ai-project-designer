import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

/** Real Extension Host smoke: activation and command registration, without model calls. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('local.ai-project-designer');
  console.log("HOST SMOKE: extension found, activating");
  assert.ok(extension, "development extension is discoverable");
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const command of extension.packageJSON.contributes.commands) {
    assert.ok(commands.includes(command.command), `Missing command: ${command.command}`);
  }
  await vscode.commands.executeCommand('aiProjectDesigner.stopExecution');
  await vscode.commands.executeCommand("aiProjectDesigner.runCurrentTask");
  console.log("HOST SMOKE: all commands registered and callable");
}
