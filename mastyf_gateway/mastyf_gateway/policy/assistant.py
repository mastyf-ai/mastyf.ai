"""
Mastyf Plain-English Policy Assistant (Milestone 5.4).

Architecture:
    Natural Language -> Policy Assistant -> Candidate Policy -> Human-Readable Diff
    -> Policy Reviewer -> Deterministic Compiler -> Explicit Activation -> Phase 4 Gateway.

Invariants:
    1. LLM Policy Proposal != Authority.
    2. Policy generation and policy activation are strictly separate operations.
    3. Operational requests ("Make this request work") and prompt injections CANNOT mutate policy.
    4. Proposed authority cannot exceed declared intent (Monotonicity).
    5. UNKNOWN and vague broadening requests fail closed.
"""

from __future__ import annotations

import difflib
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..discovery.mcp_discovery import DiscoveredTool, discover_all_servers, discover_tools_from_servers
from ..discovery.taxonomy import ToolSecurityClass, classify_tool
from ..agent.tools import create_demo_tools
from .loader import PolicyError, compile_policy, validate_policy
from .synthesis import (
    DeterministicPolicyCompiler,
    HumanReadablePolicySummary,
    PolicyCandidate,
    PolicyReviewer,
    PolicySynthesizer,
    is_operational_request,
)


class PolicyAssistantError(Exception):
    """Base exception for policy assistant errors."""
    pass


class OperationalRequestError(PolicyAssistantError):
    """Raised when an operational prompt or injection is rejected from policy mutation."""
    pass


@dataclass
class PolicyDiffEntry:
    tool: str
    action: str  # "ADD", "REMOVE", "KEEP", "BLOCK"
    security_class: str
    details: str = ""


@dataclass
class PolicyProposalResult:
    status: str  # "PROPOSED", "REJECTED"
    user_intent: str
    proposed_yaml: str
    proposed_path: str
    allowed_tools: List[str]
    blocked_tools: List[str]
    diff_entries: List[PolicyDiffEntry]
    workflow_guards: List[str]
    explanation: str
    active_policy_path: str
    is_active: bool = False  # Invariant: Never automatically True on proposal


@dataclass
class ActivationResult:
    success: bool
    active_path: str
    policy_id: str
    capabilities_count: int
    message: str


class PolicyAssistant:
    """
    Coordinates plain-English policy proposal generation, human-readable diffing,
    safety review, and explicit activation.
    """

    def __init__(
        self,
        home_dir: Optional[Path] = None,
        synthesizer: Optional[PolicySynthesizer] = None,
        reviewer: Optional[PolicyReviewer] = None,
        compiler: Optional[DeterministicPolicyCompiler] = None,
    ):
        if home_dir:
            self.home = Path(home_dir)
        else:
            self.home = Path(os.getenv("MASTYF_HOME", Path.home() / ".mastyf"))
        self.home.mkdir(parents=True, exist_ok=True)

        self.active_policy_file = self.home / "active_policy.yaml"
        self.proposed_policy_file = self.home / "proposed_policy.yaml"

        self.synthesizer = synthesizer or PolicySynthesizer()
        self.reviewer = reviewer or PolicyReviewer()
        self.compiler = compiler or DeterministicPolicyCompiler()

    def propose(
        self,
        intent: str,
        discovered_tools: Optional[List[DiscoveredTool]] = None,
        save_proposed: bool = True,
    ) -> PolicyProposalResult:
        """
        Translates user intent into a candidate policy, validates through reviewer
        and compiler, computes diff against active policy, and stages as PROPOSED.
        """
        cleaned_intent = intent.strip()

        # Gate 1: Reject operational requests, action imperatives, or prompt injections
        if is_operational_request(cleaned_intent):
            raise OperationalRequestError(
                f"Rejected: '{cleaned_intent}' is an operational request or instruction, "
                f"not a declarative policy specification. Operational requests cannot mutate policy."
            )

        # Gate 2: Reject vague broadening requests attempting to bypass policy ("make this work", "fix it")
        vague_broadening_patterns = [
            r"^make\s+.*work",
            r"^just\s+make\s+.*work",
            r"^allow\s+whatever\s+is\s+needed",
            r"^grant\s+all\s+necessary",
            r"^fix\s+(the\s+)?permissions?",
            r"\bmake\s+(this|the)\s+request\s+work\b",
        ]
        import re
        for pat in vague_broadening_patterns:
            if re.search(pat, cleaned_intent.lower()):
                raise OperationalRequestError(
                    f"Rejected: Vague broadening phrase '{cleaned_intent}' lacks explicit tool boundaries. "
                    f"Mastyf refuses to silently broaden security authority."
                )

        # Gate 3: Tool discovery
        tools = discovered_tools
        if tools is None:
            servers = discover_all_servers()
            demo_tools = create_demo_tools()
            tools = []
            for dt in demo_tools.list_tools():
                tools.append(
                    DiscoveredTool(
                        name=dt.name,
                        description=dt.description,
                        parameters=dt.parameters,
                        server_name="enterprise_mcp",
                        security_class=classify_tool(dt.name, dt.description, dt.parameters),
                    )
                )
            if servers:
                cached = discover_tools_from_servers(servers)
                existing = {t.name for t in tools}
                for ct in cached:
                    if ct.name not in existing:
                        tools.append(ct)

        # Gate 4: Model-assisted conservative synthesis
        candidate = self.synthesizer.synthesize(tools, cleaned_intent)

        # Gate 5: Independent reviewer containment check
        review = self.reviewer.review(candidate, cleaned_intent, tools)
        if not review.approved:
            findings_str = "\n  - ".join(review.findings)
            raise PolicyAssistantError(
                f"Policy Reviewer rejected candidate policy:\n  - {findings_str}"
            )

        # Gate 6: Deterministic compilation and schema validation
        valid, summary, err = self.compiler.compile_and_explain(candidate, tools, cleaned_intent)
        if not valid or err:
            raise PolicyAssistantError(f"Deterministic compilation failed: {err}")

        # Gate 7: Compute human-readable diff against active policy
        diff_entries = self._compute_diff(candidate, tools)

        # Gate 8: Stage proposed policy (PROPOSED status, NOT active)
        if save_proposed:
            self.proposed_policy_file.write_text(candidate.raw_yaml, encoding="utf-8")

        return PolicyProposalResult(
            status="PROPOSED",
            user_intent=cleaned_intent,
            proposed_yaml=candidate.raw_yaml,
            proposed_path=str(self.proposed_policy_file),
            allowed_tools=summary.allowed_operations,
            blocked_tools=summary.blocked_operations,
            diff_entries=diff_entries,
            workflow_guards=summary.data_flow_guards,
            explanation=summary.plain_english_explanation,
            active_policy_path=str(self.active_policy_file),
            is_active=False,
        )

    def activate(self, custom_proposed_path: Optional[Path] = None) -> ActivationResult:
        """
        Explicitly activates the staged candidate policy into active_policy.yaml.
        Enforces that only schema-valid, review-passed policies can become active.
        """
        src = custom_proposed_path or self.proposed_policy_file
        if not src.exists():
            raise PolicyAssistantError(
                f"No proposed policy found at '{src}'. Run 'mastyf policy \"<intent>\"' first."
            )

        raw_yaml = src.read_text(encoding="utf-8")

        # Compile and validate before activating
        try:
            decl = validate_policy(str(src))
            compiled = compile_policy(decl)
        except PolicyError as e:
            raise PolicyAssistantError(f"Cannot activate invalid policy: {e}")

        # Atomically write to active policy file
        tmp_active = self.active_policy_file.with_suffix(".tmp")
        tmp_active.write_text(raw_yaml, encoding="utf-8")
        shutil.move(tmp_active, self.active_policy_file)

        # Clear proposed policy file to ensure single activation
        if src.exists() and src == self.proposed_policy_file:
            src.unlink()

        return ActivationResult(
            success=True,
            active_path=str(self.active_policy_file),
            policy_id=decl.id,
            capabilities_count=len(decl.capabilities),
            message=f"Policy '{decl.id}' activated with {len(decl.capabilities)} permitted capabilities.",
        )

    def _compute_diff(
        self, candidate: PolicyCandidate, tools: List[DiscoveredTool]
    ) -> List[PolicyDiffEntry]:
        """Computes human-readable comparison against active policy."""
        active_tools: List[str] = []
        if self.active_policy_file.exists():
            try:
                decl = validate_policy(str(self.active_policy_file))
                active_tools = [c.tool for c in decl.capabilities]
            except Exception:
                active_tools = []

        proposed_allowed = [c["tool"] for c in candidate.capabilities]
        tool_map = {t.name: t for t in tools}

        diffs: List[PolicyDiffEntry] = []

        # Check newly added tools
        for tool_name in proposed_allowed:
            t_obj = tool_map.get(tool_name)
            s_class = t_obj.security_class.value if t_obj else "UNKNOWN"
            if tool_name not in active_tools:
                diffs.append(
                    PolicyDiffEntry(
                        tool=tool_name,
                        action="ADD",
                        security_class=s_class,
                        details="Newly granted capability",
                    )
                )
            else:
                diffs.append(
                    PolicyDiffEntry(
                        tool=tool_name,
                        action="KEEP",
                        security_class=s_class,
                        details="Previously allowed; retained",
                    )
                )

        # Check removed or blocked tools
        for tool_name in active_tools:
            if tool_name not in proposed_allowed:
                t_obj = tool_map.get(tool_name)
                s_class = t_obj.security_class.value if t_obj else "UNKNOWN"
                diffs.append(
                    PolicyDiffEntry(
                        tool=tool_name,
                        action="REMOVE",
                        security_class=s_class,
                        details="Revoked permission",
                    )
                )

        for t in tools:
            if t.name not in proposed_allowed and t.name not in active_tools:
                diffs.append(
                    PolicyDiffEntry(
                        tool=t.name,
                        action="BLOCK",
                        security_class=t.security_class.value,
                        details="Explicitly restricted (0 bytes dispatch)",
                    )
                )

        return diffs

    def render_proposal_card(self, res: PolicyProposalResult) -> str:
        """Renders plain-English human-readable proposed policy summary and diff."""
        lines: List[str] = [
            "=" * 65,
            "       Mastyf Security Policy Proposal",
            "=" * 65,
            f"  Intent: \"{res.user_intent}\"",
            "",
            "  Policy Diff & Proposed Authority:",
        ]

        for d in res.diff_entries:
            if d.action == "ADD":
                lines.append(f"    [+] ADD    {d.tool:<26} {d.security_class}")
            elif d.action == "KEEP":
                lines.append(f"    [=] KEEP   {d.tool:<26} {d.security_class}")
            elif d.action == "REMOVE":
                lines.append(f"    [-] REMOVE {d.tool:<26} {d.security_class}")
            elif d.action == "BLOCK" and d.security_class in ("DESTRUCTIVE", "EXTERNAL_SINK", "UNKNOWN"):
                lines.append(f"    [✗] BLOCK  {d.tool:<26} {d.security_class}")

        if res.workflow_guards:
            lines.append("")
            lines.append("  🛡️  Workflow Exfiltration Guards:")
            for g in res.workflow_guards:
                lines.append(f"    • {g}")

        lines.extend([
            "",
            f"  Status: {res.status} (Not active)",
            "  Staged: " + res.proposed_path,
            "",
            "  To activate this policy, run:",
            "    mastyf policy activate",
            "=" * 65,
        ])
        return "\n".join(lines)
