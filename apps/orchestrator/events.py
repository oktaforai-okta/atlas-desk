"""Chain-of-custody event model + async emitter.

Each hop of the autonomous pipeline emits a ChainEvent. The orchestrator streams
these to the frontend over SSE so the Chain-of-Custody panel can render the
identity + token claims + audit receipt at every step.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# Ordered pipeline steps the UI knows how to render.
STEP_INBOUND = "inbound"
STEP_INTAKE_AUTH = "intake_auth"
STEP_INTAKE_CLASSIFY = "intake_classify"
STEP_A2A_EXCHANGE = "a2a_exchange"
STEP_DEVOPS_RECEIVE = "devops_receive"
STEP_OPA_VAULT = "opa_vault"
STEP_DEVOPS_DRAFT = "devops_draft"
STEP_JIRA_WRITE = "jira_write"
STEP_DONE = "done"

STATUS_RUNNING = "running"
STATUS_OK = "ok"
STATUS_ERROR = "error"


@dataclass
class ChainEvent:
    step: str
    label: str
    status: str = STATUS_OK
    identity: Optional[str] = None          # e.g. "Atlas Triage Agent (wlp...)"
    detail: Optional[str] = None            # human-readable line for the receipt
    token_claims: Optional[dict] = None     # decoded JWT claims (sub, act, aud, scp...)
    system_log_id: Optional[str] = None     # Okta System Log eventId / operation id
    data: dict = field(default_factory=dict)  # step-specific extras (e.g. jira issue key)
    ts: Optional[float] = None

    def sse(self) -> str:
        payload = asdict(self)
        return f"event: chain\ndata: {json.dumps(payload)}\n\n"


class EventStream:
    """Single-run async queue the SSE endpoint drains."""

    def __init__(self) -> None:
        self._q: asyncio.Queue = asyncio.Queue()
        self._closed = False

    async def emit(self, event: ChainEvent) -> None:
        await self._q.put(event)

    async def close(self) -> None:
        self._closed = True
        await self._q.put(None)  # sentinel

    async def __aiter__(self):
        while True:
            item = await self._q.get()
            if item is None:
                return
            yield item
