// Runs inside VS Code: reads the extension's state after it has polled Shield, writes it to SMOKE_OUT.
const vscode = require('vscode');
const fs = require('node:fs');

exports.run = async function run() {
  const ext = vscode.extensions.getExtension('mastyf-ai.mastyf-shield');
  await ext.activate();
  await new Promise((r) => setTimeout(r, 4000));
  const state = await vscode.commands.executeCommand('mastyfShield._smokeState');
  fs.writeFileSync(process.env.SMOKE_OUT, JSON.stringify({ appName: vscode.env.appName, ...state }, null, 2));
};
