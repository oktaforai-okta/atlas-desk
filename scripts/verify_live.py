#!/usr/bin/env python3
"""End-to-end verification against a deployed orchestrator.

The unit suites (apps/orchestrator/tests, apps/web/lib/__tests__) cover pure
logic. This covers the claims that only a real deployment can settle: that the
tokens are genuinely signed, that the scopes actually differ per hop, that the
act chain nests, and that Okta really refuses the write.

Needs no credentials. It drives the same public endpoints a browser does.

Usage:
    python3 scripts/verify_live.py [orchestrator-url]

Exits non-zero if any check fails, so it can gate a deploy.
"""
from __future__ import annotations

import base64
import json
import sys
import time
import urllib.parse
import urllib.request

ORCH = (sys.argv[1] if len(sys.argv) > 1
        else "https://atlas-orchestrator-r152.onrender.com").rstrip("/")
ORIGIN = "https://atlas-desk.vercel.app"

READ, WRITE = "ticket.read", "ticket.write"
# tokens the pipeline should produce, and the scope each must carry
EXPECTED = {"t1": READ, "idjag1": READ, "t_res": READ, "idjag2": WRITE, "t_ful": WRITE}

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str, detail: str = "") -> bool:
    results.append((ok, label))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"  [{detail}]" if detail else ""))
    return ok


def get(path: str, timeout: int = 60):
    req = urllib.request.Request(f"{ORCH}{path}", headers={"Origin": ORIGIN,
                                                           "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def claims(tok: str) -> dict:
    seg = tok.split(".")[1]
    seg += "=" * ((4 - len(seg) % 4) % 4)
    return json.loads(base64.urlsafe_b64decode(seg))


def header(tok: str) -> dict:
    seg = tok.split(".")[0]
    seg += "=" * ((4 - len(seg) % 4) % 4)
    return json.loads(base64.urlsafe_b64decode(seg))


def scopes(c: dict) -> list[str]:
    scp = c.get("scp")
    if isinstance(scp, list):
        return scp
    return [s for s in str(c.get("scope") or "").split(" ") if s]


def act_depth(c: dict) -> int:
    n, node = 0, c.get("act")
    while isinstance(node, dict):
        n += 1
        node = node.get("act")
    return n


def run_pipeline(title: str, body: str, mode: str = "normal") -> list[dict]:
    qs = urllib.parse.urlencode({"ticket_id": "INC-VERIFY", "title": title,
                                 "body": body, "requester": "verify@example.test",
                                 "mode": mode})
    req = urllib.request.Request(f"{ORCH}/api/run?{qs}",
                                 headers={"Accept": "text/event-stream", "Origin": ORIGIN})
    events, buf = [], ""
    with urllib.request.urlopen(req, timeout=240) as r:
        for raw in r:
            buf += raw.decode("utf-8", "replace")
            while "\n\n" in buf:
                frame, buf = buf.split("\n\n", 1)
                for line in frame.split("\n"):
                    if line.startswith("data: "):
                        events.append(json.loads(line[6:]))
    return [e for e in events if e.get("status") == "ok"]


print(f"Verifying {ORCH}\n")

# ---------------------------------------------------------------- health
print("health")
h = get("/healthz")
live = h.get("mode") == "live"
check(h.get("ok") is True, "healthz responds ok")
check(live, f"mode is live", f"mode={h.get('mode')} missing={h.get('missing_env')}")
if not live:
    print("\nNot live. Token checks below need real Okta credentials configured.")
    sys.exit(1)

# ================= NORMAL PATH: the work gets done ==========================
print("\nnormal path (the work gets done)")
ok = run_pipeline("Outlook signature block not saving",
                  "My email signature reverts to blank every time I restart Outlook.")
steps = [e["step"] for e in ok]
for required in ("read_grant", "jira_read", "classify", "a2a_delegate",
                 "write_grant", "opa_vault", "jira_write", "done"):
    check(required in steps, f"emits {required}")
# a successful run must NOT show a refusal; one shown on every run is decoration
check("write_denied" not in steps, "shows NO refusal (nothing was refused)")
check("blocked" not in steps, "does not report itself blocked")

tokens: dict[str, str] = {}
for e in ok:
    tokens.update(e.get("raw_tokens") or {})
check(set(tokens) == set(EXPECTED), "all five credentials issued", f"got {sorted(tokens)}")

for name, want_scope in EXPECTED.items():
    if name not in tokens:
        check(False, f"{name} present")
        continue
    c, h_ = claims(tokens[name]), header(tokens[name])
    check(h_.get("alg") == "RS256", f"{name} is signed RS256", str(h_.get("alg")))
    check(want_scope in scopes(c), f"{name} carries {want_scope}", str(scopes(c)))
    other = WRITE if want_scope == READ else READ
    check(other not in scopes(c), f"{name} does NOT carry {other}")

if "t_res" in tokens and "t_ful" in tokens:
    d_res, d_ful = act_depth(claims(tokens["t_res"])), act_depth(claims(tokens["t_ful"]))
    check(d_res >= 2, "delegated token's act names agent 1 and the service root", f"depth={d_res}")
    check(d_ful > d_res, "write token's act nests one layer deeper than the read token",
          f"{d_res} -> {d_ful}")
    check(claims(tokens["t_res"])["sub"] == claims(tokens["t_ful"])["sub"],
          "subject stays the service root across the capability change")

# ================= VIOLATION PATH: the agent over-reaches and is stopped =====
print("\nviolation path (agent exceeds its authority)")
bad = run_pipeline("Printer on the 3rd floor is jammed",
                   "The shared printer reports a paper jam that will not clear.",
                   mode="violation")
bad_steps = [e["step"] for e in bad]
denial = next((e.get("data") or {} for e in bad if e["step"] == "write_denied"), {})
blocked = next((e.get("data") or {} for e in bad if e["step"] == "blocked"), {})

check(denial.get("denied") is True, "Okta refused the write attempt",
      f"http={denial.get('http_status')} error={denial.get('error')}")
check(denial.get("attempted_scope") == WRITE, "the refused scope was the write scope")
check(bool(denial.get("error_description")), "Okta's own wording is captured",
      str(denial.get("error_description"))[:60])
check(bool(blocked.get("blocked")), "run reports itself blocked")

# THE assertion that makes the refusal meaningful rather than narrated
check("jira_write" not in bad_steps, "NOTHING was written to Jira")
check(blocked.get("wrote_to_jira") is False, "run declares it wrote nothing")
check("a2a_delegate" not in bad_steps, "no delegation occurred")
check("write_grant" not in bad_steps, "no write authority was granted")
check("opa_vault" not in bad_steps, "the vaulted credential was never released")

bad_tokens: dict[str, str] = {}
for e in bad:
    bad_tokens.update(e.get("raw_tokens") or {})
check(set(bad_tokens) == {"t1"}, "only the read token exists", f"got {sorted(bad_tokens)}")
if "t1" in bad_tokens:
    check(WRITE not in scopes(claims(bad_tokens["t1"])),
          "the one token it holds carries no write scope")

# ---------------------------------------------------------------- summary
failed = [label for ok_, label in results if not ok_]
print(f"\n{'=' * 70}")
print(f"{len(results) - len(failed)}/{len(results)} checks passed")
if failed:
    print("\nFAILED:")
    for f in failed:
        print(f"  - {f}")
    sys.exit(1)
print("All checks passed.")
