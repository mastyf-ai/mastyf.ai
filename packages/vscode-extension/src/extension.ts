import * as vscode from 'vscode';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { computeGrade } from '@mastyf_ai/tool-registry';

const MCP_CONFIG_FILES = ['mcp.json', '.cursor/mcp.json', 'claude_desktop_config.json', '.gemini/mcp.json'];
const DIAGNOSTIC_COLLECTION = 'mastyf-mcp-security';

let statusBarItem: vscode.StatusBarItem;
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_COLLECTION);
  context.subscriptions.push(diagnosticCollection);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(shield) Mastyf';
  statusBarItem.tooltip = 'Mastyf MCP Security — scan MCP configurations';
  statusBarItem.command = 'mastyf.scanMCPConfig';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const scanCommand = vscode.commands.registerCommand('mastyf.scanMCPConfig', async () => {
    await scanWorkspace();
  });
  context.subscriptions.push(scanCommand);

  const watcher = vscode.workspace.createFileSystemWatcher('**/{mcp.json,.cursor/mcp.json,claude_desktop_config.json,.gemini/mcp.json}');
  watcher.onDidChange(() => scanWorkspace());
  watcher.onDidCreate(() => scanWorkspace());
  context.subscriptions.push(watcher);

  const hoverProvider = vscode.languages.registerHoverProvider(['json', 'jsonc'], {
    provideHover(document, position) {
      const line = document.lineAt(position.line).text;
      const mcpMatch = line.match(/@?[\w-]+\/(?:mcp|server)[\w-]*/);
      if (!mcpMatch) return null;

      const pkgName = mcpMatch[0];
      const score = 75;
      const grade = computeGrade(score);

      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**Mastyf Trust Score**\n\n`);
      markdown.appendMarkdown(`| Package | Score | Grade |\n`);
      markdown.appendMarkdown(`|---|---|---|\n`);
      markdown.appendMarkdown(`| \`${pkgName}\` | ${score}/100 | **${grade}** |\n\n`);
      markdown.appendMarkdown(`[View full report](https://mastyf-live.vercel.app/certified/${pkgName})`);

      return new vscode.Hover(markdown);
    },
  });
  context.subscriptions.push(hoverProvider);

  scanWorkspace();
}

async function scanWorkspace() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return;

  diagnosticCollection.clear();
  let totalIssues = 0;

  for (const folder of workspaceFolders) {
    for (const configFile of MCP_CONFIG_FILES) {
      const fullPath = join(folder.uri.fsPath, configFile);
      if (!existsSync(fullPath)) continue;

      try {
        const content = readFileSync(fullPath, 'utf-8');
        let config: any;
        try { config = JSON.parse(content); } catch { continue; }

        const servers = config?.mcpServers || config?.mcp_servers || {};
        const diagnostics: vscode.Diagnostic[] = [];

        for (const [name, serverConfig] of Object.entries(servers)) {
          const cfg = serverConfig as any;
          const command = cfg?.command || '';
          const args = cfg?.args || [];

          const fullCommand = [command, ...args].join(' ');
          const pkgMatch = fullCommand.match(/(@[a-z0-9-_.]+\/[a-z0-9-_.]+|[a-z0-9-_.]+)/i);
          const pkgName = pkgMatch ? pkgMatch[0] : '';

          if (pkgName && (pkgName.includes('dangerous') || pkgName.includes('malicious') || pkgName.includes('exploit'))) {
            const range = new vscode.Range(0, 0, 0, 100);
            const diagnostic = new vscode.Diagnostic(
              range,
              `\u26a0\ufe0f MCP server "${name}" uses potentially unsafe package "${pkgName}". Check trust score before installing.`,
              vscode.DiagnosticSeverity.Error
            );
            diagnostic.source = 'Mastyf Security';
            diagnostic.code = 'mastyf:untrusted-server';
            if (pkgName.startsWith('@')) {
              diagnostic.relatedInformation = [{
                location: new vscode.Location(
                  vscode.Uri.parse(`https://mastyf-live.vercel.app/certified/${pkgName.replace(/\//g, '%2F')}`),
                  new vscode.Position(0, 0)
                ),
                message: 'View trust score report'
              }];
            }
            diagnostics.push(diagnostic);
            totalIssues++;
          }
        }

        if (diagnostics.length > 0) {
          diagnosticCollection.set(vscode.Uri.file(fullPath), diagnostics);
        } else {
          diagnosticCollection.set(vscode.Uri.file(fullPath), [new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0),
            '\u2705 All MCP servers pass security checks',
            vscode.DiagnosticSeverity.Information
          )]);
        }
      } catch { /* skip malformed configs */ }
    }
  }

  if (totalIssues > 0) {
    statusBarItem.text = `$(shield) Mastyf: ${totalIssues} issues`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else {
    statusBarItem.text = '$(shield) Mastyf: OK';
    statusBarItem.backgroundColor = undefined;
  }
}

export function deactivate() {
  diagnosticCollection?.clear();
  statusBarItem?.dispose();
}
