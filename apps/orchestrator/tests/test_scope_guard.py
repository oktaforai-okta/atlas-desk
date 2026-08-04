"""Scope enforcement at the operation boundary.

These guard the property that makes the CRUD story true in code as well as in
Okta: a token that does not carry the required scope must not be usable for the
operation that needs it.
"""
import base64
import json

import pytest

from okta.scope_guard import ScopeDenied, has_scope, require_scope, scopes_of


def tok(payload: dict) -> str:
    """Minimal unsigned JWT. scope_guard reads claims without verifying, so an
    unsigned token exercises exactly the same code path a signed one does."""
    def seg(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{seg({'alg': 'none'})}.{seg(payload)}.sig"


class TestScopesOf:
    def test_reads_scp_list(self):
        """Okta access tokens use `scp` as a list."""
        assert scopes_of(tok({"scp": ["ticket.read"]})) == ["ticket.read"]

    def test_reads_space_delimited_scope_string(self):
        """ID-JAGs use `scope` as a space-delimited string. Both shapes appear in
        this pipeline, so handling only one silently loses the other."""
        assert scopes_of(tok({"scope": "ticket.read ticket.write"})) == [
            "ticket.read", "ticket.write"]

    def test_scp_wins_when_both_present(self):
        assert scopes_of(tok({"scp": ["a"], "scope": "b"})) == ["a"]

    @pytest.mark.parametrize("bad", [None, "", "not-a-jwt", "a.b", "..", "x.!!!.z"])
    def test_malformed_input_yields_no_scopes(self, bad):
        """Never raise while inspecting a token. A garbled token has no scopes,
        which makes require_scope refuse, which is the safe direction."""
        assert scopes_of(bad) == []

    def test_empty_scope_string_is_not_a_scope(self):
        assert scopes_of(tok({"scope": "   "})) == []


class TestRequireScope:
    def test_allows_when_present(self):
        assert require_scope(tok({"scp": ["ticket.read"]}), "ticket.read") == ["ticket.read"]

    def test_denies_when_absent(self):
        with pytest.raises(ScopeDenied):
            require_scope(tok({"scp": ["ticket.read"]}), "ticket.write")

    def test_denies_a_missing_token(self):
        """No token at all must never pass. If the A2A chain degraded and produced
        nothing, the operation it would have authorized must not proceed."""
        with pytest.raises(ScopeDenied):
            require_scope(None, "ticket.write")

    def test_read_scope_does_not_imply_write(self):
        """The whole demo rests on this. A prefix or substring match would quietly
        grant write to a read-only agent."""
        assert not has_scope(tok({"scp": ["ticket.read"]}), "ticket.write")
        assert not has_scope(tok({"scp": ["ticket"]}), "ticket.read")
        assert not has_scope(tok({"scp": ["ticket.readwrite"]}), "ticket.read")

    def test_error_names_what_was_required_and_held(self):
        """The message is what a developer debugging a denial actually reads."""
        with pytest.raises(ScopeDenied) as e:
            require_scope(tok({"scp": ["ticket.read"]}), "ticket.write")
        assert "ticket.write" in str(e.value)
        assert "ticket.read" in str(e.value)
