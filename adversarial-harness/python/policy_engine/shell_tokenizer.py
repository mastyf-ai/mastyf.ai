"""Shell tokenizer — simplified mirror of shell-tokenizer.ts risk analysis."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

SPELLED_THREAT_WORDS = frozenset(
    {
        "ignore",
        "disregard",
        "union",
        "select",
        "delete",
        "drop",
        "override",
        "bypass",
        "eval",
        "exec",
    }
)

DANGEROUS_COMMANDS = frozenset(
    {
        "rm",
        "dd",
        "mkfs",
        "chmod",
        "chown",
        "nc",
        "curl",
        "wget",
        "eval",
        "exec",
        "source",
        "bash",
        "sh",
        "zsh",
        "python",
        "perl",
        "ruby",
        "node",
        "php",
        "ssh",
        "kill",
        "base64",
        "iex",
    }
)

BASE64_PIPE_SHELL = [
    re.compile(r"\bbase64\s+(?:-d|--decode)\b.+\|\s*(?:sh|bash|zsh)\b", re.I),
    re.compile(r"\|\s*base64\s+(?:-d|--decode)\b.+\|\s*(?:sh|bash|zsh)\b", re.I),
]

POWERSHELL_DANGEROUS = [
    re.compile(r"\binvoke-expression\b", re.I),
    re.compile(r"\biex\b", re.I),
    re.compile(r"-encodedcommand\b", re.I),
    re.compile(r"-enc\b", re.I),
]

CMD_SUB_RE = re.compile(r"\$\([^)]+\)")
BACKTICK_RE = re.compile(r"`[^`]+`")
SENSITIVE_SUB_RE = re.compile(
    r"\$\([^)]*(?:cat|head|tail|less|strings).*(?:passwd|\.ssh|id_rsa|\.env|credentials)",
    re.I,
)


@dataclass
class CommandRisk:
    has_command_substitution: bool = False
    has_pipes: bool = False
    has_redirects: bool = False
    has_logical_chains: bool = False
    dangerous_commands: list[str] = field(default_factory=list)
    shell_metacharacters: list[str] = field(default_factory=list)


class ShellTokenizer:
    def tokenize_words(self, input_str: str) -> list[str]:
        return re.findall(r"[a-zA-Z0-9_./-]+", input_str)

    def analyze_risk(self, input_str: str) -> CommandRisk:
        risk = CommandRisk()
        if CMD_SUB_RE.search(input_str) or BACKTICK_RE.search(input_str):
            risk.has_command_substitution = True
        if "|" in input_str:
            risk.has_pipes = True
        if re.search(r"[<>]", input_str):
            risk.has_redirects = True
        if "&&" in input_str or "||" in input_str:
            risk.has_logical_chains = True
        for w in self.tokenize_words(input_str):
            low = w.lower()
            if low in DANGEROUS_COMMANDS and low not in risk.dangerous_commands:
                risk.dangerous_commands.append(low)
        return risk

    def detect_powershell_risk(self, input_str: str) -> str | None:
        for p in POWERSHELL_DANGEROUS:
            if p.search(input_str):
                return f"PowerShell dangerous pattern detected: {p.pattern}"
        return None

    def detect_base64_pipe_shell(self, input_str: str) -> str | None:
        for p in BASE64_PIPE_SHELL:
            if p.search(input_str):
                return "Base64 decode piped to shell detected"
        return None

    def detect_sensitive_command_substitution(self, input_str: str) -> str | None:
        if SENSITIVE_SUB_RE.search(input_str):
            return "Sensitive command substitution detected"
        return None

    def detect_whitespace_obfuscated_shell(self, input_str: str) -> str | None:
        """ADV-006: inter-letter whitespace obfuscation (e.g. `b a s h -c id`)."""
        for match in re.finditer(r"(?:[a-zA-Z]\s+){3,}[a-zA-Z](?=\s|$|[^a-zA-Z])", input_str):
            spelled = re.sub(r"\s+", "", match.group(0)).lower()
            if spelled in DANGEROUS_COMMANDS or spelled in SPELLED_THREAT_WORDS:
                return f"Whitespace-obfuscated token detected: {spelled}"
        compact = re.sub(r"\s+", "", input_str)
        # Word boundaries match Node ShellTokenizer.detectWhitespaceObfuscatedShell
        # (avoids FP on identifiers like base64_encoded_shell_cmd).
        if (
            re.search(r"\brm-?rf\b", compact, re.I)
            or re.search(r"\bbase64\b", compact, re.I)
            or re.search(r"\bsh-c\b", compact, re.I)
            or re.search(r"\bnc-?e\b", compact, re.I)
        ):
            return "Whitespace-obfuscated destructive shell pattern detected"
        return None

    def detect_netcat_reverse_shell(self, input_str: str) -> str | None:
        if re.search(r"\b(?:nc|ncat|netcat)\b[^\n]{0,80}\s+-e\b", input_str, re.I):
            return "Netcat reverse/bind shell (-e) detected in arguments"
        if re.search(
            r"\b(?:nc|ncat|netcat)\b[^\n]{0,40}\s+-e\s+\/bin\/(?:ba)?sh\b",
            input_str,
            re.I,
        ):
            return "Netcat reverse shell to /bin/sh detected in arguments"
        return None
