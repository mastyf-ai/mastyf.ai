/**
 * @mastyf_ai/server — MCP server exposing security scan tools to AI assistants.
 * Integrates with @mastyf_ai/core detection engine at runtime.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { scanServer, verifyToolDefinitions, fetchToolsFromStdio, fetchToolsFromHttp } from '@mastyf_ai/core';

const server = new Server(
  { name: 'mastyf-ai', version: process.env.npm_package_version || '2.3.4' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scan_mcp_tools',
      description: 'Scan MCP server tool definitions for prompt injection, privilege escalation, exfiltration, and stealth attacks. Runs regex, schema, and optional semantic analysis.',
      inputSchema: {
        type: 'object',
        properties: {
          serverCommand: { type: 'string', description: 'Command to spawn a stdio MCP server' },
          serverArgs: { type: 'array', items: { type: 'string' }, description: 'Arguments for the command' },
          serverUrl: { type: 'string', description: 'URL for an HTTP/SSE MCP server instead of command' },
          skipSemantic: { type: 'boolean', description: 'Skip LLM semantic analysis (cost saving)', default: false },
        },
      },
    },
    {
      name: 'verify_manifest',
      description: 'Verify tool definitions against the tamper-resistant manifest. Detects changes, new tools, removed tools, and HMAC tampering.',
      inputSchema: {
        type: 'object',
        properties: {
          serverCommand: { type: 'string', description: 'Command to spawn the MCP server' },
          serverArgs: { type: 'array', items: { type: 'string' } },
          serverUrl: { type: 'string', description: 'HTTP/SSE server URL' },
          serverName: { type: 'string', description: 'Name for the server in the manifest' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'scan_mcp_tools') {
    try {
      let tools;
      let transport: "stdio" | "http" = "stdio";

      if (args?.serverUrl) {
        tools = await fetchToolsFromHttp({ url: args.serverUrl as string });
        transport = "http";
      } else if (args?.serverCommand) {
        tools = await fetchToolsFromStdio({
          command: args.serverCommand as string,
          args: (args.serverArgs as string[]) ?? [],
        });
      } else {
        return { content: [{ type: 'text', text: 'Provide serverCommand or serverUrl.' }] };
      }

      const result = await scanServer(
        args?.serverCommand as string ?? args?.serverUrl as string ?? 'unnamed',
        tools,
        transport,
        { skipSemantic: (args?.skipSemantic as boolean) ?? false }
      );

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Scan error: ${err?.message}` }] };
    }
  }

  if (name === 'verify_manifest') {
    try {
      let tools;
      if (args?.serverUrl) {
        tools = await fetchToolsFromHttp({ url: args.serverUrl as string });
      } else if (args?.serverCommand) {
        tools = await fetchToolsFromStdio({
          command: args.serverCommand as string,
          args: (args.serverArgs as string[]) ?? [],
        });
      } else {
        return { content: [{ type: 'text', text: 'Provide serverCommand or serverUrl.' }] };
      }

      const result = verifyToolDefinitions(tools, (args?.serverName as string) ?? 'scanned-server');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Manifest error: ${err?.message}` }] };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}