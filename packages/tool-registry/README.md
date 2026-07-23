# @mastyf_ai/tool-registry

Tool registry SDK for mastyf.ai — the open-source MCP runtime security proxy.

Register and manage MCP tools with trust scoring, policy enforcement, and fleet management.

## Install

```bash
npm install @mastyf_ai/tool-registry
```

## Usage

```ts
import { ToolRegistry } from '@mastyf_ai/tool-registry';

const registry = new ToolRegistry({
  apiKey: process.env.MASTYF_API_KEY,
});

// Check trust score before installing a tool
const score = await registry.getTrustScore('some-mcp-package');
console.log(score.grade); // 'A', 'B', 'C', etc.
```

## Related

- [mastyf.ai](https://github.com/mastyf-ai/mastyf.ai) — Main project
- [Cloud dashboard](https://mastyf-live.vercel.app) — Policy editor and fleet management
- [Python SDK](https://pypi.org/project/mastyf-ai/)
