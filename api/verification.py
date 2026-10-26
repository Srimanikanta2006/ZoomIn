"""Synthetic mock issuer routes and local QR / CCA PDF verification."""
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pymupdf
import yaml
from fastapi import APIRouter, Header
from pydantic import BaseModel, ConfigDict, Field

from .audit import append_verification_check
from .auth_guard import require_application_access, require_role
from .demo import issuer_outage_enabled
from .models import VerificationStatus


router = APIRouter()
ROOT = Path(__file__).resolve().parent
ISSUER_CONFIG = ROOT / "rules" / "mock_issuers.yaml"
TRUST_STORE = ROOT / "trust_store"
MANUAL_STATUSES = {
    VerificationStatus.NOT_STARTED,
    VerificationStatus.IN_PROGRESS,
    VerificationStatus.DISCREPANCY,
    VerificationStatus.INCONCLUSIVE,
    VerificationStatus.UNABLE_TO_VERIFY,
}


class CheckModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MockIssuerRequest(CheckModel):
    application_id: UUID
    document_id: UUID
    document_name: str = Field(min_length=1, max_length=255)
    reference_number: str = Field(min_length=1, max_length=200)
    latency_ms: int | None = Field(default=None, ge=0, le=30000)
    simulate_status: VerificationStatus | None = None


class PdfCheckRequest(CheckModel):
    application_id: UUID
    document_id: UUID
    document_name: str = Field(min_length=1, max_length=255)
    pdf_base64: str = Field(min_length=1, max_length=20_000_000)


class VerificationCheck(CheckModel):
    id: UUID
    application_id: UUID
    document_id: UUID
    document_name: str
    source: str
    checked_at: datetime
    status: VerificationStatus
    result: dict[str, Any]
    requires_manual_review: bool


class DemoStatus(CheckModel):
    status: VerificationStatus
    source: str
    result: dict[str, Any]
    requires_manual_review: bool


def load_issuer_config() -> dict[str, Any]:
    with ISSUER_CONFIG.open(encoding="utf-8") as stream:
        return yaml.safe_load(stream)


def _check_result(
    *, application_id: UUID, document_id: UUID, document_name: str,
    source: str, status: VerificationStatus, reason: str, result: dict[str, Any],
) -> VerificationCheck:
    result_payload = {"reason": reason, **result}
    return VerificationCheck(
        id=uuid4(),
        application_id=application_id,
        document_id=document_id,
        document_name=document_name,
        source=source,
        checked_at=datetime.now(timezone.utc),
        status=status,
        result=result_payload,
        requires_manual_review=status in MANUAL_STATUSES,
    )


def _record(check: VerificationCheck, authorization: str | None) -> VerificationCheck:
    persisted_id = append_verification_check(
        authorization,
        {
            "application_id": str(check.application_id),
            "document_id": str(check.document_id),
            "source": check.source,
            "checked_at": check.checked_at.isoformat(),
            "status": check.status.value,
            "result": check.result,
            "requires_manual_review": check.requires_manual_review,
        },
    )
    try:
        return check.model_copy(update={"id": UUID(persisted_id)})
    except ValueError:
        return check


def _decode_pdf(encoded: str) -> bytes:
    try:
        return base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        return b""


def _decode_qr(pdf_bytes: bytes) -> tuple[str | None, int | None, list[float] | None, str | None]:
    if not pdf_bytes:
        return None, None, None, "The PDF data could not be read."
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None, None, None, "QR decoding is unavailable on this server."
    try:
        detector = cv2.QRCodeDetector()
        with pymupdf.open(stream=pdf_bytes, filetype="pdf") as pdf:
            for page_number, page in enumerate(pdf, start=1):
                scale = 2.0
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
                image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
                image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
                payload, points, _straight = detector.detectAndDecode(image)
                if payload and points is not None:
                    corners = points.reshape(-1, 2)
                    bbox = [
                        round(float(corners[:, 0].min() / scale), 2),
                        round(float(corners[:, 1].min() / scale), 2),
                        round(float(corners[:, 0].max() / scale), 2),
                        round(float(corners[:, 1].max() / scale), 2),
                    ]
                    return payload, page_number, bbox, None
    except Exception:
        return None, None, None, "The PDF or QR image could not be read."
    return None, None, None, "No readable QR code was found."


@router.get("/verification/demo-statuses", response_model=list[DemoStatus])
def demo_statuses() -> list[DemoStatus]:
    config = load_issuer_config()
    descriptions = config["status_reasons"]
    return [
        DemoStatus(
            status=status,
            source="Demo status guide",
            result={"reason": descriptions[status.value]},
            requires_manual_review=status in MANUAL_STATUSES,
        )
        for status in VerificationStatus
    ]


@router.post("/mock-issuers/{issuer}/verify", response_model=VerificationCheck)
async def mock_issuer_verify(
    issuer: str,
    body: MockIssuerRequest,
    authorization: str | None = Header(default=None),
) -> VerificationCheck:
    require_role(authorization, {"scrutiny_officer", "regional_officer", "admin"})
    require_application_access(authorization, str(body.application_id))
    config = load_issuer_config()
    issuer_config = config.get("issuers", {}).get(issuer)
    environment_delay = os.getenv("MOCK_ISSUER_LATENCY_MS")
    latency = body.latency_ms if body.latency_ms is not None else int(environment_delay) if environment_delay else int(config["default_latency_ms"])
    await asyncio.sleep(max(0, min(latency, 30000)) / 1000)

    environment_status = os.getenv("MOCK_ISSUER_FAILURE_STATUS") or config.get("default_failure_status")
    outage = issuer_outage_enabled()
    injected = body.simulate_status or (VerificationStatus(environment_status) if environment_status else None)
    if outage:
        status = VerificationStatus.UNABLE_TO_VERIFY
        reason = "The demo issuer is unavailable. This check needs human verification when the source returns."
        result = {"matched": False, "simulated": True, "outage": True}
    elif injected is not None:
        status = injected
        reason = config["status_reasons"][status.value]
        result = {"matched": status == VerificationStatus.VERIFIED, "simulated": True}
    elif issuer_config is None:
        status = VerificationStatus.UNABLE_TO_VERIFY
        reason = f"Issuer '{issuer}' is not available in the local demo. Human review is required."
        result = {"matched": False, "simulated": False}
    else:
        raw_status = issuer_config.get("records", {}).get(body.reference_number)
        status = VerificationStatus(raw_status) if raw_status else VerificationStatus.INCONCLUSIVE
        reason = config["status_reasons"][status.value] if raw_status else "The reference number is not in the synthetic issuer registry. Human review is required."
        result = {"matched": status == VerificationStatus.VERIFIED, "simulated": False}

    check = _check_result(
        application_id=body.application_id,
        document_id=body.document_id,
        document_name=body.document_name,
        source=f"mock_issuer:{issuer}",
        status=status,
        reason=reason,
        result=result,
    )
    return await asyncio.to_thread(_record, check, authorization)


@router.post("/verifications/qr", response_model=VerificationCheck)
async def verify_qr(
    body: PdfCheckRequest,
    authorization: str | None = Header(default=None),
) -> VerificationCheck:
    require_role(authorization, {"scrutiny_officer", "regional_officer", "admin"})
    require_application_access(authorization, str(body.application_id))
    payload, page, bbox, error = _decode_qr(_decode_pdf(body.pdf_base64))
    if payload:
        status = VerificationStatus.VERIFIED
        reason = "A QR code was decoded from the PDF. Compare its contents with the document fields."
        result = {"decoded": True, "payload": payload, "page": page, "bbox": bbox}
    else:
        status = VerificationStatus.UNABLE_TO_VERIFY
        reason = (error or "QR decoding was unsuccessful.") + " Human review is required."
        result = {"decoded": False, "page": page, "bbox": bbox}
    check = _check_result(
        application_id=body.application_id, document_id=body.document_id, document_name=body.document_name,
        source="local_qr_decoder", status=status, reason=reason, result=result,
    )
    return await asyncio.to_thread(_record, check, authorization)


@router.post("/verifications/signature", response_model=VerificationCheck)
def verify_pdf_signature(
    body: PdfCheckRequest,
    authorization: str | None = Header(default=None),
) -> VerificationCheck:
    require_role(authorization, {"scrutiny_officer", "regional_officer", "admin"})
    require_application_access(authorization, str(body.application_id))
    pdf_bytes = _decode_pdf(body.pdf_base64)
    source = "pyhanko_cca_local_trust_store"
    try:
        from pyhanko.keys import load_certs_from_pemder
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.sign.validation import SignatureCoverageLevel, validate_pdf_signature as validate_signature
        from pyhanko_certvalidator import ValidationContext

        root_files = sorted(TRUST_STORE.glob("cca_india_2022*.cer"))
        trust_roots = load_certs_from_pemder([str(path) for path in root_files]) if root_files else []
        if not trust_roots:
            raise RuntimeError("CCA roots are not installed")
        with __import__("io").BytesIO(pdf_bytes) as stream:
            reader = PdfFileReader(stream)
            signatures = reader.embedded_signatures
            if not signatures:
                status = VerificationStatus.UNABLE_TO_VERIFY
                reason = "This PDF has no embedded digital signature. Human review is required."
                result = {"signature_count": 0, "integrity": None, "trusted_by_cca": False}
            else:
                validation_context = ValidationContext(
                    trust_roots=trust_roots,
                    allow_fetching=False,
                    revocation_mode="soft-fail",
                )
                summaries = []
                for signature in signatures:
                    checked = validate_signature(signature, signer_validation_context=validation_context)
                    full_coverage = checked.coverage == SignatureCoverageLevel.ENTIRE_FILE
                    summaries.append({
                        "intact": bool(checked.intact),
                        "valid": bool(checked.valid),
                        "trusted_by_cca": bool(checked.trusted),
                        "covers_file": full_coverage,
                    })
                all_intact = all(summary["intact"] and summary["valid"] for summary in summaries)
                all_trusted = all(summary["trusted_by_cca"] for summary in summaries)
                all_cover = all(summary["covers_file"] for summary in summaries)
                revocation_unknown = bool(getattr(validation_context, "soft_fail_exceptions", []))
                if not all_intact or not all_cover:
                    status = VerificationStatus.DISCREPANCY
                    reason = "The signature or signed PDF content did not validate. Human review is required."
                elif not all_trusted or revocation_unknown:
                    status = VerificationStatus.INCONCLUSIVE
                    reason = "The signature did not complete CCA trust or revocation checks. Human review is required."
                else:
                    status = VerificationStatus.VERIFIED
                    reason = "The signature, PDF coverage, and signer chain validated against the local CCA roots."
                result = {"signature_count": len(signatures), "signatures": summaries, "revocation_confirmed": not revocation_unknown}
    except Exception:
        status = VerificationStatus.UNABLE_TO_VERIFY
        reason = "The PDF signature could not be checked with the local CCA trust store. Human review is required."
        result = {"signature_count": 0, "integrity": None, "trusted_by_cca": False}

    check = _check_result(
        application_id=body.application_id, document_id=body.document_id, document_name=body.document_name,
        source=source, status=status, reason=reason, result=result,
    )
    return _record(check, authorization)
