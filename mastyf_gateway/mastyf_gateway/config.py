"""
Mastyf Security Gateway Configuration
Central configuration for policy evaluation, DIFC tracking, neural auditing SLOs, and telemetry.
"""

from typing import Optional, Literal
from pydantic import BaseModel, Field
import os

class CBACConfig(BaseModel):
    enabled: bool = True
    policy_dir: str = Field(default_factory=lambda: os.getenv("MASTYF_POLICY_DIR", "policies"))
    strict_schema_validation: bool = True
    deny_unknown_tools: bool = True

class DIFCConfig(BaseModel):
    enabled: bool = True
    default_session_label: str = "SYSTEM_CLEAN"
    strict_untrusted_propagation: bool = True
    block_untrusted_sinks: bool = True

class AIAConfig(BaseModel):
    enabled: bool = True
    model_name_or_path: str = Field(
        default_factory=lambda: os.getenv("MASTYF_AIA_MODEL", "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened")
    )
    model_revision: str = "d59a6aa01f9139dff106146addb04109afa69c03"
    target_timeout_ms: float = 50.0  # Production SLO / target fast-path
    hard_timeout_ms: float = 800.0   # Hard deadline before triggering timeout fallback
    timeout_fallback_action: Literal["ESCALATE", "BLOCK"] = "ESCALATE"
    malformed_fallback_action: Literal["ESCALATE", "BLOCK"] = "ESCALATE"
    mock_mode: bool = False
    device: str = Field(default_factory=lambda: os.getenv("MASTYF_DEVICE", "cpu"))
    max_new_tokens: int = 128
    temperature: float = 0.0

class TelemetryConfig(BaseModel):
    enabled: bool = True
    audit_log_path: str = Field(default_factory=lambda: os.getenv("MASTYF_AUDIT_LOG", "logs/audit.jsonl"))
    mask_arguments: bool = True
    enable_prometheus: bool = True
    prometheus_port: int = 9090

class GatewayConfig(BaseModel):
    gateway_id: str = "mastyf-gateway-01"
    host: str = "0.0.0.0"
    port: int = 8000
    cbac: CBACConfig = Field(default_factory=CBACConfig)
    difc: DIFCConfig = Field(default_factory=DIFCConfig)
    aia: AIAConfig = Field(default_factory=AIAConfig)
    telemetry: TelemetryConfig = Field(default_factory=TelemetryConfig)
