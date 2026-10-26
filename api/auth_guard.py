from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from uuid import UUID

from fastapi import HTTPException


def _supabase_request(url: str, authorization: str, anon_key: str) -> dict | list:
    request = urllib.request.Request(
        url,
        headers={
            "apikey": anon_key,
            "Authorization": authorization,
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 401, 403):
            raise HTTPException(status_code=401, detail="Authentication is invalid or expired.") from None
        raise HTTPException(status_code=503, detail="Authentication could not be verified.") from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Authentication could not be verified.") from None


def get_user_claims(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")
    if not authorization.removeprefix("Bearer ").strip():
        raise HTTPException(status_code=401, detail="Authentication required.")

    supabase_url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not supabase_url or not anon_key:
        raise HTTPException(status_code=503, detail="Authentication is unavailable; configure Supabase.")

    user = _supabase_request(
        f"{supabase_url.rstrip('/')}/auth/v1/user",
        authorization,
        anon_key,
    )
    if not isinstance(user, dict) or not isinstance(user.get("id"), str):
        raise HTTPException(status_code=401, detail="Authentication is invalid or expired.")

    query = urllib.parse.urlencode(
        {"id": f"eq.{user['id']}", "select": "role", "limit": "1"}
    )
    profiles = _supabase_request(
        f"{supabase_url.rstrip('/')}/rest/v1/profiles?{query}",
        authorization,
        anon_key,
    )
    if not isinstance(profiles, list):
        raise HTTPException(status_code=503, detail="The account role could not be verified.")
    role = profiles[0].get("role") if profiles and isinstance(profiles[0], dict) else None
    return {"id": user["id"], "app_metadata": user.get("app_metadata", {}), "role": role}


def extract_user_role(authorization: str | None) -> str:
    claims = get_user_claims(authorization)
    role = claims.get("role")
    if role == "institution":
        return "applicant"
    if role in {"applicant", "scrutiny_officer", "regional_officer", "admin"}:
        return str(role)
    raise HTTPException(status_code=403, detail="Your account has no assigned PreFlight role.")


def require_role(authorization: str | None, allowed_roles: set[str]) -> str:
    role = extract_user_role(authorization)
    if role not in allowed_roles:
        raise HTTPException(
            status_code=403,
            detail=f"Access denied: this endpoint requires {sorted(allowed_roles)}.",
        )
    return role


def require_application_access(authorization: str | None, application_id: str) -> None:
    try:
        parsed_id = UUID(application_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid application id.") from None

    supabase_url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not supabase_url or not anon_key or not authorization:
        raise HTTPException(status_code=503, detail="Application access could not be verified.")
    query = urllib.parse.urlencode(
        {"id": f"eq.{parsed_id}", "select": "id", "limit": "1"}
    )
    applications = _supabase_request(
        f"{supabase_url.rstrip('/')}/rest/v1/applications?{query}",
        authorization,
        anon_key,
    )
    if not isinstance(applications, list):
        raise HTTPException(status_code=503, detail="Application access could not be verified.")
    if not applications:
        raise HTTPException(status_code=404, detail="Application not found or not accessible.")
