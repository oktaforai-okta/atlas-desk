"""Activity event model + SSE emitter (matches the frontend ActivityEvent contract).

JSON keys must match apps/web/lib/events.ts: step, actor, actorKind, plain, tech,
primary, token_claims, system_log_id, data, status, ts.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Optional

STATUS_RUNNING = "running"
STATUS_OK = "ok"
STATUS_ERROR = "error"


@dataclass
class ActivityEvent:
    step: str
    actor: str
    actor_kind: str  # "intake" | "triage" | "resolve" | "okta"
    plain: str
    tech: Optional[str] = None
    primary: bool = False
    token_claims: Optional[dict] = None
    system_log_id: Optional[str] = None
    data: dict = field(default_factory=dict)
    status: str = STATUS_OK
    ts: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "step": self.step,
            "actor": self.actor,
            "actorKind": self.actor_kind,
            "plain": self.plain,
            "tech": self.tech,
            "primary": self.primary,
            "token_claims": self.token_claims,
            "system_log_id": self.system_log_id,
            "data": self.data,
            "status": self.status,
            "ts": self.ts,
        }

    def sse(self) -> str:
        return f"event: chain\ndata: {json.dumps(self.to_dict())}\n\n"


class EventStream:
    """Per-run async queue drained by the SSE endpoint."""

    def __init__(self) -> None:
        self._q: asyncio.Queue = asyncio.Queue()

    async def emit(self, e: ActivityEvent) -> None:
        await self._q.put(e)

    async def close(self) -> None:
        await self._q.put(None)

    async def stream(self):
        while True:
            item = await self._q.get()
            if item is None:
                return
            yield item.sse()
