"""Shared private_key_jwt client-assertion builder for Okta workload principals.

Mirrors the verified pattern used by the Okta MCP adapter: iss=sub=principal_id,
aud=token_endpoint, RS256, short-lived, random jti.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Union

from jose import jwt


def build_client_assertion(
    principal_id: str,
    token_endpoint: str,
    private_jwk: Union[dict, str],
    expires_in: int = 300,
) -> str:
    """Return a signed JWT proving control of the agent's key.

    Args:
        principal_id: the agent workload-principal id (wlp...). Used as iss and sub.
        token_endpoint: the audience (the /v1/token URL the assertion is sent to).
        private_jwk: the agent's private JWK (dict or JSON string).
        expires_in: assertion lifetime in seconds (default 300).
    """
    key = json.loads(private_jwk) if isinstance(private_jwk, str) else private_jwk
    now = int(time.time())
    claims = {
        "iss": principal_id,
        "sub": principal_id,
        "aud": token_endpoint,
        "iat": now,
        "exp": now + expires_in,
        "jti": str(uuid.uuid4()),
    }
    headers = {"alg": "RS256"}
    if isinstance(key, dict) and key.get("kid"):
        headers["kid"] = key["kid"]
    return jwt.encode(claims, key, algorithm="RS256", headers=headers)
