"""Claude API wrapper: ticket classification (Intake) + comment drafting (Resolution).

Prompt assembly + response parsing are pure functions (unit-tested). The network
call lives in ``classify`` / ``draft_comments`` and uses ANTHROPIC_API_KEY.
"""
from __future__ import annotations

import json
import os
from typing import List, Optional

from tickets.seeds import DEPARTMENTS

MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5")


class ClassificationError(ValueError):
    pass


def _no_dashes(s: str) -> str:
    """Strip em/en-dashes from model-generated prose (house style: no em-dashes)."""
    for a, b in ((" — ", ", "), ("— ", ", "), (" —", ","), ("—", ", "),
                 (" – ", ", "), ("– ", ", "), (" –", ","), ("–", "-")):
        s = s.replace(a, b)
    while ", ," in s:
        s = s.replace(", ,", ",")
    return s.replace(" ,", ",").replace("  ", " ").strip()


def build_classify_prompt(title: str, body: str, similar: Optional[List[str]] = None) -> str:
    """Triage prompt: department, urgency, AND the self-serviceable judgement.

    The auto-resolve decision is the model's, not a coin flip. It is made here,
    in the same call as classification, so the judgement sees the same context
    the routing decision saw (including any similar open tickets Agent 1 found
    on its read pass) and costs no extra round trip.
    """
    depts = ", ".join(DEPARTMENTS)
    context = ""
    if similar:
        listed = "\n".join(f"  - {s}" for s in similar[:5])
        context = (
            "\nSimilar tickets already open in this project (found by a read query):\n"
            f"{listed}\n"
            "If this looks like a duplicate of one of those, it is NOT self-serviceable, "
            "a human should merge it.\n"
        )
    return (
        "You are an IT service-desk triage agent. Classify the ticket below.\n"
        f"Choose exactly one department from: {depts}.\n"
        "Choose urgency from: Low, Medium, High, Critical.\n"
        "\nAlso decide whether YOU can fully resolve this ticket end-to-end right now, "
        "with no human and no physical action, by sending the user self-service "
        "instructions.\n"
        "  self_serviceable = true  for things fixed by settings, a reset, a reinstall, "
        "a cache clear, a known configuration step, or a documented workaround.\n"
        "  self_serviceable = false for anything needing hardware repair or replacement, "
        "physical access, a shipment, a purchase, a permission grant you cannot make, "
        "an account entitlement change, a security review, or a site visit. Also false "
        "if the ticket is a likely duplicate, or if you are genuinely unsure.\n"
        "Be honest. Guessing true on a broken laptop makes the system untrustworthy.\n"
        f"{context}"
        "\nReturn STRICT JSON only, no prose, with keys: department, urgency, summary "
        "(one concise sentence), self_serviceable (boolean), reason (one short sentence "
        "explaining the self_serviceable call).\n\n"
        f"TITLE: {title}\nBODY: {body}\n"
    )


def parse_classification(raw: str) -> dict:
    """Parse the model's JSON. Raises ClassificationError on bad department."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"): text.rfind("}") + 1]
    obj = json.loads(text)
    dept = obj.get("department", "")
    if dept not in DEPARTMENTS:
        raise ClassificationError(f"unknown department: {dept!r}")
    # Anything other than an explicit true routes to a human. An absent or
    # malformed judgement must never silently auto-close a real ticket.
    return {
        "department": dept,
        "urgency": obj.get("urgency", "Medium"),
        "summary": obj.get("summary", "").strip(),
        "self_serviceable": obj.get("self_serviceable") is True,
        "reason": _no_dashes(str(obj.get("reason", "")).strip()),
    }


def build_comment_prompt(title: str, body: str, department: str) -> str:
    return (
        f"You are an IT {department} resolution agent. For the ticket below, write two short "
        "professional work-note comments an agent would add: (1) acknowledgement + initial "
        "assessment, (2) first concrete next step. Return STRICT JSON: a list of two strings.\n\n"
        f"TITLE: {title}\nBODY: {body}\n"
    )


def _first_text(msg) -> str:
    """Return the first text block's content.

    Do not index content[0] blindly. Current models can return a ThinkingBlock as
    the first content block, which has no .text attribute, and whether they do so
    varies per request. Indexing [0] therefore fails intermittently rather than
    consistently, which is the worst way for this to break.
    """
    for block in getattr(msg, "content", None) or []:
        text = getattr(block, "text", None)
        if isinstance(text, str) and text.strip():
            return text
    raise ClassificationError("model returned no text block")


def _client():
    from anthropic import Anthropic
    # Pin to the real Anthropic API, ignore any ambient ANTHROPIC_BASE_URL (e.g. a proxy/gateway).
    return Anthropic(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        base_url=os.environ.get("ATLAS_ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
    )


def classify(title: str, body: str, similar: Optional[List[str]] = None) -> dict:
    msg = _client().messages.create(
        model=MODEL, max_tokens=500,
        messages=[{"role": "user", "content": build_classify_prompt(title, body, similar)}],
    )
    return parse_classification(_first_text(msg))


def draft_comments(title: str, body: str, department: str) -> List[str]:
    msg = _client().messages.create(
        model=MODEL, max_tokens=600,
        messages=[{"role": "user", "content": build_comment_prompt(title, body, department)}],
    )
    text = _first_text(msg).strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("["): text.rfind("]") + 1]
    out = json.loads(text)
    return [_no_dashes(str(c)) for c in out][:2]


def build_resolution_prompt(title: str, body: str, department: str) -> str:
    return (
        f"You are an autonomous IT {department} agent that resolves simple tickets end-to-end. "
        "The ticket below is one you can fully self-serve. Write the customer-facing reply that RESOLVES it: "
        "a warm, concise message (3-5 sentences or a short numbered list) with the exact fix or self-service "
        "steps, so the user needs no further help. Address the user directly. No placeholders. "
        "Return STRICT JSON: {\"resolution\": \"...\"}.\n\n"
        f"TITLE: {title}\nBODY: {body}\n"
    )


def _fallback_resolution(department: str) -> str:
    return (
        "Thanks for reaching out. We identified the cause and applied the standard "
        f"{department} fix, and sent you step-by-step instructions to confirm it on your end. "
        "This ticket has been resolved; reply here to reopen it if anything is still not working."
    )


def draft_resolution(title: str, body: str, department: str) -> str:
    """Customer-facing resolution the agent 'sends' when it auto-resolves a case."""
    try:
        msg = _client().messages.create(
            model=MODEL, max_tokens=600,
            messages=[{"role": "user", "content": build_resolution_prompt(title, body, department)}],
        )
        text = _first_text(msg).strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text[text.find("{"): text.rfind("}") + 1]
        return _no_dashes(str(json.loads(text).get("resolution", "")).strip()) or _fallback_resolution(department)
    except Exception:
        return _fallback_resolution(department)
