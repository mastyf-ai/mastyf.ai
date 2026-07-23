"""Mastyf proxy client — connects to a running Mastyf AI proxy instance."""

import httpx
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List


@dataclass
class MastyfConfig:
    proxy_url: str = "http://localhost:4000"
    api_key: Optional[str] = None
    tenant_id: str = "default"
    timeout: float = 10.0


@dataclass
class PolicyDecision:
    action: str  # "pass", "block", "flag"
    rule: str
    reason: str


class MastyfProxy:
    """Client for a running Mastyf AI proxy instance."""

    def __init__(self, config: MastyfConfig | str = "http://localhost:4000"):
        if isinstance(config, str):
            config = MastyfConfig(proxy_url=config)
        self.config = config
        self._client = httpx.Client(
            base_url=config.proxy_url.rstrip("/"),
            timeout=config.timeout,
            headers=self._build_headers(),
        )

    def _build_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        headers["X-Tenant-Id"] = self.config.tenant_id
        return headers

    def health(self) -> Dict[str, Any]:
        """Check proxy health."""
        r = self._client.get("/health")
        r.raise_for_status()
        return r.json()

    def test_policy(self, tool: str, args: Dict[str, Any], server: str = "default") -> PolicyDecision:
        """Test a tool call against the current policy without executing it."""
        r = self._client.post("/api/policy/test", json={
            "tool": tool,
            "server": server,
            "args": args,
        })
        r.raise_for_status()
        data = r.json()
        return PolicyDecision(
            action=data.get("action", "pass"),
            rule=data.get("rule", "unknown"),
            reason=data.get("reason", ""),
        )

    def evaluate_tool_call(self, tool: str, args: Dict[str, Any], server: str = "default") -> PolicyDecision:
        """Evaluate a tool call through the full policy engine and hooks."""
        r = self._client.post(f"{self.config.proxy_url.rstrip('/')}/mcp", json={
            "jsonrpc": "2.0",
            "id": "python-sdk",
            "method": "tools/call",
            "params": {"name": tool, "arguments": args},
        })
        data = r.json()
        if "error" in data:
            err = data["error"]
            return PolicyDecision(
                action="block",
                rule=err.get("data", {}).get("rule", "unknown"),
                reason=err.get("message", ""),
            )
        return PolicyDecision(action="pass", rule="default", reason="")

    def get_hooks(self) -> List[Dict[str, Any]]:
        """List all registered hooks."""
        r = self._client.get("/api/hooks")
        r.raise_for_status()
        return r.json().get("hooks", [])

    def register_hook(self, name: str, code: str, hook_type: str = "before", priority: int = 50) -> bool:
        """Register a custom hook."""
        r = self._client.post("/api/hooks", json={
            "name": name, "code": code, "type": hook_type, "priority": priority,
        })
        return r.status_code == 201

    def store_credential(self, token: str, provider: str = "api", credential_type: str = "bearer_token") -> str:
        """Store an API token in the encrypted credential broker."""
        r = self._client.post("/api/credentials", json={
            "token": token,
            "providerName": provider,
            "providerId": provider,
            "credentialType": credential_type,
        })
        r.raise_for_status()
        return r.json().get("id", "")

    def get_audit_chain(self) -> Dict[str, Any]:
        """Verify audit hash chain integrity."""
        r = self._client.get("/api/audit/verify")
        r.raise_for_status()
        return r.json()

    def get_learning_suggestions(self) -> List[Dict[str, Any]]:
        """Get whitelist suggestions from learning mode."""
        r = self._client.get("/api/learning/suggestions")
        r.raise_for_status()
        return r.json().get("suggestions", [])

    def close(self):
        self._client.close()


def run_eval(proxy: MastyfProxy, payloads: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Run evaluation payloads against the proxy policy."""
    r = httpx.post(
        f"{proxy.config.proxy_url.rstrip('/')}/api/eval/run",
        json={"payloads": payloads},
        timeout=30.0,
    )
    r.raise_for_status()
    return r.json()
