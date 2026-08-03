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

Verified against a live tenant (scripts/a2a_flow.py). Agents cannot use
client_credentials (grant types = token-exchange + jwt-bearer only), that's why
a service client mints T1, not the caller agent itself. The caller agent must
ALSO be a registered A2A resource ("dual citizenship") so T1's audience is valid.
"""
from __future__ import annotations

import os

import httpx

from okta.client_assertion import build_client_assertion

GRANT_CLIENT_CREDENTIALS = "client_credentials"
GRANT_TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"
GRANT_JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer"
SUBJECT_TYPE_ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token"
REQUESTED_TYPE_ID_JAG = "urn:ietf:params:oauth:token-type:id-jag"
CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"

# Atlas Triage's dual-citizenship registration (Okta Console). resourceUrl
# cannot be changed without deleting + recreating the a2a-server, so pick these
# deliberately for your own tenant, see docs/OKTA_SETUP.md.
TRIAGE_CAS_ID = os.environ.get("TRIAGE_CAS_ID", "<triage-cas-id>")
TRIAGE_RESOURCE_URL = os.environ.get("TRIAGE_RESOURCE_URL", "https://atlas.acme.example/triage")


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


def attempt_denied_write(
    subject_token: str,
    caller_principal_id: str,
    caller_jwk: dict,
    okta_domain: str,
    write_cas_issuer: str,
    write_resource_url: str,
    write_scope: str,
) -> dict:
    """Deliberately attempt a write-scoped exchange as the READ-ONLY agent.

    This is expected to FAIL, and the failure is the point: it is the demo's proof
    that least privilege is enforced by Okta rather than asserted by this app.

    Two independent barriers make it fail, verified live against the tenant:

      1. The write scope exists ONLY on the write authorization server. Requesting
         it anywhere else returns 400 invalid_scope ("One or more scopes are not
         configured for the authorization server resource").
      2. The read-only agent is not in the write AS's policy clients.include, so
         asking that server directly returns 401 access_denied ("Policy evaluation
         failed for this request").

    Okta does not down-scope a token-exchange request: an ungrantable scope fails
    the WHOLE request rather than yielding the grantable subset. So there is no
    partial success to accidentally accept.

    Returns the parsed error body plus "_status" so the UI can show Okta's own
    words verbatim instead of a message this code invented.
    """
    org_token_endpoint = f"https://{okta_domain}/oauth2/v1/token"
    assertion = build_client_assertion(caller_principal_id, org_token_endpoint, caller_jwk)
    with httpx.Client(timeout=30) as c:
        r = c.post(org_token_endpoint, data={
            "grant_type": GRANT_TOKEN_EXCHANGE,
            "subject_token": subject_token,
            "subject_token_type": SUBJECT_TYPE_ACCESS_TOKEN,
            "requested_token_type": REQUESTED_TYPE_ID_JAG,
            "audience": write_cas_issuer,
            "resource": write_resource_url,
            "scope": write_scope,
            "client_assertion_type": CLIENT_ASSERTION_TYPE,
            "client_assertion": assertion,
        })
    body = _json(r)
    body["_status"] = r.status_code
    body["_denied"] = r.status_code >= 400
    return body


def _json(r: httpx.Response) -> dict:
    try:
        return r.json()
    except Exception:
        return {"_raw": r.text[:500]}
