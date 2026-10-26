"""Supabase-backed append-only verification event writer."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from fastapi import HTTPException


def append_verification_check(authorization: str | None, check: dict[str, Any]) -> str:
    url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not url or not anon_key or not authorization:
        raise HTTPException(status_code=503, detail="Verification record is unavailable; sign in and configure Supabase.")

    result = dict(check["result"])
    payload = result.pop("payload", None)
    if payload is not None:
        import hashlib
        result["payload_sha256"] = hashlib.sha256(str(payload).encode("utf-8")).hexdigest()
    request = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/rpc/append_verification_check",
        data=json.dumps({"p_check": {**check, "result": result}}).encode("utf-8"),
        headers={"apikey": anon_key, "Authorization": authorization, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            returned = json.loads(response.read().decode("utf-8"))
            return str(returned)
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Verification result could not be recorded (HTTP {exc.code}).") from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Verification result could not be recorded.") from None


def append_graph_audit(authorization: str | None, details: dict[str, Any]) -> None:
    """Record graph access using the officer-scoped, hash-chained RPC."""
    url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not url or not anon_key or not authorization:
        raise HTTPException(status_code=503, detail="Graph access is unavailable; sign in and configure Supabase.")
    request = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/rpc/append_graph_audit",
        data=json.dumps({"p_details": details}).encode("utf-8"),
        headers={"apikey": anon_key, "Authorization": authorization, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8):
            return
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Graph access could not be recorded (HTTP {exc.code}).") from None
    except urllib.error.URLError:
        raise HTTPException(status_code=503, detail="Graph access could not be recorded.") from None


def append_workspace_view(authorization: str | None, page: str) -> None:
    """Append an access event for a role-scoped workspace."""
    url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not url or not anon_key or not authorization:
        raise HTTPException(status_code=503, detail="Workspace access is unavailable; sign in and configure Supabase.")
    request = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/rpc/append_workspace_view",
        data=json.dumps({"p_page": page, "p_application_id": None}).encode("utf-8"),
        headers={"apikey": anon_key, "Authorization": authorization, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8):
            return
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise HTTPException(status_code=403, detail="This workspace is not available for your role.") from None
        raise HTTPException(status_code=503, detail=f"Workspace access could not be recorded (HTTP {exc.code}).") from None
    except urllib.error.URLError:
        raise HTTPException(status_code=503, detail="Workspace access could not be recorded.") from None


def append_demo_action(authorization: str | None, action: str, details: dict[str, Any]) -> None:
    """Record demo controls through the hash-chained audit RPC."""
    url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not url or not anon_key or not authorization:
        raise HTTPException(status_code=503, detail="Demo action could not be audited; sign in and configure Supabase.")
    request = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/rpc/append_demo_action",
        data=json.dumps({"p_action": action, "p_details": details}).encode("utf-8"),
        headers={"apikey": anon_key, "Authorization": authorization, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8):
            return
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=403 if exc.code in (401, 403) else 503, detail="Demo action could not be audited.") from None
    except urllib.error.URLError:
        raise HTTPException(status_code=503, detail="Demo action could not be audited.") from None
