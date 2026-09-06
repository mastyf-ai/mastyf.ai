"""
Mastyf Model-Assisted Policy Synthesis, Review, and Compilation Engine.
Translates plain-language user requirements and discovered MCP tools into
structurally validated declarative policies.
Enforces:
1. LLM Policy Proposal != Authority
2. A_effective <= A_compiled_policy
3. Operational requests cannot mutate policy.
4. Prompt-injected tool outputs cannot mutate policy.
"""

from __future__ import annotations

import re
import yaml
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from ..discovery.taxonomy import ToolSecurityClass
from ..discovery.mcp_discovery import DiscoveredTool
from .loader import compile_policy, validate_policy, PolicyError


# Operational request indicators vs Policy configuration indicators
POLICY_INDICATOR_PATTERNS = [
    r"\b(can|allowed|permit|permission|policy|authorized|rules?|never allow|must not|prohibit|restrict)\b",
    r"\b(agent should be able to|agent can|you can read|you can update|never delete|never send)\b",
]

OPERATIONAL_PATTERNS = [
    r"^(find|search|lookup|get|fetch|send|post|create|delete|update|wipe|check|run|do|make)\b",
    r"\b(unpaid invoices?|this customer|to slack|an email to|the database|this request)\b",
]

# Prompt injection signatures attempting to rewrite policy
PROMPT_INJECTION_POLICY_PATTERNS = [
    r"ignor\w*\s+previous\s+instructions",
    r"update\s+(the\s+)?(security\s+)?policy",
    r"change\s+(the\s+)?(security\s+)?policy",
    r"system\s+override",
    r"new\s+instruction",
    r"grant\s+all\s+permissions",
    r"allow\s+all\s+tools",
]


def is_operational_request(text: str) -> bool:
    """
    Distinguishes operational requests ('Send this report to Bob') from
    policy configuration statements ('The agent may read X but never send Y').
    """
    cleaned = text.strip().lower()

    # Check for prompt injection policy overrides
    for pat in PROMPT_INJECTION_POLICY_PATTERNS:
        if re.search(pat, cleaned):
            # Attempted prompt injection override must NOT be treated as a policy request
            return True

    # If it starts with an imperative action verb and lacks policy boundary language
    has_policy_words = any(re.search(pat, cleaned) for pat in POLICY_INDICATOR_PATTERNS)
    has_operational_words = any(re.search(pat, cleaned) for pat in OPERATIONAL_PATTERNS)

    if has_operational_words and not has_policy_words:
        return True
    return False


@dataclass
class PolicyCandidate:
    """Proposed candidate policy output by the Policy Synthesizer."""
    policy_id: str
    version: str
    description: str
    capabilities: List[Dict[str, Any]]
    workflows: List[Dict[str, Any]]
    raw_yaml: str


@dataclass
class ReviewResult:
    """Outcome of independent policy review audit."""
    approved: bool
    findings: List[str]
    warnings: List[str]


@dataclass
class HumanReadablePolicySummary:
    """User-facing plain-English breakdown of what a policy permits and protects."""
    allowed_operations: List[str]
    blocked_operations: List[str]
    data_flow_guards: List[str]
    plain_english_explanation: str
    candidate_yaml: str


class PolicySynthesizer:
    """
    Translates discovered MCP tools and user intent into a candidate declarative policy.
    Uses conservative synthesis: permissions are only granted when explicitly supported
    by user intent, and sensitive sources are automatically paired with exfiltration blocks.
    """

    def synthesize(
        self,
        discovered_tools: List[DiscoveredTool],
        user_intent: str,
        policy_id: str = "synthesized-agent-policy",
    ) -> PolicyCandidate:
        intent_lower = user_intent.lower()

        capabilities: List[Dict[str, Any]] = []
        workflows: List[Dict[str, Any]] = []

        # Helper to check if a term or tool is explicitly negated in user intent
        def _is_negated(term: str) -> bool:
            patterns = [
                rf"\b(never|don't|do not|cannot|can't|no|prevent|block|stop|without)\b[^.?!;]*\b{term}\b",
                rf"\b{term}\b[^.?!;]*\b(is blocked|forbidden|prohibited|not allowed|disabled)\b",
            ]
            return any(re.search(p, intent_lower) for p in patterns)

        # Parse user intent boundaries
        allow_delete = "delete" in intent_lower and not _is_negated("delete")
        prevent_exfil = _is_negated("send") or _is_negated("exfil") or "outside" in intent_lower or "external" in intent_lower or "never send" in intent_lower

        sensitive_tools: List[str] = []
        external_sinks: List[str] = []

        for tool in discovered_tools:
            name = tool.name
            t_class = tool.security_class

            # 1. DESTRUCTIVE: Only permitted if explicitly requested without negation
            if t_class == ToolSecurityClass.DESTRUCTIVE:
                if allow_delete:
                    capabilities.append({"tool": name, "actions": ["admin"]})
                # If deletion forbidden or unmentioned, DO NOT add capability (defaults to BLOCK)

            # 2. SENSITIVE SOURCE: Permitted for reading, but tracked
            elif t_class == ToolSecurityClass.SENSITIVE_SOURCE:
                capabilities.append({"tool": name, "actions": ["read"]})
                sensitive_tools.append(name)

            # 3. EXTERNAL SINK: Strictly opt-in; tracked for workflow exfiltration constraint
            elif t_class == ToolSecurityClass.EXTERNAL_SINK:
                tool_stem = name.split(".")[-1]
                tool_ns = name.split(".")[0]
                negated = _is_negated(name) or _is_negated(tool_stem) or _is_negated(tool_ns) or prevent_exfil
                
                # Sinks must be explicitly requested and NOT negated
                if not negated:
                    if "slack" in name and "slack" in intent_lower and not _is_negated("slack"):
                        capabilities.append({"tool": name, "actions": ["write"]})
                        external_sinks.append(name)
                    elif "http" in name and "http" in intent_lower and not _is_negated("http"):
                        capabilities.append({"tool": name, "actions": ["write"]})
                        external_sinks.append(name)
                    elif "email" in name and "email" in intent_lower and not _is_negated("email"):
                        capabilities.append({"tool": name, "actions": ["write"]})
                        external_sinks.append(name)
                # Unapproved or negated external sinks receive 0 capabilities (default BLOCK)

            # 4. READ / WRITE: Standard business operations (blocked if explicitly negated)
            elif t_class in (ToolSecurityClass.READ, ToolSecurityClass.WRITE):
                tool_stem = name.split(".")[-1]
                tool_ns = name.split(".")[0]
                negated = _is_negated(name) or _is_negated(tool_stem) or _is_negated(tool_ns)
                if not negated:
                    capabilities.append({"tool": name, "actions": ["read" if t_class == ToolSecurityClass.READ else "write"]})

            # 5. UNKNOWN: NEVER SILENTLY ALLOWED (Omitted from capabilities -> Fails closed)
            elif t_class == ToolSecurityClass.UNKNOWN:
                pass

        # Build workflow sequence protection if sensitive sources and sinks co-exist
        all_discovered_sinks = [t.name for t in discovered_tools if t.security_class == ToolSecurityClass.EXTERNAL_SINK]
        if sensitive_tools and all_discovered_sinks and prevent_exfil:
            transitions = []
            for st in sensitive_tools:
                transitions.append({"from": "CLEAN", "on": st, "to": "SENSITIVE_DATA_LOADED"})

            deny_sinks = sorted(list(set(external_sinks + all_discovered_sinks)))
            workflows.append({
                "name": "prevent-sensitive-exfiltration",
                "scope": "session",
                "initial_state": "CLEAN",
                "states": ["CLEAN", "SENSITIVE_DATA_LOADED"],
                "transitions": transitions,
                "constraints": [
                    {
                        "when_state": "SENSITIVE_DATA_LOADED",
                        "deny": deny_sinks,
                        "reason": "EXFILTRATION_PREVENTION: Sensitive data cannot flow to external sinks",
                    }
                ],
            })

        policy_dict: Dict[str, Any] = {
            "id": policy_id,
            "version": "1.0",
            "description": f"Synthesized for: {user_intent}",
            "capabilities": capabilities,
        }
        if workflows:
            policy_dict["workflows"] = workflows

        raw_yaml = yaml.dump(policy_dict, sort_keys=False)

        return PolicyCandidate(
            policy_id=policy_id,
            version="1.0",
            description=f"Synthesized for: {user_intent}",
            capabilities=capabilities,
            workflows=workflows,
            raw_yaml=raw_yaml,
        )


class PolicyReviewer:
    """
    Audits candidate policies independently before compiler invocation.
    Detects privilege expansion, wildcards, or contradictory permissions.
    """

    def review(
        self,
        candidate: PolicyCandidate,
        user_intent: str,
        discovered_tools: List[DiscoveredTool],
    ) -> ReviewResult:
        findings: List[str] = []
        warnings: List[str] = []
        intent_lower = user_intent.lower()

        # Rule 1: No wildcards
        for cap in candidate.capabilities:
            if cap.get("tool") in ("*", ".*"):
                findings.append("CRITICAL: Wildcard tool permission '*' is strictly prohibited.")

        # Rule 2: Check forbidden destructive operations
        forbids_delete = "never delete" in intent_lower or "cannot delete" in intent_lower or "can't delete" in intent_lower
        if forbids_delete:
            for cap in candidate.capabilities:
                t_name = cap.get("tool", "")
                matching_tools = [t for t in discovered_tools if t.name == t_name]
                if matching_tools and matching_tools[0].security_class == ToolSecurityClass.DESTRUCTIVE:
                    findings.append(f"VIOLATION: Destructive tool '{t_name}' is granted authority despite user forbidding deletion.")

        # Rule 3: Check UNKNOWN tool containment
        for cap in candidate.capabilities:
            t_name = cap.get("tool", "")
            matching_tools = [t for t in discovered_tools if t.name == t_name]
            if matching_tools and matching_tools[0].security_class == ToolSecurityClass.UNKNOWN:
                findings.append(f"VIOLATION: Unclassified tool '{t_name}' cannot be granted default authority.")

        # Rule 4: Exfiltration containment
        forbids_exfil = "never send" in intent_lower or "outside" in intent_lower
        if forbids_exfil:
            # Must have workflow exfiltration barrier if sensitive tools are present
            has_sensitive = any(t.security_class == ToolSecurityClass.SENSITIVE_SOURCE for t in discovered_tools)
            has_sinks = any(t.security_class == ToolSecurityClass.EXTERNAL_SINK for t in discovered_tools)
            if has_sensitive and has_sinks and not candidate.workflows:
                findings.append("VIOLATION: Missing workflow exfiltration barrier between sensitive tools and external sinks.")

        approved = len(findings) == 0
        return ReviewResult(approved=approved, findings=findings, warnings=warnings)


class DeterministicPolicyCompiler:
    """
    Compiles candidate policy through Mastyf's formal schema and produces
    human-readable explanations for user confirmation.
    """

    def compile_and_explain(
        self,
        candidate: PolicyCandidate,
        discovered_tools: List[DiscoveredTool],
        user_intent: str,
    ) -> Tuple[bool, HumanReadablePolicySummary, Optional[str]]:
        import tempfile

        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as tmp:
            tmp.write(candidate.raw_yaml)
            tmp_path = tmp.name

        try:
            decl = validate_policy(tmp_path)
            compile_policy(decl)
        except PolicyError as e:
            return False, HumanReadablePolicySummary([], [], [], "", candidate.raw_yaml), f"Compiler Error: {e}"

        # Generate Human-Readable Summary
        allowed_tools = [cap["tool"] for cap in candidate.capabilities]
        blocked_tools = [t.name for t in discovered_tools if t.name not in allowed_tools]

        guards: List[str] = []
        for wf in candidate.workflows:
            for c in wf.get("constraints", []):
                denied = ", ".join(c.get("deny", []))
                guards.append(f"After {c.get('when_state')}: {denied} BLOCKED ({c.get('reason')})")

        explanation = (
            f"Policy synthesized from your stated requirements: '{user_intent}'.\n"
            f"Permits {len(allowed_tools)} safe tools and blocks {len(blocked_tools)} tools.\n"
            f"Deterministic workflow guards active: {len(guards)}."
        )

        summary = HumanReadablePolicySummary(
            allowed_operations=allowed_tools,
            blocked_operations=blocked_tools,
            data_flow_guards=guards,
            plain_english_explanation=explanation,
            candidate_yaml=candidate.raw_yaml,
        )

        return True, summary, None
