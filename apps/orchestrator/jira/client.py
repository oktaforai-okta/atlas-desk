"""Jira Cloud REST v3 client (Basic auth: email:api_token).

Used by the Resolution Agent (Half 1) after it retrieves the credential from the
OPA vault. Also used by setup tooling to create the ITSD project + components.
"""
from __future__ import annotations

import base64
from typing import List, Optional

import httpx


def _basic(email: str, token: str) -> str:
    return "Basic " + base64.b64encode(f"{email}:{token}".encode()).decode()


class JiraClient:
    def __init__(self, base_url: str, email: str, api_token: str):
        self.base = base_url.rstrip("/")
        self.h = {"Authorization": _basic(email, api_token),
                  "Accept": "application/json", "Content-Type": "application/json"}
        self._c = httpx.Client(timeout=30, headers=self.h)

    # --- identity / setup ---
    def myself(self) -> dict:
        return self._c.get(f"{self.base}/rest/api/3/myself").json()

    def ensure_project(self, key: str, name: str, lead_account_id: str) -> dict:
        r = self._c.get(f"{self.base}/rest/api/3/project/{key}")
        if r.status_code == 200:
            return r.json()
        body = {"key": key, "name": name, "projectTypeKey": "software",
                "leadAccountId": lead_account_id,
                "assigneeType": "PROJECT_LEAD"}
        return self._c.post(f"{self.base}/rest/api/3/project", json=body).json()

    def ensure_components(self, project_key: str, names: List[str]) -> List[dict]:
        existing = {c["name"] for c in self.list_components(project_key)}
        out = []
        for n in names:
            if n in existing:
                continue
            r = self._c.post(f"{self.base}/rest/api/3/component",
                             json={"name": n, "project": project_key})
            out.append(r.json())
        return out

    def list_components(self, project_key: str) -> List[dict]:
        r = self._c.get(f"{self.base}/rest/api/3/project/{project_key}/components")
        return r.json() if r.status_code == 200 else []

    # --- issue ops (the Resolution Agent's writes) ---
    def create_issue(self, project_key: str, summary: str, description: str,
                     component: Optional[str] = None, labels: Optional[List[str]] = None,
                     issue_type: str = "Task") -> dict:
        fields = {
            "project": {"key": project_key},
            "summary": summary,
            "issuetype": {"name": issue_type},
            "description": _adf(description),
        }
        if component:
            fields["components"] = [{"name": component}]
        if labels:
            fields["labels"] = labels
        return self._c.post(f"{self.base}/rest/api/3/issue", json={"fields": fields}).json()

    def add_labels(self, issue_key: str, labels: List[str]) -> int:
        body = {"update": {"labels": [{"add": l} for l in labels]}}
        return self._c.put(f"{self.base}/rest/api/3/issue/{issue_key}", json=body).status_code

    def add_comment(self, issue_key: str, text: str) -> dict:
        return self._c.post(f"{self.base}/rest/api/3/issue/{issue_key}/comment",
                            json={"body": _adf(text)}).json()


def _adf(text: str) -> dict:
    """Wrap plain text in minimal Atlassian Document Format (required by REST v3)."""
    return {"type": "doc", "version": 1,
            "content": [{"type": "paragraph",
                         "content": [{"type": "text", "text": text}]}]}
