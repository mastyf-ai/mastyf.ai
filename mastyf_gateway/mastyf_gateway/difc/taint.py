"""
Mastyf DIFC Security Labels, Lattice, and Flow Rules
"""

from typing import Set, Dict, List, Optional
from enum import Enum
from pydantic import BaseModel, Field

class SecurityTag(str, Enum):
    CLEAN = "SYSTEM_CLEAN"
    USER_PRIVATE = "USER_PRIVATE"
    UNTRUSTED_WEB = "UNTRUSTED_WEB"
    EXTERNAL_INJECTION_RISK = "EXTERNAL_INJECTION_RISK"
    FINANCIAL_SENSITIVE = "FINANCIAL_SENSITIVE"
    ADMIN_PRIVILEGED = "ADMIN_PRIVILEGED"

class SinkCategory(str, Enum):
    READ_SOURCE = "READ_SOURCE"
    INTERNAL_COMPUTE = "INTERNAL_COMPUTE"
    EXTERNAL_EXFILTRATION_SINK = "EXTERNAL_EXFILTRATION_SINK"
    SYSTEM_EXECUTION_SINK = "SYSTEM_EXECUTION_SINK"
    FINANCIAL_TRANSFER_SINK = "FINANCIAL_TRANSFER_SINK"
    PERSISTENT_STORAGE_SINK = "PERSISTENT_STORAGE_SINK"

class DIFCLattice:
    """Defines deterministic information flow constraints between taints and sinks."""

    # Sinks that reject untrusted/injection risk flows
    DISALLOWED_FLOWS: Dict[SinkCategory, Set[SecurityTag]] = {
        SinkCategory.EXTERNAL_EXFILTRATION_SINK: {
            SecurityTag.UNTRUSTED_WEB,
            SecurityTag.EXTERNAL_INJECTION_RISK,
            SecurityTag.USER_PRIVATE,
            SecurityTag.FINANCIAL_SENSITIVE
        },
        SinkCategory.SYSTEM_EXECUTION_SINK: {
            SecurityTag.UNTRUSTED_WEB,
            SecurityTag.EXTERNAL_INJECTION_RISK
        },
        SinkCategory.FINANCIAL_TRANSFER_SINK: {
            SecurityTag.UNTRUSTED_WEB,
            SecurityTag.EXTERNAL_INJECTION_RISK
        }
    }

    # Default tool category classifications
    DEFAULT_TOOL_SINKS: Dict[str, SinkCategory] = {
        "send_email": SinkCategory.EXTERNAL_EXFILTRATION_SINK,
        "slack_post_message": SinkCategory.EXTERNAL_EXFILTRATION_SINK,
        "http_post": SinkCategory.EXTERNAL_EXFILTRATION_SINK,
        "transfer_funds": SinkCategory.FINANCIAL_TRANSFER_SINK,
        "wire_money": SinkCategory.FINANCIAL_TRANSFER_SINK,
        "bash_exec": SinkCategory.SYSTEM_EXECUTION_SINK,
        "terminal_run": SinkCategory.SYSTEM_EXECUTION_SINK,
        "write_file": SinkCategory.PERSISTENT_STORAGE_SINK,
        "fetch_web_page": SinkCategory.READ_SOURCE,
        "read_email": SinkCategory.READ_SOURCE,
        "get_balance": SinkCategory.READ_SOURCE,
        "search_web": SinkCategory.READ_SOURCE,
    }

    # Source tools that contaminate session context with taint tags
    TOOL_PRODUCED_TAINTS: Dict[str, Set[SecurityTag]] = {
        "fetch_web_page": {SecurityTag.UNTRUSTED_WEB},
        "search_web": {SecurityTag.UNTRUSTED_WEB},
        "read_email": {SecurityTag.UNTRUSTED_WEB},
        "read_untrusted_input": {SecurityTag.EXTERNAL_INJECTION_RISK}
    }
