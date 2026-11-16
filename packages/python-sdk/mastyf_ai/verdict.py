"""What a check decided."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

Decision = Literal["allow", "block", "redact"]


@dataclass(frozen=True)
class Verdict:
    """A check's decision. ``result`` holds the cleaned result when ``decision`` is ``"redact"``."""

    decision: Decision
    id: str
    layer: str | None = None
    rule: str | None = None
    reason: str | None = None
    result: Any = None

    @property
    def blocked(self) -> bool:
        return self.decision == "block"

    def model_message(self) -> str:
        """What the model is told when a call or result is blocked.

        It names the check, never the text that was matched: a blocked tool result was written by
        whoever controls that tool, so echoing it would hand their words straight back to the model.
        """
        parts = ": ".join(p for p in (self.layer, self.rule) if p)
        return f"Blocked by Mastyf ({parts})." if parts else "Blocked by Mastyf."

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "Verdict":
        decision = data.get("decision")
        if decision not in ("allow", "block", "redact"):
            raise ValueError(f"not a verdict: {decision!r}")
        return cls(
            decision=decision,
            id=str(data.get("id", "")),
            layer=data.get("layer"),
            rule=data.get("rule"),
            reason=data.get("reason"),
            result=data.get("result"),
        )
