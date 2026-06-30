"""A2A machine-context token exchange.

Implements the two-step machine-context flow learned from the live working
delegation (ProGearSales -> ProGearInventory) in the oktaforai tenant:

  1. The delegating agent (Atlas Triage) obtains its OWN access token from an
     Okta authorization server via client_credentials + private_key_jwt.
  2. That access token is presented as the subject_token in an RFC 8693
     token-exchange at the target resource's A2A Custom AS, producing a scoped
     token whose `act` claim records the delegating agent (the chain of custody).

No user / id_token anywhere — this is machine context.
"""
from __future__ import annotations

from typing import Optional

import httpx

from okta.client_assertion import build_client_assertion

GRANT_CLIENT_CREDENTIALS = "client_credentials"
GRANT_TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"
SUBJECT_TYPE_ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token"
CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"


def get_agent_access_token(
    principal_id: str,
    private_jwk: dict,
    token_endpoint: str,
    scope: Optional[str] = None,
) -> dict:
    """Step 1: agent obtains its own access token (client_credentials + private_key_jwt).

    Returns the parsed token response (or error body) plus http status under "_status".
    """
    assertion = build_client_assertion(principal_id, token_endpoint, private_jwk)
    form = {
        "grant_type": GRANT_CLIENT_CREDENTIALS,
        "client_assertion_type": CLIENT_ASSERTION_TYPE,
        "client_assertion": assertion,
        "client_id": principal_id,
    }
    if scope:
        form["scope"] = scope
    with httpx.Client(timeout=30) as c:
        r = c.post(token_endpoint, data=form,
                   headers={"Content-Type": "application/x-www-form-urlencoded"})
    body = _json(r)
    body["_status"] = r.status_code
    return body


def exchange_for_agent_resource(
    subject_access_token: str,
    principal_id: str,
    private_jwk: dict,
    cas_token_endpoint: str,
    audience: str,
    scope: str,
) -> dict:
    """Step 2: token-exchange the subject access token for a resource-scoped token.

    The issued token carries `sub` (the delegating principal) + `act` (chain of
    custody). Returns the parsed response plus "_status".
    """
    assertion = build_client_assertion(principal_id, cas_token_endpoint, private_jwk)
    form = {
        "grant_type": GRANT_TOKEN_EXCHANGE,
        "subject_token": subject_access_token,
        "subject_token_type": SUBJECT_TYPE_ACCESS_TOKEN,
        "audience": audience,
        "scope": scope,
        "client_assertion_type": CLIENT_ASSERTION_TYPE,
        "client_assertion": assertion,
        "client_id": principal_id,
    }
    with httpx.Client(timeout=30) as c:
        r = c.post(cas_token_endpoint, data=form,
                   headers={"Content-Type": "application/x-www-form-urlencoded"})
    body = _json(r)
    body["_status"] = r.status_code
    return body


def _json(r: httpx.Response) -> dict:
    try:
        return r.json()
    except Exception:
        return {"_raw": r.text[:500]}
