"""
Mastyf Tool Taxonomy & Classification Engine.
Assigns explicit security classes to discovered tools and ensures UNKNOWN defaults to non-execution.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Dict, List, Optional


class ToolSecurityClass(str, Enum):
    READ = "READ"
    WRITE = "WRITE"
    DESTRUCTIVE = "DESTRUCTIVE"
    SENSITIVE_SOURCE = "SENSITIVE_SOURCE"
    EXTERNAL_SINK = "EXTERNAL_SINK"
    UNKNOWN = "UNKNOWN"


# Canonical term patterns for deterministic baseline classification
DESTRUCTIVE_PATTERNS = [
    r"(delete|drop|remove|destroy|wipe|truncate|terminate|kill|purge)",
]

SENSITIVE_SOURCE_PATTERNS = [
    r"(customer|client|patient|user_record|account|balance|ssn|secret|credential|password|token|invoice|payroll|tax|pii)",
]

EXTERNAL_SINK_PATTERNS = [
    r"(slack|discord|email|smtp|mail|webhook|http|post_message|external_request|upload|export_remote|exfil)",
]

WRITE_PATTERNS = [
    r"(create|update|insert|modify|edit|patch|write|append|set)",
]

READ_PATTERNS = [
    r"(get|list|search|find|read|query|fetch|lookup|inspect|describe|show|view)",
]


def classify_tool(
    name: str, description: str = "", schema: Optional[Dict[str, Any]] = None
) -> ToolSecurityClass:
    """
    Classifies a tool signature into an explicit security class.
    Evaluation order prioritizes security containment:
    DESTRUCTIVE > SENSITIVE_SOURCE > EXTERNAL_SINK > WRITE > READ > UNKNOWN.
    """
    target = f"{name} {description}".lower()

    # 1. Destructive check
    for pat in DESTRUCTIVE_PATTERNS:
        if re.search(pat, target):
            return ToolSecurityClass.DESTRUCTIVE

    # 2. Sensitive source check (produces confidential data)
    for pat in SENSITIVE_SOURCE_PATTERNS:
        if re.search(pat, target):
            return ToolSecurityClass.SENSITIVE_SOURCE

    # 3. External sink check (exfiltrates data across network boundaries)
    for pat in EXTERNAL_SINK_PATTERNS:
        if re.search(pat, target):
            return ToolSecurityClass.EXTERNAL_SINK

    # 4. Mutating write operations
    for pat in WRITE_PATTERNS:
        if re.search(pat, target):
            return ToolSecurityClass.WRITE

    # 5. Idempotent read operations
    for pat in READ_PATTERNS:
        if re.search(pat, target):
            return ToolSecurityClass.READ

    # 6. Fallback: Strict UNKNOWN (Default to non-execution)
    return ToolSecurityClass.UNKNOWN
