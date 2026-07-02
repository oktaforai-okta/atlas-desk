"""Fabricated inbound IT support tickets.

Simulates tickets arriving from an external ticketing system. Each seed carries an
``expected_department`` used only for tests/demo narration; the live agent still
classifies with the LLM rather than reading this field.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import List

DEPARTMENTS = ["Networking", "Hardware", "Access Management", "Software"]


@dataclass(frozen=True)
class Ticket:
    id: str
    title: str
    body: str
    reporter: str
    expected_department: str

    def public(self) -> dict:
        d = asdict(self)
        d.pop("expected_department", None)
        return d


_SEEDS: List[Ticket] = [
    Ticket("INC-4471", "Can't connect to VPN from home",
           "Since this morning the corporate VPN client fails with 'authentication timeout' "
           "right after I approve the push. Worked fine yesterday. I'm fully remote today.",
           "dana.reed@atko.email", "Networking"),
    Ticket("INC-4472", "Laptop won't power on after update",
           "My ThinkPad shut down during a Windows update last night and now the power light "
           "blinks three times and nothing happens. I have a customer demo at 2pm.",
           "marco.silva@atko.email", "Hardware"),
    Ticket("INC-4473", "Need access to the Salesforce Revenue dashboard",
           "I just moved to the RevOps team and can't see the Revenue dashboard in Salesforce. "
           "My manager said to request access through IT.",
           "priya.nair@atko.email", "Access Management"),
    Ticket("INC-4474", "Adobe Acrobat keeps crashing on launch",
           "Acrobat Pro crashes immediately on open since the latest version. Reinstalled twice, "
           "same result. I need it to process signed contracts.",
           "evan.cole@atko.email", "Software"),
    Ticket("INC-4475", "Office Wi-Fi dropping every few minutes",
           "The 4th-floor conference room Wi-Fi disconnects every 5-10 minutes during calls. "
           "Multiple people on the floor see the same thing.",
           "lena.fischer@atko.email", "Networking"),
    Ticket("INC-4476", "Replacement keyboard and dock request",
           "Several keys on my keyboard stopped working and my dock no longer charges the laptop. "
           "Requesting replacement hardware.",
           "sam.osei@atko.email", "Hardware"),
    Ticket("INC-4477", "Locked out of GitHub org after SSO change",
           "After the SSO migration I can't access the engineering GitHub org. Getting "
           "'you are not a member' even though I was yesterday.",
           "tara.lin@atko.email", "Access Management"),
    Ticket("INC-4478", "Slack huddle audio not working on desktop app",
           "Mic and audio fail only in the Slack desktop app; browser works. Reinstalled the app, "
           "no change. Blocks my daily standup.",
           "noah.berg@atko.email", "Software"),
]


def list_seeds() -> List[Ticket]:
    return list(_SEEDS)


def generate_ticket(seed_index: int) -> Ticket:
    """Return a seed ticket by index (wraps around)."""
    return _SEEDS[seed_index % len(_SEEDS)]


def ticket_ids() -> List[str]:
    return [t.id for t in _SEEDS]
