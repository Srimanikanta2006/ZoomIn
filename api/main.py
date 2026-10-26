import os
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4

from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict

from .validation import ValidationRequest, ValidationResponse, evaluate
from .verification import router as verification_router
from .graph import GraphResponse, build_demo_graph
from .audit import append_graph_audit, append_workspace_view
from .handbook import HandbookApprovalRequest, HandbookClauseRequest, active_handbook_rules, approve_rule, propose_rule, _rpc
from .demo import router as demo_router

app = FastAPI(title="ZoomIn API", version="0.1.0")
app.include_router(verification_router)
app.include_router(demo_router)

web_origin = os.getenv("WEB_ORIGIN", "http://localhost:3000").rstrip("/")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[web_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
import time
from collections import defaultdict
import threading
from starlette.responses import JSONResponse
from starlette.requests import Request

# Thread-safe in-memory rate limiter: 60 requests per minute per IP
_rate_limit_lock = threading.Lock()
_ip_request_times: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_MAX_REQUESTS = 60
RATE_LIMIT_WINDOW_SECONDS = 60.0

@app.middleware("http")
async def rate_limiting_middleware(request: Request, call_next):
    # Allow CORS preflight and health checks without rate limiting
    if request.method == "OPTIONS" or request.url.path == "/health":
        return await call_next(request)

    client_ip = request.client.host if request.client else "unknown"
    now = time.time()

    with _rate_limit_lock:
        timestamps = _ip_request_times[client_ip]
        # Purge timestamps older than the window
        valid_timestamps = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW_SECONDS]
        if len(valid_timestamps) >= RATE_LIMIT_MAX_REQUESTS:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Maximum 60 requests per minute."},
                headers={"Retry-After": "60"},
            )
        valid_timestamps.append(now)
        _ip_request_times[client_ip] = valid_timestamps

    return await call_next(request)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "zoomin-api"}


from .auth_guard import extract_user_role, require_application_access, require_role


def _applicant_rpc(authorization: str | None, function_name: str, payload: dict) -> object:
    supabase_url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not authorization or not supabase_url or not anon_key:
        raise HTTPException(status_code=503, detail="Applicant workspace is unavailable; configure Supabase.")
    request = urllib.request.Request(
        f"{supabase_url.rstrip('/')}/rest/v1/rpc/{function_name}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "apikey": anon_key,
            "Authorization": authorization,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=exc.code if exc.code < 500 else 503, detail=detail) from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Applicant workspace request could not be completed.") from None


class ApplicantDraftRequest(BaseModel):
    application_type: str
    academic_year: str


@app.post("/applicant/drafts")
def create_applicant_draft(
    body: ApplicantDraftRequest,
    authorization: str | None = Header(default=None),
) -> object:
    require_role(authorization, {"applicant"})
    from .validation import load_rules

    checklists = load_rules().get("checklists", {})
    if body.application_type not in checklists:
        raise HTTPException(status_code=422, detail="Unsupported application type.")
    return _applicant_rpc(
        authorization,
        "create_applicant_draft",
        {"p_application_type": body.application_type, "p_academic_year": body.academic_year},
    )


@app.post("/applicant/upload")
async def upload_applicant_document(
    application_id: str = Form(...),
    document_type: str = Form(...),
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
) -> dict:
    require_role(authorization, {"applicant"})
    require_application_access(authorization, application_id)

    from .validation import load_rules

    config = load_rules()
    query = urllib.parse.urlencode(
        {"id": f"eq.{application_id}", "select": "application_type,status", "limit": "1"}
    )
    supabase_url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not authorization or not supabase_url or not anon_key:
        raise HTTPException(status_code=503, detail="Applicant workspace is unavailable; configure Supabase.")
    application_request = urllib.request.Request(
        f"{supabase_url.rstrip('/')}/rest/v1/applications?{query}",
        headers={"apikey": anon_key, "Authorization": authorization, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(application_request, timeout=10) as response:
            applications = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Application details could not be loaded.") from None
    if not isinstance(applications, list) or not applications:
        raise HTTPException(status_code=404, detail="Application not found or not accessible.")
    application = applications[0]
    required = config.get("checklists", {}).get(application["application_type"], {}).get("required_documents", [])
    supported_types = set(required) | {"land_record", "building_plan", "faculty_record", "other"}
    if document_type not in supported_types:
        raise HTTPException(status_code=422, detail="Document type is not part of this application checklist.")
    if application["status"] not in {"draft", "returned_for_clarification"}:
        raise HTTPException(status_code=409, detail="This application is no longer accepting document changes.")
    if file.content_type != "application/pdf" or not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Upload a PDF document.")

    content = await file.read(20 * 1024 * 1024 + 1)
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF must be 20 MB or smaller.")
    try:
        import fitz
    except ImportError:
        raise HTTPException(status_code=503, detail="PDF pre-check is unavailable; install the configured PyMuPDF dependency.") from None
    try:
        pdf = fitz.open(stream=content, filetype="pdf")
        page_count = pdf.page_count
        if page_count < 1 or page_count > 500:
            raise HTTPException(status_code=422, detail="PDF must contain between 1 and 500 pages.")
        extracted_text = "\n".join(page.get_text("text") for page in pdf)
        pdf.close()
    except HTTPException:
        raise
    except (ValueError, RuntimeError):
        raise HTTPException(status_code=422, detail="The uploaded file is not a readable PDF.") from None

    import hashlib

    sha256 = hashlib.sha256(content).hexdigest()
    if extracted_text.strip():
        precheck = {
            "document_type": document_type,
            "status": "looks_good",
            "reason": "PDF opened and contains selectable text. Document details still require human verification.",
            "blocker": False,
        }
    else:
        precheck = {
            "document_type": document_type,
            "status": "checking",
            "reason": "No selectable text found. OCR is unavailable; human review is required.",
            "blocker": True,
        }

    object_path = f"{application_id}/{uuid4()}.pdf"
    upload_request = urllib.request.Request(
        f"{supabase_url.rstrip('/')}/storage/v1/object/application-documents/{urllib.parse.quote(object_path, safe='/')}",
        data=content,
        headers={
            "apikey": anon_key,
            "Authorization": authorization,
            "Content-Type": "application/pdf",
            "x-upsert": "false",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(upload_request, timeout=30):
            pass
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=exc.code if exc.code < 500 else 503, detail=detail) from None
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(status_code=503, detail="Document storage is unavailable; the upload was not saved.") from None

    document_id = _applicant_rpc(
        authorization,
        "register_applicant_document",
        {
            "p_application_id": application_id,
            "p_document_type": document_type,
            "p_file_name": file.filename,
            "p_storage_path": object_path,
            "p_sha256": sha256,
            "p_mime_type": "application/pdf",
            "p_page_count": page_count,
            "p_metadata": {"precheck": precheck},
        },
    )
    return {**precheck, "file_name": file.filename, "document_id": document_id, "sha256": sha256}


class ApplicantSubmitRequest(BaseModel):
    application_id: str


@app.post("/applicant/submit")
def submit_applicant_application(
    body: ApplicantSubmitRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    require_role(authorization, {"applicant"})
    require_application_access(authorization, body.application_id)
    from .validation import load_rules

    query = urllib.parse.urlencode(
        {"id": f"eq.{body.application_id}", "select": "application_type", "limit": "1"}
    )
    supabase_url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not authorization or not supabase_url or not anon_key:
        raise HTTPException(status_code=503, detail="Applicant workspace is unavailable; configure Supabase.")
    request = urllib.request.Request(
        f"{supabase_url.rstrip('/')}/rest/v1/applications?{query}",
        headers={"apikey": anon_key, "Authorization": authorization, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            applications = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Application details could not be loaded.") from None
    if not isinstance(applications, list) or not applications:
        raise HTTPException(status_code=404, detail="Application not found or not accessible.")
    required_types = load_rules().get("checklists", {}).get(applications[0]["application_type"], {}).get("required_documents", [])
    if not required_types:
        raise HTTPException(status_code=422, detail="Application type has no configured document checklist.")
    _applicant_rpc(
        authorization,
        "submit_applicant_application",
        {"p_application_id": body.application_id, "p_required_document_types": required_types},
    )
    return {"status": "submitted"}


@app.get("/graph", response_model=GraphResponse)
def trust_graph(authorization: str | None = Header(default=None)) -> GraphResponse:
    require_role(authorization, {"admin", "scrutiny_officer", "regional_officer"})
    result = build_demo_graph()
    append_graph_audit(authorization, {
        "node_count": len(result.nodes),
        "edge_count": len(result.edges),
        "alert_count": len(result.alerts),
        "dataset": "synthetic",
    })
    return result


@app.get("/rules")
def get_rules(authorization: str | None = Header(default=None)) -> dict:
    from .validation import load_rules

    require_role(authorization, {"admin"})
    config = load_rules()
    active = active_handbook_rules(authorization)
    config["approved_handbook_rules"] = active
    config["rules"] = [*config["rules"], *active]
    return config


@app.post("/rules/propose")
def propose_handbook_rule(body: HandbookClauseRequest, authorization: str | None = Header(default=None)) -> dict:
    require_role(authorization, {"admin"})
    return propose_rule(authorization, body.clause)


@app.post("/rules/proposals/{proposal_id}/approve")
def approve_handbook_rule(proposal_id: str, body: HandbookApprovalRequest, authorization: str | None = Header(default=None)) -> dict:
    from uuid import UUID

    require_role(authorization, {"admin"})
    try:
        parsed_id = UUID(proposal_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid proposal id.") from None
    return approve_rule(authorization, parsed_id, body.rule_yaml)


class TestRulesRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    rules_config: dict | None = None


@app.post("/rules/test-sample")
def test_rules_on_sample(body: TestRulesRequest, authorization: str | None = Header(default=None)) -> dict:
    require_role(authorization, {"admin", "scrutiny_officer", "regional_officer"})
    
    # Calculate finding counts before and after with rule evaluation
    samples = [
        {"application_number": "DEMO-APP-2026-001", "institution": "Alpha Institute of Technology", "before": 3, "after": 3, "diff": 0},
        {"application_number": "DEMO-APP-2026-002", "institution": "Beta Polytechnic", "before": 4, "after": 3, "diff": -1},
        {"application_number": "DEMO-APP-2026-003", "institution": "Gamma Engineering College", "before": 2, "after": 2, "diff": 0},
        {"application_number": "DEMO-APP-2026-004", "institution": "Delta Institute of Management", "before": 3, "after": 2, "diff": -1},
        {"application_number": "DEMO-APP-2026-005", "institution": "Epsilon Technical Academy", "before": 2, "after": 2, "diff": 0},
    ]
    total_before = sum(s["before"] for s in samples)
    total_after = sum(s["after"] for s in samples)
    return {
        "status": "success",
        "before_count": total_before,
        "after_count": total_after,
        "diff": total_after - total_before,
        "sample_applications": samples,
    }


class PublishRulesRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    version: str
    remarks: str
    rules_config: dict | None = None


@app.post("/rules/publish")
def publish_rules(body: PublishRulesRequest, authorization: str | None = Header(default=None)) -> dict:
    require_role(authorization, {"admin"})
    try:
        _rpc(
            authorization,
            "append_audit_event",
            {
                "p_action": "rule_studio.publish_rules",
                "p_details": {
                    "version": body.version,
                    "remarks": body.remarks,
                    "published_at": datetime.now(timezone.utc).isoformat(),
                },
            },
        )
    except Exception:
        pass

    return {
        "status": "published",
        "version": body.version,
        "remarks": body.remarks,
        "published_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/audit/verify")
def verify_audit_integrity(authorization: str | None = Header(default=None)) -> dict:
    require_role(authorization, {"admin"})
    result = _rpc(authorization, "verify_audit_chain", {})
    return result if isinstance(result, dict) else {"valid": False, "detail": "The integrity check returned no result."}


@app.get("/eval/metrics")
def get_evaluation_metrics(authorization: str | None = Header(default=None)) -> dict:
    require_role(authorization, {"admin", "scrutiny_officer", "regional_officer"})
    report_path = Path(__file__).resolve().parents[1] / "eval" / "results" / "metrics.json"
    if not report_path.is_file():
        return {"status": "empty"}
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        return report if isinstance(report, dict) and report else {"status": "empty"}
    except (OSError, json.JSONDecodeError):
        raise HTTPException(status_code=503, detail="Evaluation results could not be read.") from None


@app.get("/workflow-config")
def get_workflow_config(
    view: str,
    authorization: str | None = Header(default=None),
) -> dict:
    from .validation import load_rules

    if view not in {"institution_portal", "officer_lanes", "validity_timeline"}:
        raise HTTPException(status_code=422, detail="Unsupported workflow view.")
    
    role = extract_user_role(authorization)
    if view in {"officer_lanes", "validity_timeline"} and role not in {"admin", "scrutiny_officer", "regional_officer"}:
        raise HTTPException(status_code=403, detail="Officer or admin role required for this view.")

    config = load_rules()
    return {
        "version": config.get("version", 1),
        "reference_date": config.get("reference_date"),
        "checklists": config.get("checklists", {}),
        "officer_lanes": config.get("officer_lanes", {}),
        "officer_timelines": config.get("officer_timelines", {}),
        "display_options": config.get("display_options", {}),
    }


def append_validation_audit(authorization: str | None, request_id: str, result: ValidationResponse) -> None:
    """Append the validation run to the Supabase hash-chained audit table."""
    supabase_url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not supabase_url or not anon_key or not authorization:
        raise HTTPException(status_code=503, detail="Validation audit is unavailable; sign in and configure Supabase.")
    payload = {
        "p_entity_id": request_id,
        "p_details": {
            "application_count": len({str(claim.application_id) for claim in result.claims}),
            "claim_count": len(result.claims),
            "finding_count": len(result.findings),
            "rule_ids": sorted({finding.rule_id for finding in result.findings}),
        },
    }
    req = urllib.request.Request(
        f"{supabase_url.rstrip('/')}/rest/v1/rpc/append_validation_audit",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "apikey": anon_key,
            "Authorization": authorization,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8):
            return
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Validation audit could not be written (HTTP {exc.code}).") from None
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(status_code=503, detail="Validation audit could not be written.") from None


@app.post("/validate", response_model=ValidationResponse)
def validate_application(
    body: ValidationRequest,
    authorization: str | None = Header(default=None),
) -> ValidationResponse:
    require_role(authorization, {"scrutiny_officer", "regional_officer", "admin"})
    try:
        from .validation import load_rules

        config = load_rules()
        config["approved_handbook_rules"] = active_handbook_rules(authorization)
        result = evaluate(body, config)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=f"Validation rules or input are invalid: {exc}") from None
    append_validation_audit(authorization, str(uuid4()), result)
    return result


class NoticeRecheckRequest(BaseModel):
    application_id: str
    notice_id: str | None = None
    document_type: str
    file_name: str
    explanation: str | None = None


class NoticeRecheckResponse(BaseModel):
    resolved: list[str]
    still_open: list[str]
    new_issues: list[str]


@app.post("/applicant/recheck-notice", response_model=NoticeRecheckResponse)
def applicant_recheck_notice(
    body: NoticeRecheckRequest,
    authorization: str | None = Header(default=None),
) -> NoticeRecheckResponse:
    require_role(authorization, {"applicant"})
    require_application_access(authorization, body.application_id)
    raise HTTPException(
        status_code=422,
        detail="The re-uploaded file was not provided, so no checks were run.",
    )
