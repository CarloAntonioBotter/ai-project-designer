const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { runTests } = require('@vscode/test-electron');

// Launching from inside VS Code (extension host) inherits ELECTRON_RUN_AS_NODE,
// which makes the launched Code.exe run as plain node and fail to start.
delete process.env.ELECTRON_RUN_AS_NODE;

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aipd-host-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  try {
    await runTests({
      version: process.env.VSCODE_TEST_VERSION || 'stable',
      extensionDevelopmentPath: path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, '../out/test/extension-host/index.js'),
      launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes',
        '--disable-workspace-trust', '--no-sandbox', '--user-data-dir', path.join(root, 'user'),
        '--extensions-dir', path.join(root, 'extensions')],
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
