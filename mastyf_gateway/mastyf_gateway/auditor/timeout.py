"""
Mastyf AIA Timeout Supervisor
Enforces non-blocking execution budgets and handles timeout escalations.
"""

import asyncio
import time
from typing import Callable, Coroutine, Any, Optional
from ..models import AIADecision

class AsyncTimeoutSupervisor:
    """Supervises asynchronous execution against a timeout deadline."""

    def __init__(self, hard_timeout_ms: float = 800.0, target_slo_ms: float = 50.0):
        self.hard_timeout_ms = hard_timeout_ms
        self.target_slo_ms = target_slo_ms

    async def supervise(
        self,
        coro: Coroutine[Any, Any, AIADecision],
        model_revision: str = "d59a6aa01f9139dff106146addb04109afa69c03"
    ) -> AIADecision:
        start = time.perf_counter()
        timeout_seconds = self.hard_timeout_ms / 1000.0

        try:
            res = await asyncio.wait_for(coro, timeout=timeout_seconds)
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            res.latency_ms = elapsed_ms
            return res
        except asyncio.TimeoutError:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            return AIADecision(
                decision="ESCALATE",
                confidence=0.0,
                invariant_violation="TIMEOUT_DEADLINE_EXCEEDED",
                reason_code="AIA_EVALUATION_TIMEOUT",
                malformed=False,
                timed_out=True,
                latency_ms=elapsed_ms,
                model_revision=model_revision
            )
        except Exception as e:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            return AIADecision(
                decision="ESCALATE",
                confidence=0.0,
                invariant_violation=f"AUDITOR_EXCEPTION: {type(e).__name__}",
                reason_code="AIA_EXECUTION_ERROR",
                malformed=True,
                timed_out=False,
                latency_ms=elapsed_ms,
                model_revision=model_revision
            )
