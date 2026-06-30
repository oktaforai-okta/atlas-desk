"""OPA vaulted-secret retrieval (STS_VAULT_SECRET) for the Resolution Agent.

The agent authenticates to Okta with its own private_key_jwt and exchanges for the
Jira API credential vaulted in Okta Privileged Access. Mirrors the adapter's
OktaVaultSecretExchanger. The Jira credential never lives in code/env.
"""
from __future__ import annotations

import httpx

from okta.client_assertion import build_client_assertion

GRANT_TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"
REQUESTED_VAULTED_SECRET = "urn:okta:params:oauth:token-type:vaulted-secret"
SUBJECT_TYPE_ID = "urn:ietf:params:oauth:token-type:id_token"
CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"


def retrieve_vaulted_secret(
    principal_id: str,
    private_jwk: dict,
    okta_domain: str,
    resource_orn: str,
    subject_id_token: str | None = None,
) -> dict:
    """Retrieve the vaulted secret bound to ``resource_orn``.

    Returns the parsed token response (the released secret material) plus "_status".
    For a machine/agent-only secret the subject token may be unnecessary; when an
    on-behalf-of user is in play, pass their id_token as ``subject_id_token``.
    """
    token_endpoint = f"https://{okta_domain.replace('https://', '').rstrip('/')}/oauth2/v1/token"
    assertion = build_client_assertion(principal_id, token_endpoint, private_jwk)
    form = {
        "grant_type": GRANT_TOKEN_EXCHANGE,
        "requested_token_type": REQUESTED_VAULTED_SECRET,
        "resource": resource_orn,
        "client_assertion_type": CLIENT_ASSERTION_TYPE,
        "client_assertion": assertion,
        "client_id": principal_id,
    }
    if subject_id_token:
        form["subject_token"] = subject_id_token
        form["subject_token_type"] = SUBJECT_TYPE_ID
    with httpx.Client(timeout=30) as c:
        r = c.post(token_endpoint, data=form,
                   headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        body = r.json()
    except Exception:
        body = {"_raw": r.text[:500]}
    body["_status"] = r.status_code
    return body
