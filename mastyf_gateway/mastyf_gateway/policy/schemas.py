"""
CBAC Policy Schemas and Capability Definitions
"""

from typing import Dict, Any, List, Optional, Union
from pydantic import BaseModel, Field
import re

class ArgumentConstraint(BaseModel):
    required: bool = False
    expected_type: Optional[str] = None  # "string", "int", "float", "bool", "list", "dict"
    allowed_values: Optional[List[Any]] = None
    pattern: Optional[str] = None  # Regex pattern
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    min_value: Optional[Union[int, float]] = None
    max_value: Optional[Union[int, float]] = None
    allowed_domains: Optional[List[str]] = None
    allowed_paths: Optional[List[str]] = None

    def validate_value(self, val: Any) -> tuple[bool, str]:
        if self.expected_type:
            type_map = {
                "string": str,
                "str": str,
                "int": int,
                "integer": int,
                "float": (int, float),
                "bool": bool,
                "boolean": bool,
                "list": list,
                "dict": dict
            }
            expected_py_type = type_map.get(self.expected_type.lower())
            if expected_py_type and not isinstance(val, expected_py_type):
                # Handle bool vs int distinction in Python
                if self.expected_type in ("int", "integer") and isinstance(val, bool):
                    return False, f"Expected integer, received bool"
                return False, f"Expected type {self.expected_type}, received {type(val).__name__}"

        if self.allowed_values is not None and val not in self.allowed_values:
            return False, f"Value '{val}' not in allowed values: {self.allowed_values}"

        if isinstance(val, str):
            if "\x00" in val:
                return False, "Null byte detected in string argument"
            if self.pattern and not re.match(self.pattern, val):
                return False, f"Value '{val}' does not match required regex pattern '{self.pattern}'"
            if self.min_length is not None and len(val) < self.min_length:
                return False, f"Length {len(val)} below min_length {self.min_length}"
            if self.max_length is not None and len(val) > self.max_length:
                return False, f"Length {len(val)} exceeds max_length {self.max_length}"
            if self.allowed_domains:
                # Check if URL domain matches allowed domains
                for dom in self.allowed_domains:
                    if dom in val:
                        break
                else:
                    return False, f"String '{val}' does not match allowed domains {self.allowed_domains}"

        if isinstance(val, (int, float)) and not isinstance(val, bool):
            if self.min_value is not None and val < self.min_value:
                return False, f"Value {val} below minimum {self.min_value}"
            if self.max_value is not None and val > self.max_value:
                return False, f"Value {val} exceeds maximum {self.max_value}"

        return True, "OK"

class ToolArgumentSchema(BaseModel):
    arguments: Dict[str, ArgumentConstraint] = Field(default_factory=dict)
    allow_extra_arguments: bool = False

class CapabilityDefinition(BaseModel):
    capability_name: str
    tool_name: str
    description: str = ""
    allowed_principals: List[str] = Field(default_factory=lambda: ["*"])
    argument_constraints: Dict[str, ArgumentConstraint] = Field(default_factory=dict)
    deny_patterns: Dict[str, List[str]] = Field(default_factory=dict)  # Arg -> list of disallowed regex patterns

class PolicyDocument(BaseModel):
    policy_id: str
    version: str = "1.0"
    description: str = ""
    capabilities: List[CapabilityDefinition] = Field(default_factory=list)
