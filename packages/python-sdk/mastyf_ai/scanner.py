"""MCP package trust scanner — scan npm packages for security grades."""

from typing import Dict, Any, Optional
from ..client import MastyfProxy


class TrustScanner:
    """Scan MCP server packages for trust scores."""

    def __init__(self, proxy_url: str = "http://localhost:4000"):
        self._proxy = MastyfProxy(proxy_url)

    def scan(self, package_name: str) -> Dict[str, Any]:
        """Scan a package and return its trust score."""
        import httpx
        r = httpx.post(
            f"{self._proxy.config.proxy_url.rstrip('/')}/api/registry/scan",
            json={"packageName": package_name},
            timeout=15.0,
        )
        r.raise_for_status()
        data = r.json()
        return data.get("result", {})

    def score(self, package_name: str) -> Optional[int]:
        """Return just the numeric trust score (0-100)."""
        result = self.scan(package_name)
        return result.get("trustScore")

    def grade(self, package_name: str) -> Optional[str]:
        """Return just the trust grade (A+ through F)."""
        result = self.scan(package_name)
        return result.get("trustGrade")
