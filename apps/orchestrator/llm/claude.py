"""Claude API wrapper: ticket classification (Intake) + comment drafting (Resolution).

Prompt assembly + response parsing are pure functions (unit-tested). The network
call lives in ``classify`` / ``draft_comments`` and uses ANTHROPIC_API_KEY.
"""
from __future__ import annotations

import json
import os
from typing import List

from tickets.seeds import DEPARTMENTS

MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")


class ClassificationError(ValueError):
    pass


def build_classify_prompt(title: str, body: str) -> str:
    depts = ", ".join(DEPARTMENTS)
    return (
        "You are an IT service-desk triage agent. Classify the ticket below.\n"
        f"Choose exactly one department from: {depts}.\n"
        "Choose urgency from: Low, Medium, High, Critical.\n"
        "Return STRICT JSON only, no prose, with keys: department, urgency, summary "
        "(summary = one concise sentence).\n\n"
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
    return {
        "department": dept,
        "urgency": obj.get("urgency", "Medium"),
        "summary": obj.get("summary", "").strip(),
    }


def build_comment_prompt(title: str, body: str, department: str) -> str:
    return (
        f"You are an IT {department} resolution agent. For the ticket below, write two short "
        "professional work-note comments an agent would add: (1) acknowledgement + initial "
        "assessment, (2) first concrete next step. Return STRICT JSON: a list of two strings.\n\n"
        f"TITLE: {title}\nBODY: {body}\n"
    )


def _client():
    from anthropic import Anthropic
    return Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def classify(title: str, body: str) -> dict:
    msg = _client().messages.create(
        model=MODEL, max_tokens=400,
        messages=[{"role": "user", "content": build_classify_prompt(title, body)}],
    )
    return parse_classification(msg.content[0].text)


def draft_comments(title: str, body: str, department: str) -> List[str]:
    msg = _client().messages.create(
        model=MODEL, max_tokens=600,
        messages=[{"role": "user", "content": build_comment_prompt(title, body, department)}],
    )
    text = msg.content[0].text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("["): text.rfind("]") + 1]
    out = json.loads(text)
    return [str(c) for c in out][:2]
