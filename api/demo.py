"""Small, synthetic-only controls for a guided demonstration."""
from __future__ import annotations

import json
import os
import threading
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict

from .audit import append_demo_action

router = APIRouter(prefix="/demo", tags=["demo"])
_lock = threading.Lock()
_issuer_outage = False


class OutageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


def issuer_outage_enabled() -> bool:
    with _lock:
        return _issuer_outage


@router.get("/status")
def status() -> dict:
    status_path = Path(__file__).resolve().parents[1] / "data" / "cache" / "demo_status.json"
    degraded = False
    detail = ""
    if status_path.is_file():
        try:
            cached = json.loads(status_path.read_text(encoding="utf-8"))
            degraded = bool(cached.get("llm_degraded"))
            detail = str(cached.get("message", "")) if degraded else ""
        except (OSError, json.JSONDecodeError):
            pass
    with _lock:
        outage = _issuer_outage
    return {"issuer_outage": outage, "llm_degraded": degraded, "llm_message": detail}


from .auth_guard import require_role


def require_demo_mode() -> None:
    if os.getenv("DEMO_MODE", "").lower() != "true":
        raise HTTPException(status_code=404, detail="Demo controls are disabled.")


@router.post("/issuer-outage")
def set_issuer_outage(body: OutageRequest, authorization: str | None = Header(default=None)) -> dict:
    global _issuer_outage
    require_demo_mode()
    require_role(authorization, {"admin"})
    append_demo_action(authorization, "demo.issuer_outage", {"enabled": body.enabled})
    with _lock:
        _issuer_outage = body.enabled
    return {"issuer_outage": body.enabled}


@router.post("/reset")
def reset_demo_state(authorization: str | None = Header(default=None)) -> dict:
    global _issuer_outage
    require_demo_mode()
    require_role(authorization, {"admin"})
    supabase_url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not supabase_url or not anon_key or not authorization:
        raise HTTPException(status_code=503, detail="Demo reset is unavailable; configure Supabase.")
    request = urllib.request.Request(
        f"{supabase_url.rstrip('/')}/rest/v1/rpc/reset_demo_data",
        data=b"{}",
        headers={
            "apikey": anon_key,
            "Authorization": authorization,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        status_code = 403 if exc.code in (401, 403) else 503
        raise HTTPException(status_code=status_code, detail="Demo data could not be reset.") from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Demo data could not be reset.") from None
    with _lock:
        _issuer_outage = False
    return {"status": "ok", "reset": result}
