# @mastyf_ai/langchain-middleware (deprecated)

This package sent tool calls to a Mastyf proxy. It's replaced by
[`@mastyf_ai/guard/langchain`](https://www.npmjs.com/package/@mastyf_ai/guard), which checks every tool
call and tool result on your own machine, without a proxy:

```bash
npm uninstall @mastyf_ai/langchain-middleware
npm install @mastyf_ai/guard
```

```ts
import { guardTools } from '@mastyf_ai/guard/langchain';
```

Version 0.2.0 still works as before and prints a deprecation warning once.
