"""Scope enforcement at the operation boundary.

Okta decides which scopes an agent may hold. This module is the other half of
that contract: before the orchestrator performs a read or a write on the agent's
behalf, it checks that the token the agent actually presented carries the scope
that operation requires. That is what a resource server is supposed to do, and
it means a scope is a permission rather than a decoration.

Two enforcement points, deliberately:

  1. Okta refuses to ISSUE a token carrying a scope the agent is not entitled to
     (see okta/a2a_exchange.attempt_denied_write).
  2. This module refuses to USE a token that lacks the scope for the operation.

Layer 1 is the real security boundary. Layer 2 catches the case where a token is
obtained legitimately for one purpose and then reused for another.
"""
from __future__ import annotations

from typing import Iterable, Optional

from jose import jwt as jose_jwt


class ScopeDenied(PermissionError):
    """Raised when a presented token does not carry the required scope."""

    def __init__(self, required: str, present: Iterable[str]):
        self.required = required
        self.present = sorted(present)
        super().__init__(
            f"operation requires scope '{required}' but the presented token carries "
            f"{self.present or ['(none)']}"
        )


def scopes_of(access_token: Optional[str]) -> list[str]:
    """Return the scopes in a token. `scp` is a list, `scope` a space-delimited string.

    Claims are read without signature verification: this is the orchestrator
    inspecting a token Okta just handed it over TLS, not a resource server
    accepting one from an untrusted caller. A real standalone resource server
    would verify against the issuer's JWKS first.
    """
    if not access_token:
        return []
    try:
        claims = jose_jwt.get_unverified_claims(access_token)
    except Exception:
        return []
    scp = claims.get("scp")
    if isinstance(scp, list):
        return [str(s) for s in scp]
    raw = claims.get("scope") or ""
    return [s for s in str(raw).split(" ") if s]


def has_scope(access_token: Optional[str], required: str) -> bool:
    return required in scopes_of(access_token)


def require_scope(access_token: Optional[str], required: str) -> list[str]:
    """Assert the token carries `required`. Returns its scopes, or raises ScopeDenied."""
    present = scopes_of(access_token)
    if required not in present:
        raise ScopeDenied(required, present)
    return present
