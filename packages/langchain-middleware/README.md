# @mastyf_ai/langchain-middleware

LangChain middleware adapter for mastyf.ai — the open-source MCP runtime security proxy.

Intercept and enforce security policy on every tool call made by LangChain agents.

## Install

```bash
npm install @mastyf_ai/langchain-middleware
```

## Usage

```ts
import { MastyfLangChainMiddleware } from '@mastyf_ai/langchain-middleware';

const middleware = new MastyfLangChainMiddleware({
  policyPath: './policy.yaml',
});

// Wrap your LangChain agent
const agent = middleware.wrap(myAgent);
```

## Related

- [mastyf.ai](https://github.com/mastyf-ai/mastyf.ai) — Main project
- [Cloud dashboard](https://mastyf-live.vercel.app) — Policy editor and fleet management
- [Python SDK](https://pypi.org/project/mastyf-ai/)
