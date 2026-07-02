"""A2A machine-context token exchange, the VERIFIED 3-step flow.

Chain: Intake Service Client -> Atlas Triage -> Atlas Resolution (the target).

  STEP 1  Service client mints T1 from Triage's own CAS
          grant=client_credentials, scope=agent.invoke, resource=<Triage resourceUrl>
          => T1.aud = Triage's A2A resourceUrl
  STEP 2  Atlas Triage exchanges T1 at the ORG AS for an id-jag targeting the
          resource's CAS
          grant=token-exchange, subject_token=T1, requested_token_type=id-jag,
          audience=<target CAS issuer>, resource=<target resourceUrl>,
          client_assertion signed by Triage
  STEP 3  Atlas Triage redeems the id-jag at the target's CAS for the final
          A2A token
          grant=jwt-bearer, assertion=id-jag, client_assertion signed by Triage
          => access_token carries nested `act`: { target <- Triage <- ServiceClient }

Verified against the live oktaforai tenant 2026-07-01 (scripts/a2a_flow.py).
Agents cannot use client_credentials (grant types = token-exchange + jwt-bearer
only), that's why a service client mints T1, not the caller agent itself. The
caller agent must ALSO be a registered A2A resource ("dual citizenship") so
T1's audience is valid.
"""
from __future__ import annotations

import httpx

from okta.client_assertion import build_client_assertion

GRANT_CLIENT_CREDENTIALS = "client_credentials"
GRANT_TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"
GRANT_JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer"
SUBJECT_TYPE_ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token"
REQUESTED_TYPE_ID_JAG = "urn:ietf:params:oauth:token-type:id-jag"
CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"

# Atlas Triage's dual-citizenship registration (Okta Console, 2026-07-01).
# resourceUrl cannot be changed without deleting + recreating the a2a-server,
# so these are fixed constants rather than env vars.
TRIAGE_CAS_ID = "aus10sd70du8BMzlL1d8"  # "Atlas Triage A2A"
TRIAGE_RESOURCE_URL = "https://atlas.acme.example/triage"


def mint_service_token(
    okta_domain: str,
    service_client_id: str,
    service_client_secret: str,
    scope: str = "agent.invoke",
) -> dict:
    """Step 1: the Intake Service client mints T1 from Triage's own CAS.

    T1.aud = Triage's A2A resourceUrl. Returns the parsed token response (or
    error body) plus HTTP status under "_status".
    """
    endpoint = f"https://{okta_domain}/oauth2/{TRIAGE_CAS_ID}/v1/token"
    with httpx.Client(timeout=30) as c:
        r = c.post(endpoint, data={
            "grant_type": GRANT_CLIENT_CREDENTIALS,
            "scope": scope,
            "resource": TRIAGE_RESOURCE_URL,
            "client_id": service_client_id,
            "client_secret": service_client_secret,
        })
    body = _json(r)
    body["_status"] = r.status_code
    return body


def exchange_for_id_jag(
    t1_access_token: str,
    triage_principal_id: str,
    triage_jwk: dict,
    okta_domain: str,
    target_cas_issuer: str,
    target_resource_url: str,
    scope: str = "agent.invoke",
) -> dict:
    """Step 2: Atlas Triage exchanges T1 at the ORG AS for an id-jag targeting the resource.

    Returns the parsed response plus "_status".
    """
    org_token_endpoint = f"https://{okta_domain}/oauth2/v1/token"
    assertion = build_client_assertion(triage_principal_id, org_token_endpoint, triage_jwk)
    with httpx.Client(timeout=30) as c:
        r = c.post(org_token_endpoint, data={
            "grant_type": GRANT_TOKEN_EXCHANGE,
            "subject_token": t1_access_token,
            "subject_token_type": SUBJECT_TYPE_ACCESS_TOKEN,
            "requested_token_type": REQUESTED_TYPE_ID_JAG,
            "audience": target_cas_issuer,
            "resource": target_resource_url,
            "scope": scope,
            "client_assertion_type": CLIENT_ASSERTION_TYPE,
            "client_assertion": assertion,
        })
    body = _json(r)
    body["_status"] = r.status_code
    return body


def redeem_id_jag_for_a2a_token(
    id_jag: str,
    triage_principal_id: str,
    triage_jwk: dict,
    target_cas_token_endpoint: str,
) -> dict:
    """Step 3: Atlas Triage redeems the id-jag at the target's CAS for the final A2A token.

    The issued access_token carries the nested `act` chain of custody. Returns
    the parsed response plus "_status".
    """
    assertion = build_client_assertion(triage_principal_id, target_cas_token_endpoint, triage_jwk)
    with httpx.Client(timeout=30) as c:
        r = c.post(target_cas_token_endpoint, data={
            "grant_type": GRANT_JWT_BEARER,
            "assertion": id_jag,
            "client_assertion_type": CLIENT_ASSERTION_TYPE,
            "client_assertion": assertion,
        })
    body = _json(r)
    body["_status"] = r.status_code
    return body


def _json(r: httpx.Response) -> dict:
    try:
        return r.json()
    except Exception:
        return {"_raw": r.text[:500]}
