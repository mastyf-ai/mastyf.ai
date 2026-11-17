import pytest

from mastyf_ai.client import CheckClient, MastyfUnavailable
from mastyf_ai.verdict import Verdict

from .conftest import TOKEN


def test_check_call_sends_the_request_and_reads_the_verdict(fake_service):
    svc = fake_service(lambda path, body: (200, {"decision": "block", "id": "v1", "layer": "hooks", "rule": "hook-before", "reason": "Path not in allowed list"}))
    client = CheckClient(svc.url, TOKEN)
    v = client.check_call("read_file", {"path": "/etc/passwd"}, server="files", session="s1")
    assert v == Verdict(decision="block", id="v1", layer="hooks", rule="hook-before", reason="Path not in allowed list")
    req = svc.requests[0]
    assert req["path"] == "/v1/check/call"
    assert req["auth"] == f"Bearer {TOKEN}"
    assert req["body"] == {"tool": "read_file", "arguments": {"path": "/etc/passwd"}, "server": "files", "session": "s1"}


def test_check_result_and_redaction(fake_service):
    svc = fake_service(lambda path, body: (200, {"decision": "redact", "id": "v2", "result": {"content": "[REDACTED]"}}))
    v = CheckClient(svc.url, TOKEN).check_result("read_file", {"content": "secret"}, server="files", session="s1")
    assert v.decision == "redact"
    assert v.result == {"content": "[REDACTED]"}
    assert svc.requests[0]["path"] == "/v1/check/result"


def test_register_tools_returns_none_when_allowed(fake_service):
    svc = fake_service(lambda path, body: (200, {"decision": "allow", "id": "tools"}))
    assert CheckClient(svc.url, TOKEN).register_tools("files", [{"name": "read_file"}], session="s1") is None
    assert svc.requests[0]["body"]["tools"] == [{"name": "read_file"}]


@pytest.mark.parametrize("status", [401, 413, 500])
def test_any_non_200_means_unavailable(fake_service, status):
    svc = fake_service(lambda path, body: (status, {"error": "no"}))
    with pytest.raises(MastyfUnavailable):
        CheckClient(svc.url, TOKEN).check_call("x", {}, server="s", session="t")


def test_unreachable_or_slow_means_unavailable():
    with pytest.raises(MastyfUnavailable):
        CheckClient("http://127.0.0.1:9", TOKEN, timeout=1.0).check_call("x", {}, server="s", session="t")


def test_health_is_none_when_unreachable(fake_service):
    assert CheckClient("http://127.0.0.1:9", TOKEN, timeout=1.0).health() is None
    svc = fake_service(lambda path, body: (200, {"status": "ready", "tier": "free"}))
    assert CheckClient(svc.url, TOKEN).health() == {"status": "ready", "tier": "free"}


def test_the_model_message_names_the_check_never_the_matched_text():
    v = Verdict(decision="block", id="x", layer="hooks", rule="hook-before", reason="Path not in allowed list: /etc/passwd")
    assert v.model_message() == "Blocked by Mastyf (hooks: hook-before)."
    assert Verdict(decision="block", id="x").model_message() == "Blocked by Mastyf."
    assert Verdict(decision="block", id="x", layer="answer-check").model_message() == "Blocked by Mastyf (answer-check)."
    assert v.blocked and not Verdict(decision="allow", id="y").blocked
