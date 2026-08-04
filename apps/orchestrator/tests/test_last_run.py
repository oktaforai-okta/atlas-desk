"""The /api/last-run credential window, and the vaulted-secret extractor.

/api/last-run publishes real Okta tokens so the chain-of-custody page works for
anyone, not just the tab that ran the pipeline. The property these tests protect
is that the published window equals the credential's own lifetime: an expired
token must never be served, because it proves nothing and only widens exposure.
"""
import base64
import json
import time

import pytest

import main


def tok(exp=None, extra=None):
    payload = dict(extra or {})
    if exp is not None:
        payload["exp"] = exp
    def seg(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{seg({'alg': 'none'})}.{seg(payload)}.sig"


NOW = int(time.time())
LIVE = NOW + 600
DEAD = NOW - 10


def served(events):
    return {k for e in main._unexpired(events) for k in (e.get("raw_tokens") or {})}


class TestUnexpired:
    def test_keeps_a_live_token(self):
        assert served([{"step": "read_grant", "raw_tokens": {"t1": tok(LIVE)}}]) == {"t1"}

    def test_drops_an_expired_token(self):
        assert served([{"step": "read_grant", "raw_tokens": {"t1": tok(DEAD)}}]) == set()

    def test_filters_per_token_within_one_event(self):
        """An ID-JAG expires in 5 minutes and its access token in an hour, so one
        event legitimately holds a dead token beside a live one."""
        evs = [{"step": "a2a_delegate", "raw_tokens": {"idjag1": tok(DEAD), "t_res": tok(LIVE)}}]
        assert served(evs) == {"t_res"}

    def test_drops_an_event_whose_tokens_are_all_dead(self):
        evs = [{"step": "read_grant", "raw_tokens": {"t1": tok(DEAD)}}]
        assert main._unexpired(evs) == []

    def test_retains_the_denial_step_which_has_no_token(self):
        """The refusal is the point of the demo and carries no credential, so it
        must survive a filter that keys off token expiry."""
        evs = [{"step": "write_denied", "raw_tokens": None,
                "data": {"denied": True, "error": "invalid_scope"}}]
        out = main._unexpired(evs)
        assert len(out) == 1 and out[0]["step"] == "write_denied"

    def test_keeps_a_token_with_no_exp_claim(self):
        """Demo-mode tokens may omit exp. Withholding them would make local
        development look broken for no safety gain, since they are already
        self-evidently fake (alg=none)."""
        assert served([{"step": "x", "raw_tokens": {"t": tok(None)}}]) == {"t"}

    @pytest.mark.parametrize("bad", ["not-a-jwt", "a.b", "", "x.!!!!.z", "a..c"])
    def test_drops_undecodable_tokens(self, bad):
        """Fail closed: if we cannot read exp we do not publish it."""
        assert served([{"step": "x", "raw_tokens": {"t": bad}}]) == set()

    def test_expiry_is_evaluated_at_call_time(self):
        """A token live now must stop being served once it lapses, without the
        process restarting."""
        near = int(time.time()) + 1
        evs = [{"step": "x", "raw_tokens": {"t": tok(near)}}]
        assert served(evs) == {"t"}
        time.sleep(1.2)
        assert served(evs) == set()

    def test_does_not_mutate_the_stored_run(self):
        """_LAST_RUN is module state reused across requests; filtering must not
        destroy the original, or one stale request would empty it permanently."""
        evs = [{"step": "a2a_delegate", "raw_tokens": {"idjag1": tok(DEAD), "t_res": tok(LIVE)}}]
        main._unexpired(evs)
        assert set(evs[0]["raw_tokens"]) == {"idjag1", "t_res"}


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
