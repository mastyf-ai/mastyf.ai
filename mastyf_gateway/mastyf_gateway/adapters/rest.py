"""
FastAPI REST Adapter for Mastyf Security Gateway
Exposes standardized /v1/gateway/evaluate, /v1/gateway/execute, /healthz, and /metrics endpoints.
"""

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict, Any, Optional

from ..models import ToolCallRequest, GatewayDecision
from ..gateway import MastyfGateway

def create_rest_app(gateway: Optional[MastyfGateway] = None) -> FastAPI:
    if gateway is None:
        import json
        from pathlib import Path
        from ..config import GatewayConfig
        from ..policy.schemas import PolicyDocument

        config = GatewayConfig()
        policy = None
        policy_dir = Path(config.cbac.policy_dir)
        if policy_dir.exists():
            for p_file in sorted(policy_dir.glob("*.json")):
                try:
                    with open(p_file) as f:
                        policy = PolicyDocument(**json.load(f))
                        break
                except Exception:
                    pass
        gateway = MastyfGateway(config=config, policy=policy)

    app = FastAPI(
        title="Mastyf Security Gateway",
        version="0.1.0",
        description="Deterministic-First Security Reference Monitor & Intent Auditor for AI Agents"
    )

    @app.get("/healthz")
    async def health_check():
        return gateway.health.check_liveness()

    @app.get("/readyz")
    async def readiness_check():
        res = gateway.health.check_readiness()
        if res.get("status") != "ready":
            return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=res)
        return res

    @app.get("/metrics")
    async def get_metrics():
        return gateway.metrics.get_summary()

    @app.post("/v1/gateway/evaluate", response_model=GatewayDecision)
    async def evaluate_tool_call(req: ToolCallRequest):
        decision = await gateway.evaluate_async(req)
        return decision

    return app
