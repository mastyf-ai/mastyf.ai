"""
Mastyf AIA Grammar-Constrained Output Decoder
Parses and validates structured verdicts from the neural auditor according to strict production schema.
"""

import json
import re
from typing import Dict, Any, Optional
from ..models import AIADecision, DecisionType

class AIAOutputDecoder:
    """Decodes raw model string outputs into structured AIADecision objects."""

    @staticmethod
    def decode(raw_text: str, latency_ms: float = 0.0, model_revision: str = "d59a6aa01f9139dff106146addb04109afa69c03") -> AIADecision:
        if not raw_text or not raw_text.strip():
            return AIADecision(
                decision="BLOCK",
                confidence=0.0,
                invariant_violation="EMPTY_AUDITOR_OUTPUT",
                reason_code="AIA_MALFORMED_OUTPUT",
                malformed=True,
                latency_ms=latency_ms,
                model_revision=model_revision
            )

        text = raw_text.strip()

        # Handle markdown JSON code blocks if present
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if json_match:
            text = json_match.group(1)
        else:
            # Try to extract the first balanced JSON object
            first_brace = text.find("{")
            last_brace = text.rfind("}")
            if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
                text = text[first_brace:last_brace+1]

        try:
            parsed = json.loads(text)
        except Exception:
            return AIADecision(
                decision="BLOCK",
                confidence=0.0,
                invariant_violation="JSON_DECODE_ERROR",
                reason_code="AIA_MALFORMED_OUTPUT",
                malformed=True,
                latency_ms=latency_ms,
                model_revision=model_revision
            )

        if not isinstance(parsed, dict):
            return AIADecision(
                decision="BLOCK",
                confidence=0.0,
                invariant_violation="SCHEMA_TYPE_ERROR",
                reason_code="AIA_MALFORMED_OUTPUT",
                malformed=True,
                latency_ms=latency_ms,
                model_revision=model_revision
            )

        # Extract and validate decision
        raw_decision = str(parsed.get("decision", "")).upper()
        if raw_decision not in ("ALLOW", "BLOCK", "ESCALATE"):
            return AIADecision(
                decision="BLOCK",
                confidence=0.0,
                invariant_violation="INVALID_DECISION_ENUM",
                reason_code="AIA_MALFORMED_OUTPUT",
                malformed=True,
                latency_ms=latency_ms,
                model_revision=model_revision
            )

        confidence = 1.0
        if "confidence" in parsed:
            try:
                confidence = float(parsed["confidence"])
                confidence = max(0.0, min(1.0, confidence))
            except (ValueError, TypeError):
                confidence = 1.0

        invariant_violation = str(parsed.get("invariant_violation", "none"))
        reason_code = str(parsed.get("reason_code", f"AIA_{raw_decision}"))

        return AIADecision(
            decision=raw_decision, # type: ignore
            confidence=confidence,
            invariant_violation=invariant_violation,
            reason_code=reason_code,
            malformed=False,
            timed_out=False,
            latency_ms=latency_ms,
            model_revision=model_revision
        )
