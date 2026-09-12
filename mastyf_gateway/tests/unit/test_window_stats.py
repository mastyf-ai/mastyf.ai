"""Windowed ledger stats: breakdowns + latency, never invented zeros."""

from mastyf_gateway.receipts.ledger import ExecutionReceiptLedger
from mastyf_gateway.receipts.models import ExecutionObservation


def test_window_stats_by_reason_layer_and_latency(tmp_path):
    ledger = ExecutionReceiptLedger(ledger_path=str(tmp_path / "stats.jsonl"))
    ledger.record(
        "1",
        "s",
        "p",
        "read_file",
        {},
        "pol",
        {},
        "ALLOW",
        "ALLOW",
        "NOT_EVALUATED",
        "ALLOW",
        ExecutionObservation.RESPONSE_RECEIVED,
        "OK",
        server_name="filesystem",
        total_latency_ms=10.0,
    )
    ledger.record(
        "2",
        "s",
        "p",
        "exec",
        {},
        "pol",
        {},
        "DENY",
        "ALLOW",
        "NOT_EVALUATED",
        "BLOCK",
        ExecutionObservation.NOT_SENT,
        "CBAC_DENY",
        server_name="filesystem",
        total_latency_ms=4.0,
    )
    ledger.record(
        "3",
        "s",
        "p",
        "http.request",
        {},
        "pol",
        {},
        "ALLOW",
        "DENY",
        "NOT_EVALUATED",
        "BLOCK",
        ExecutionObservation.NOT_SENT,
        "DIFC_EXFIL",
        server_name="fetch",
        total_latency_ms=20.0,
    )

    ledger.record(
        "slo-e2e-prom",
        "s",
        "p",
        "probe",
        {},
        "pol",
        {},
        "ALLOW",
        "ALLOW",
        "NOT_EVALUATED",
        "ALLOW",
        ExecutionObservation.RESPONSE_RECEIVED,
        "OK",
        server_name="ci-server",
        total_latency_ms=1.0,
    )

    stats = ledger.window_stats()
    assert stats["source"] == "live-ledger"
    assert stats["harness_excluded"] == 1
    assert stats["in_window"] == 3
    assert stats["allowed"] == 1
    assert stats["blocked"] == 2
    assert stats["by_layer"]["CBAC"] == 1
    assert stats["by_layer"]["DIFC"] == 1
    reasons = {row["reason_code"]: row["count"] for row in stats["by_reason"]}
    assert reasons["CBAC_DENY"] == 1
    assert stats["latency"]["samples"] == 3
    assert stats["latency"]["p50_ms"] == 10.0
    assert stats["last_block_receipt_id"] == "3"
    servers = {row["name"]: row for row in stats["by_server"]}
    assert servers["filesystem"]["blocked"] == 1
    assert servers["filesystem"]["allowed"] == 1
