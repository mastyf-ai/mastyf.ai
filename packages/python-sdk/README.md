# Mastyf AI — Python SDK

Perimeter security proxy for MCP-based AI agents. Evaluates every tool call through the Mastyf policy engine before execution.

## Install

```bash
pip install mastyf-ai

# With framework integrations:
pip install mastyf-ai[openai-agents]  # OpenAI Agents SDK
pip install mastyf-ai[langchain]      # LangChain
```

## Quick Start

```python
from mastyf_ai import MastyfProxy

proxy = MastyfProxy("http://localhost:4000")

# Check health
print(proxy.health())  # {'status': 'ready'}

# Test a tool call against policy
decision = proxy.test_policy("read_file", {"path": "/etc/passwd"})
print(f"{decision.action}: {decision.reason}")
# Output: block: Path not in allowed list

# Scan a package
from mastyf_ai import TrustScanner
scanner = TrustScanner()
result = scanner.scan("@modelcontextprotocol/server-filesystem")
print(f"{result['trustGrade']} ({result['trustScore']}/100)")
```

## Framework Integration

### OpenAI Agents SDK

```python
from mastyf_ai import MastyfOpenAIGuard

guard = MastyfOpenAIGuard("http://localhost:4000")

@guard.wrap_tool
async def read_file(path: str) -> str:
    with open(path) as f:
        return f.read()
```

### LangChain

```python
from mastyf_ai import MastyfLangChainGuard

guard = MastyfLangChainGuard()
safe_tool = guard.wrap_tool(my_langchain_tool)
```

## CLI

```bash
mastyf health
mastyf test read_file --args '{"path":"/etc/passwd"}'
mastyf scan @modelcontextprotocol/server-filesystem
mastyf hooks
mastyf audit
```

## API Reference

See [docs.mastyf.ai](https://docs.mastyf.ai) for full API documentation.
