"""
Policy engine — faithful Python port of PolicyEngine.evaluate() sync pipeline.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Literal, Optional

import yaml

from .normalizer import PayloadNormalizer
from .prompt_injection import scan_tool_call_arguments
from .semantic_guards import evaluate_semantic_guards
from .shell_tokenizer import ShellTokenizer
from .tool_chain import evaluate_tool_chain_guard
from .types import AgentIdentity, CallContext, PolicyAction, PolicyDecision, PolicyMode

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_POLICY = REPO_ROOT / "default-policy.yaml"

SyncMode = Literal["full", "yaml_only"]


def _identity_from_dict(raw: dict[str, Any] | None) -> AgentIdentity | None:
    if not raw:
        return None
    return AgentIdentity(
        sub=str(raw.get("sub", "unknown")),
        issuer=str(raw.get("issuer", "harness")),
        client_id=raw.get("clientId") or raw.get("client_id"),
        scopes=raw.get("scopes"),
        tenant_id=raw.get("tenantId") or raw.get("tenant_id"),
    )


def context_from_dict(data: dict[str, Any], defaults: dict[str, Any] | None = None) -> CallContext:
    d = {**(defaults or {}), **data}
    return CallContext(
        server_name=str(d.get("serverName", d.get("server_name", "harness"))),
        tool_name=str(d.get("toolName", d.get("tool_name", "search"))),
        arguments=dict(d.get("arguments") or {}),
        request_id=str(d.get("requestId", d.get("request_id", "harness-1"))),
        request_tokens=int(d.get("requestTokens", d.get("request_tokens", 50))),
        timestamp=str(d.get("timestamp", "")),
        session_id=d.get("sessionId", d.get("session_id")),
        tenant_id=d.get("tenantId", d.get("tenant_id")),
        agent_identity=_identity_from_dict(d.get("agentIdentity") or d.get("agent_identity")),
    )


class PolicyEngine:
    def __init__(self, config: dict[str, Any]):
        self.config = config
        policy = config.get("policy", config)
        self.mode: PolicyMode = policy.get("mode", "block")
        self.rules: list[dict[str, Any]] = policy.get("rules", [])
        self.default_action: PolicyAction = policy.get("default_action", "pass")
        self.semantic_shell: bool = policy.get("semantic_shell", True) is not False
        self.unicode_strict: bool = policy.get("unicode_strict", True) is not False
        self.normalizer = PayloadNormalizer(self.unicode_strict)
        self.shell = ShellTokenizer()
        self._compiled_patterns: dict[str, list[re.Pattern[str]]] = {}
        self._compiled_arg: dict[str, list[tuple[str, list[re.Pattern[str]]]]] = {}
        self._call_counters: dict[str, tuple[int, float]] = {}
        self._compile_patterns()

    @classmethod
    def from_default_policy(cls) -> "PolicyEngine":
        if not DEFAULT_POLICY.is_file():
            raise FileNotFoundError(f"default-policy.yaml not found at {DEFAULT_POLICY}")
        data = yaml.safe_load(DEFAULT_POLICY.read_text(encoding="utf-8"))
        return cls(data)

    @classmethod
    def from_policy_dict(cls, policy_dict: dict[str, Any]) -> "PolicyEngine":
        return cls({"version": "1.0", "policy": policy_dict})

    @staticmethod
    def _regex_from_policy_pattern(p: str) -> str:
        if "\\\\" in p:
            p = p.replace("\\\\", "\\")
        return p

    def _compile_patterns(self) -> None:
        for rule in self.rules:
            name = rule.get("name", "")
            for p in rule.get("patterns") or []:
                try:
                    self._compiled_patterns.setdefault(name, []).append(
                        re.compile(self._regex_from_policy_pattern(p), re.I),
                    )
                except re.error:
                    pass
            for ap in rule.get("argPatterns") or []:
                field = ap.get("field", "*")
                compiled = []
                for p in ap.get("patterns") or []:
                    try:
                        compiled.append(re.compile(self._regex_from_policy_pattern(p), re.I))
                    except re.error:
                        pass
                if compiled:
                    self._compiled_arg.setdefault(name, []).append((field, compiled))

    def _resolve_action(self, action: PolicyAction) -> PolicyAction:
        if self.mode == "audit":
            return "pass"
        if self.mode == "warn" and action == "block":
            return "flag"
        return action

    def _walk_leaves(self, obj: Any) -> list[str]:
        from .arg_walker import walk_string_leaves

        return [leaf.value for leaf in walk_string_leaves(obj)]

    def _scope_match(self, required: str, agent_scopes: list[str]) -> bool:
        req = required.lower()
        return any(s.lower() == req for s in agent_scopes)

    def _client_id_match(self, pattern: str, client_id: str) -> bool:
        try:
            return bool(re.search(pattern, client_id))
        except re.error:
            return pattern == client_id

    def _evaluate_rbac(self, rule: dict[str, Any], ctx: CallContext) -> Optional[PolicyDecision]:
        rbac = rule.get("rbac")
        if not rbac:
            return None
        name = rule.get("name", "")
        action = self._resolve_action(rule.get("action", "block"))
        identity = ctx.agent_identity
        if not identity:
            return PolicyDecision(
                action,
                name,
                f"RBAC rule '{name}' requires agent identity but none provided",
            )
        scopes = rbac.get("scopes") or []
        if scopes:
            agent_scopes = identity.scopes or []
            if not any(self._scope_match(s, agent_scopes) for s in scopes):
                return PolicyDecision(
                    action,
                    name,
                    f"Agent '{identity.sub}' missing required scope. Need one of: [{', '.join(scopes)}], "
                    f"have: [{', '.join(agent_scopes) or 'none'}]",
                )
        client_patterns = rbac.get("clientIds") or []
        if client_patterns:
            cid = identity.client_id or ""
            if not any(self._client_id_match(p, cid) for p in client_patterns):
                return PolicyDecision(
                    action,
                    name,
                    f"Client ID '{cid}' not allowed. Allowed patterns: [{', '.join(client_patterns)}]",
                )
        tenants = rbac.get("tenants") or []
        if tenants:
            tenant = ctx.tenant_id or os.environ.get("GUARDIAN_TENANT_ID", "default")
            if tenant not in tenants:
                return PolicyDecision(
                    action,
                    name,
                    f"Tenant '{tenant}' not allowed for rule '{name}'. Allowed: [{', '.join(tenants)}]",
                )
        return None

    def _evaluate_rule(
        self,
        rule: dict[str, Any],
        ctx: CallContext,
        args_str: str,
        skip_rate: bool = False,
    ) -> Optional[PolicyDecision]:
        name = rule.get("name", "")
        action = self._resolve_action(rule.get("action", "block"))

        tools = rule.get("tools") or {}
        allow = tools.get("allow") or []
        if allow:
            if ctx.tool_name not in allow:
                if tools.get("enforceAllowlist"):
                    return PolicyDecision(
                        action,
                        name,
                        f"Tool '{ctx.tool_name}' not in allowlist",
                    )
                return None
        if tools.get("deny") and ctx.tool_name in tools["deny"]:
            return PolicyDecision(action, name, f"Tool '{ctx.tool_name}' is explicitly denied")

        cats = (rule.get("toolCategories") or {}).get("deny") or []
        exceptions = rule.get("toolAllowExceptions") or []
        tool_lower = ctx.tool_name.lower()
        if any(cat.lower() in tool_lower for cat in cats) and ctx.tool_name not in exceptions:
            return PolicyDecision(
                action,
                name,
                f"Tool '{ctx.tool_name}' matches destructive category",
            )

        rbac_dec = self._evaluate_rbac(rule, ctx)
        if rbac_dec:
            return rbac_dec

        for field, patterns in self._compiled_arg.get(name, []):
            values = (
                self._walk_leaves(ctx.arguments)
                if field == "*"
                else self._walk_leaves(ctx.arguments.get(field))
                if ctx.arguments.get(field) is not None
                else []
            )
            for val in values:
                for pat in patterns:
                    if pat.search(val):
                        return PolicyDecision(
                            action,
                            name,
                            f"Argument field '{field}' matches blocked pattern",
                        )

        for pat in self._compiled_patterns.get(name, []):
            if pat.search(args_str):
                return PolicyDecision(action, name, "Argument pattern matched (normalized)")

        max_tokens = rule.get("maxTokens")
        if max_tokens and ctx.request_tokens > max_tokens:
            return PolicyDecision(
                action,
                name,
                f"Token count {ctx.request_tokens} exceeds max {max_tokens}",
            )

        max_cpm = rule.get("maxCallsPerMinute")
        if max_cpm and not skip_rate:
            tenant = ctx.tenant_id or os.environ.get("GUARDIAN_TENANT_ID", "default")
            client_id = (ctx.agent_identity.client_id if ctx.agent_identity else None) or (
                ctx.agent_identity.sub if ctx.agent_identity else None
            )
            key = (
                f"{tenant}:{ctx.server_name}:{ctx.tool_name}:{client_id}"
                if client_id
                else f"{tenant}:{ctx.server_name}:{ctx.tool_name}"
            )
            now = time.time()
            count, reset = self._call_counters.get(key, (0, now + 60))
            if now > reset:
                count, reset = 1, now + 60
            else:
                count += 1
            self._call_counters[key] = (count, reset)
            if count > max_cpm:
                return PolicyDecision(
                    action,
                    name,
                    f"Rate limit exceeded: {count}/{max_cpm}",
                )

        return None

    def _evaluate_semantic_shell(self, args_str: str) -> Optional[PolicyDecision]:
        if not self.semantic_shell or not args_str:
            return None
        ps = self.shell.detect_powershell_risk(args_str)
        if ps:
            return PolicyDecision("block", "semantic-shell-guard", ps)
        b64 = self.shell.detect_base64_pipe_shell(args_str)
        if b64:
            return PolicyDecision("block", "semantic-shell-guard", b64)
        sub = self.shell.detect_sensitive_command_substitution(args_str)
        if sub:
            return PolicyDecision("block", "semantic-shell-guard", sub)
        risk = self.shell.analyze_risk(args_str)
        if risk.has_command_substitution:
            return PolicyDecision(
                "block",
                "semantic-shell-guard",
                "Semantic: shell command substitution detected in arguments",
            )
        if risk.dangerous_commands:
            return PolicyDecision(
                "block",
                "semantic-shell-guard",
                f"Semantic: dangerous shell commands: [{', '.join(risk.dangerous_commands)}]",
            )
        return None

    def reset_rate_counters(self) -> None:
        self._call_counters.clear()

    def evaluate(
        self,
        ctx: CallContext,
        skip_local_rate_limit: bool = False,
        sync_mode: SyncMode = "full",
    ) -> PolicyDecision:
        norm_args = (
            self.normalizer.normalize_json_value(ctx.arguments or {})
            if ctx.arguments
            else {}
        )
        norm_ctx = CallContext(
            server_name=ctx.server_name,
            tool_name=ctx.tool_name,
            arguments=norm_args,
            request_id=ctx.request_id,
            request_tokens=ctx.request_tokens,
            timestamp=ctx.timestamp,
            session_id=ctx.session_id,
            tenant_id=ctx.tenant_id,
            agent_identity=ctx.agent_identity,
        )
        args_str = json.dumps(norm_args, ensure_ascii=False)

        if sync_mode == "full":
            findings = scan_tool_call_arguments(norm_args)
            if findings:
                rank = {"critical": 0, "high": 1, "medium": 2}
                top = min(findings, key=lambda f: rank.get(f.severity, 9))
                return PolicyDecision(
                    self._resolve_action("block"),
                    "request-prompt-injection",
                    f"Prompt injection: {top.pattern_id} ({top.severity})",
                )

            shell_dec = self._evaluate_semantic_shell(args_str)
            if shell_dec:
                return shell_dec

            chain = evaluate_tool_chain_guard(norm_ctx)
            if chain:
                return PolicyDecision(
                    self._resolve_action(chain.action),
                    chain.rule,
                    chain.reason,
                )

            sem = evaluate_semantic_guards(norm_ctx)
            if sem:
                return PolicyDecision(self._resolve_action(sem.action), sem.rule, sem.reason)

        permitted = False
        for rule in self.rules:
            if (rule.get("tools") or {}).get("allow") and norm_ctx.tool_name in rule["tools"]["allow"]:
                permitted = True
            dec = self._evaluate_rule(rule, norm_ctx, args_str, skip_local_rate_limit)
            if dec:
                return dec

        if permitted:
            return PolicyDecision("pass", "allowlist", f"Tool '{norm_ctx.tool_name}' allowlisted")

        return PolicyDecision(
            self._resolve_action(self.default_action),
            "default",
            f"default_action: {self.default_action}",
        )
