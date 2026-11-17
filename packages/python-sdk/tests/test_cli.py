import json

import pytest

from mastyf_ai import cli
from mastyf_ai import guard as guard_module


@pytest.fixture(autouse=True)
def fresh(isolated_home, check_bundle, monkeypatch):
    monkeypatch.setenv("MASTYF_CHECK_BIN", str(check_bundle))
    guard_module._reset_for_tests()
    yield
    guard_module._reset_for_tests()


def test_status_says_which_checks_are_in_use(capsys):
    assert cli.main(["status"]) == 0
    out = capsys.readouterr().out
    assert "free" in out
    assert "nothing leaves this machine" in out.lower()


def test_check_prints_the_verdict_and_exits_2_when_blocked(capsys):
    assert cli.main(["check", "read_file", '{"path": "/etc/passwd"}']) == 2
    assert json.loads(capsys.readouterr().out)["decision"] == "block"
    assert cli.main(["check", "read_file", '{"path": "./README.md"}']) == 0


def test_bad_arguments_exit_1(capsys):
    assert cli.main(["check", "read_file", "{nope"]) == 1
    assert "JSON" in capsys.readouterr().err
