// The Mastra adapter against the real @mastra/core, from the outside: run in a scratch project
// with the packed @mastyf_ai/check and @mastyf_ai/guard plus @mastra/core installed (CI job
// "mastra-real"; Mastra needs Node 22.13, so it isn't in the repository's own install).
import { createTool } from '@mastra/core/tools';
import { guardTools } from '@mastyf_ai/guard/mastra';
import { z } from 'zod';

const calls = [];
const tools = guardTools({
  readFile: createTool({
    id: 'read_file',
    description: 'Read a file.',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      calls.push(path);
      return `contents of ${path}`;
    },
  }),
});

const blocked = await tools.readFile.execute({ path: '/etc/passwd' }, {});
const allowed = await tools.readFile.execute({ path: './README.md' }, {});
const ok = String(blocked).startsWith('Blocked by Mastyf') && allowed === 'contents of ./README.md' && calls.join() === './README.md';
console.log(JSON.stringify({ blocked, allowed, calls }));
if (!ok) {
  console.error('the Mastra adapter did not behave as expected with the real @mastra/core');
  process.exitCode = 1;
} else {
  console.log('real Mastra: the sensitive call was blocked before running, the ordinary one ran');
}
// No process.exit(): the engine doesn't keep the process alive, and exiting with connections
// still closing trips a libuv assertion on Windows.
