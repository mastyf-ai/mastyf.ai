"""
Mastyf Active Intent & Injection Auditor (AIA) Implementation
Provides the abstract auditor interface, deterministic test mocks, and local V6 neural auditor.
"""

from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
import asyncio
import time
import json

from ..models import ToolCallRequest, AIADecision
from ..config import AIAConfig
from .decoder import AIAOutputDecoder
from .timeout import AsyncTimeoutSupervisor

class BaseAIAAuditor(ABC):
    """Abstract interface for neural intent & injection auditors."""

    @abstractmethod
    async def evaluate(self, req: ToolCallRequest) -> AIADecision:
        """Asynchronously evaluate tool call request for prompt injection & intent deviation."""
        pass

class MockAIAAuditor(BaseAIAAuditor):
    """Deterministic mock auditor for fast unit tests, chaos injection, and state matrix fuzzing."""

    def __init__(
        self,
        default_decision: str = "ALLOW",
        simulated_latency_ms: float = 2.0,
        force_timeout: bool = False,
        force_malformed: bool = False,
        model_revision: str = "d59a6aa01f9139dff106146addb04109afa69c03"
    ):
        self.default_decision = default_decision
        self.simulated_latency_ms = simulated_latency_ms
        self.force_timeout = force_timeout
        self.force_malformed = force_malformed
        self.model_revision = model_revision

    async def evaluate(self, req: ToolCallRequest) -> AIADecision:
        start = time.perf_counter()

        if self.force_timeout:
            await asyncio.sleep(2.0)  # Exceeds typical timeout supervisor
            return AIADecision(
                decision="ESCALATE",
                timed_out=True,
                reason_code="AIA_EVALUATION_TIMEOUT",
                latency_ms=(time.perf_counter() - start) * 1000.0,
                model_revision=self.model_revision
            )

        if self.simulated_latency_ms > 0:
            await asyncio.sleep(self.simulated_latency_ms / 1000.0)

        if self.force_malformed:
            return AIAOutputDecoder.decode(
                raw_text="NOT_VALID_JSON_AT_ALL",
                latency_ms=(time.perf_counter() - start) * 1000.0,
                model_revision=self.model_revision
            )

        # Check if malicious payloads are present in retrieved context / args
        req_str = json.dumps(req.tool_args) + " " + (req.retrieved_context or "")
        if "INJECTION" in req_str.upper() or "PWNED" in req_str.upper() or "IGNORE PREVIOUS" in req_str.upper():
            return AIADecision(
                decision="BLOCK",
                confidence=0.99,
                invariant_violation="PROMPT_INJECTION_DETECTED",
                reason_code="AIA_INJECTION_DETECTED",
                latency_ms=(time.perf_counter() - start) * 1000.0,
                model_revision=self.model_revision
            )

        return AIADecision(
            decision=self.default_decision, # type: ignore
            confidence=0.98,
            invariant_violation="none",
            reason_code=f"AIA_{self.default_decision}",
            latency_ms=(time.perf_counter() - start) * 1000.0,
            model_revision=self.model_revision
        )

class LocalV6Auditor(BaseAIAAuditor):
    """
    Local runtime connector for Mastyf Guard V6 (Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened).
    Revision: d59a6aa01f9139dff106146addb04109afa69c03.
    """

    def __init__(self, config: Optional[AIAConfig] = None):
        self.config = config or AIAConfig()
        self.supervisor = AsyncTimeoutSupervisor(
            hard_timeout_ms=self.config.hard_timeout_ms,
            target_slo_ms=self.config.target_timeout_ms
        )
        self.model = None
        self.tokenizer = None
        self._initialized = False

    def _lazy_init(self):
        if self._initialized:
            return
        if self.config.mock_mode:
            self._initialized = True
            return

        try:
            import torch
            from transformers import AutoTokenizer, AutoModelForCausalLM
            self.tokenizer = AutoTokenizer.from_pretrained(
                self.config.model_name_or_path,
                revision=self.config.model_revision
            )
            self.model = AutoModelForCausalLM.from_pretrained(
                self.config.model_name_or_path,
                revision=self.config.model_revision,
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                device_map=self.config.device if torch.cuda.is_available() else None
            )
            self._initialized = True
        except Exception as e:
            # Fallback to mock mode if model weights or GPU unavailable locally
            self.config.mock_mode = True
            self._initialized = True

    def _format_prompt(self, req: ToolCallRequest) -> str:
        """Formats the input request into the V6 instruction template."""
        return (
            f"<|im_start|>system\nYou are Mastyf Guard v2.2, a deterministic security auditor for tool calls. "
            f"Audit the proposed tool call and output ONLY JSON in format: "
            f'{{"decision": "ALLOW"|"BLOCK"|"ESCALATE", "confidence": float, "invariant_violation": str, "reason_code": str}}<|im_end|>\n'
            f"<|im_start|>user\n"
            f"User Intent: {req.user_intent}\n"
            f"Retrieved Context: {req.retrieved_context}\n"
            f"Proposed Tool: {req.tool_name}\n"
            f"Arguments: {json.dumps(req.tool_args)}\n"
            f"<|im_end|>\n<|im_start|>assistant\n"
        )

    async def _infer(self, req: ToolCallRequest) -> AIADecision:
        self._lazy_init()
        start = time.perf_counter()

        if self.config.mock_mode or self.model is None or self.tokenizer is None:
            # Deterministic local heuristic mock
            await asyncio.sleep(0.005) # 5ms fast mock
            req_str = json.dumps(req.tool_args) + " " + (req.retrieved_context or "")
            is_attack = "INJECTION" in req_str.upper() or "PWNED" in req_str.upper() or "EXFIL" in req_str.upper()
            dec = "BLOCK" if is_attack else "ALLOW"
            return AIADecision(
                decision=dec,
                confidence=0.99 if is_attack else 0.95,
                invariant_violation="PROMPT_INJECTION_DETECTED" if is_attack else "none",
                reason_code="AIA_INJECTION_DETECTED" if is_attack else "AIA_ALLOW",
                latency_ms=(time.perf_counter() - start) * 1000.0,
                model_revision=self.config.model_revision
            )

        import torch
        prompt = self._format_prompt(req)
        inputs = self.tokenizer(prompt, return_tensors="pt")
        if torch.cuda.is_available() and self.config.device != "cpu":
            inputs = {k: v.to(self.config.device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=self.config.max_new_tokens,
                temperature=self.config.temperature,
                do_sample=False
            )

        gen_tokens = outputs[0][inputs["input_ids"].shape[1]:]
        raw_text = self.tokenizer.decode(gen_tokens, skip_special_tokens=True)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return AIAOutputDecoder.decode(raw_text, latency_ms=elapsed_ms, model_revision=self.config.model_revision)

    async def evaluate(self, req: ToolCallRequest) -> AIADecision:
        return await self.supervisor.supervise(self._infer(req), model_revision=self.config.model_revision)
