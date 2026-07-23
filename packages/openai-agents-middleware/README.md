# @mastyf_ai/openai-agents-middleware

OpenAI Agents SDK middleware for mastyf.ai — the open-source MCP runtime security proxy.

Intercept and enforce security policy on every tool call made by OpenAI Agents.

## Install

```bash
npm install @mastyf_ai/openai-agents-middleware
```

## Usage

```ts
import { MastyfOpenAIAgentsMiddleware } from '@mastyf_ai/openai-agents-middleware';

const middleware = new MastyfOpenAIAgentsMiddleware({
  policyPath: './policy.yaml',
});

// Wrap your agent
const agent = middleware.wrap(myAgent);
```

## Related

- [mastyf.ai](https://github.com/mastyf-ai/mastyf.ai) — Main project
- [Cloud dashboard](https://mastyf-live.vercel.app) — Policy editor and fleet management
- [Python SDK](https://pypi.org/project/mastyf-ai/)
