"""
Mastyf Operational and Security Metrics Collector
Tracks latency distributions, throughput, decision rates, and failure modes.
"""

from typing import Dict, List, Any
import numpy as np
import time

class GatewayMetrics:
    """Collects real-time performance and security telemetry."""

    def __init__(self):
        self.total_requests = 0
        self.decisions_count: Dict[str, int] = {"ALLOW": 0, "BLOCK": 0, "ESCALATE": 0}
        self.cbac_blocks = 0
        self.difc_blocks = 0
        self.aia_evaluations = 0
        self.aia_blocks = 0
        self.aia_escalations = 0
        self.aia_timeouts = 0
        self.aia_malformed = 0
        self.fast_path_hits = 0

        # Latency lists (ms)
        self.total_latencies: List[float] = []
        self.cbac_latencies: List[float] = []
        self.difc_latencies: List[float] = []
        self.aia_latencies: List[float] = []

    def record_decision(
        self,
        final_decision: str,
        cbac_allowed: bool,
        difc_allowed: bool,
        aia_evaluated: bool,
        aia_decision: str | None,
        total_latency_ms: float,
        cbac_latency_ms: float = 0.0,
        difc_latency_ms: float = 0.0,
        aia_latency_ms: float = 0.0,
        timed_out: bool = False,
        malformed: bool = False
    ):
        self.total_requests += 1
        if final_decision in self.decisions_count:
            self.decisions_count[final_decision] += 1

        if not cbac_allowed:
            self.cbac_blocks += 1
        if not difc_allowed:
            self.difc_blocks += 1

        if aia_evaluated:
            self.aia_evaluations += 1
            if aia_decision == "BLOCK":
                self.aia_blocks += 1
            elif aia_decision == "ESCALATE":
                self.aia_escalations += 1
            if timed_out:
                self.aia_timeouts += 1
            if malformed:
                self.aia_malformed += 1
        else:
            self.fast_path_hits += 1

        self.total_latencies.append(total_latency_ms)
        if cbac_latency_ms > 0:
            self.cbac_latencies.append(cbac_latency_ms)
        if difc_latency_ms > 0:
            self.difc_latencies.append(difc_latency_ms)
        if aia_latency_ms > 0:
            self.aia_latencies.append(aia_latency_ms)

    def get_summary(self) -> Dict[str, Any]:
        def calc_percentiles(vals: List[float]) -> Dict[str, float]:
            if not vals:
                return {"p50": 0.0, "p95": 0.0, "p99": 0.0, "mean": 0.0, "max": 0.0}
            arr = np.array(vals)
            return {
                "p50": float(np.percentile(arr, 50)),
                "p95": float(np.percentile(arr, 95)),
                "p99": float(np.percentile(arr, 99)),
                "mean": float(np.mean(arr)),
                "max": float(np.max(arr))
            }

        return {
            "total_requests": self.total_requests,
            "decisions": self.decisions_count,
            "cbac_blocks": self.cbac_blocks,
            "difc_blocks": self.difc_blocks,
            "aia_evaluations": self.aia_evaluations,
            "aia_blocks": self.aia_blocks,
            "aia_escalations": self.aia_escalations,
            "aia_timeouts": self.aia_timeouts,
            "aia_malformed": self.aia_malformed,
            "fast_path_hits": self.fast_path_hits,
            "fast_path_percentage": (self.fast_path_hits / max(1, self.total_requests)) * 100.0,
            "latency_total_ms": calc_percentiles(self.total_latencies),
            "latency_cbac_ms": calc_percentiles(self.cbac_latencies),
            "latency_difc_ms": calc_percentiles(self.difc_latencies),
            "latency_aia_ms": calc_percentiles(self.aia_latencies)
        }
