"""Vaulted-secret extraction, live-readiness, and the demo heuristics.

This file used to also cover the /api/last-run credential window. That endpoint is
gone: the server no longer retains a run's tokens, because handing credentials to
a visitor who ran nothing was the wrong trade. Tokens now live only in the browser
that produced them.
"""
import pytest

import main



class TestExtractVaultedSecret:
    def test_plain_string(self):
        assert main._extract_vaulted_secret({"vaulted_secret": " s3cret "}) == "s3cret"

    def test_api_key_template_map(self):
        assert main._extract_vaulted_secret(
            {"vaulted_secret": {"username": "", "apikey": "k"}}) == "k"

    def test_json_encoded_map(self):
        assert main._extract_vaulted_secret({"vaulted_secret": '{"token": "t"}'}) == "t"

    def test_falls_back_through_older_field_names(self):
        assert main._extract_vaulted_secret({"access_token": "a"}) == "a"
        assert main._extract_vaulted_secret({"secret": "b"}) == "b"

    def test_prefers_apikey_over_other_values(self):
        out = main._extract_vaulted_secret(
            {"vaulted_secret": {"zzz": "other", "apikey": "right"}})
        assert out == "right"

    def test_empty_response_is_empty_not_an_exception(self):
        """A failed release must degrade to the env fallback, not crash the run."""
        assert main._extract_vaulted_secret({}) == ""


class TestLiveReadiness:
    def test_missing_env_is_reported_not_hidden(self, monkeypatch):
        """/healthz claiming live while a variable _run_live dereferences is unset
        is what let a half-configured deploy pass Render's health check."""
        for k in main.REQUIRED_LIVE_ENV:
            monkeypatch.setenv(k, "x")
        assert main.live_ready() is True
        monkeypatch.delenv("A2A_CAS_ISSUER")
        assert main.live_ready() is False
        assert "A2A_CAS_ISSUER" in main.missing_live_env()

    def test_a2a_settings_are_required(self):
        """These are hard-indexed in _run_live, so they belong in the check."""
        assert "A2A_CAS_ISSUER" in main.REQUIRED_LIVE_ENV
        assert "A2A_AUDIENCE" in main.REQUIRED_LIVE_ENV


class TestDemoHeuristics:
    @pytest.mark.parametrize("text", [
        "Laptop won't power on", "Replacement keyboard and dock request",
        "Need access to the dashboard", "Need admin role on the project",
    ])
    def test_physical_and_entitlement_work_routes(self, text):
        assert main._naive_self_serviceable(text, "") is False

    @pytest.mark.parametrize("text", [
        "Slack huddle audio not working", "Zoom add-in missing from Outlook",
    ])
    def test_settings_problems_can_self_serve(self, text):
        assert main._naive_self_serviceable(text, "") is True

    def test_department_routing(self):
        assert main._naive_dept("VPN fails", "") == "Networking"
        assert main._naive_dept("keyboard broken", "") == "Hardware"
