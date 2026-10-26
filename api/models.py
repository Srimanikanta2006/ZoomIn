from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class Role(StrEnum):
    INSTITUTION = "institution"
    SCRUTINY_OFFICER = "scrutiny_officer"
    REGIONAL_OFFICER = "regional_officer"
    ADMIN = "admin"


class ApplicationStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    RETURNED_FOR_CLARIFICATION = "returned_for_clarification"
    COMPLETED = "completed"


class DocumentType(StrEnum):
    APPLICATION_FORM = "application_form"
    LAND_RECORD = "land_record"
    BUILDING_PLAN = "building_plan"
    FACULTY_RECORD = "faculty_record"
    OTHER = "other"


class VerificationStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    VERIFIED = "verified"
    DISCREPANCY = "discrepancy"
    INCONCLUSIVE = "inconclusive"
    UNABLE_TO_VERIFY = "unable_to_verify"


class VerificationCheckRecord(Model):
    id: UUID
    application_id: UUID
    document_id: UUID
    source: str
    checked_at: datetime
    status: VerificationStatus
    result: dict[str, JsonValue]
    requires_manual_review: bool


class FindingSeverity(StrEnum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class FindingStatus(StrEnum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class ReviewAction(StrEnum):
    ACCEPT = "accept"
    DISMISS = "dismiss"
    REQUEST = "request"


class Institution(Model):
    id: UUID
    institution_code: str
    name: str
    institution_type: str
    state: str
    district: str
    created_at: datetime


class Application(Model):
    id: UUID
    institution_id: UUID
    application_number: str
    application_type: str
    academic_year: str
    status: ApplicationStatus
    submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class Document(Model):
    id: UUID
    application_id: UUID
    document_type: DocumentType
    file_name: str
    storage_path: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    mime_type: str
    page_count: int | None
    uploaded_at: datetime
    metadata: dict[str, JsonValue]


class ExtractedField(Model):
    id: UUID
    application_id: UUID
    document_id: UUID
    field_key: str
    field_value: JsonValue
    page: int | None
    bbox: JsonValue | None
    confidence: Decimal | None = Field(default=None, ge=0, le=1)
    extractor: str
    created_at: datetime


class Claim(Model):
    id: UUID
    application_id: UUID
    document_id: UUID | None
    field_key: str
    claim_value: JsonValue
    source: str
    created_at: datetime


class ClaimLedgerStatus(StrEnum):
    SUPPORTED = "Supported"
    CONTRADICTED = "Contradicted"
    UNSUPPORTED = "Unsupported"
    EXPIRED = "Expired"


class FindingDocument(Model):
    document_id: UUID
    name: str


class FindingEvidence(Model):
    page: int | None
    bbox: tuple[float, float, float, float] | None
    extracted: str


class Finding(Model):
    """Shared finding payload emitted by every validation module."""

    finding_id: UUID
    application_id: UUID
    type: str
    severity: FindingSeverity
    document: FindingDocument
    evidence: FindingEvidence
    rule_id: str
    reason: str
    confidence: float = Field(ge=0, le=1)
    status: FindingStatus


class Verification(Model):
    id: UUID
    application_id: UUID
    document_id: UUID | None
    finding_id: UUID | None
    verification_type: str
    source: str
    checked_at: datetime
    status: VerificationStatus
    result: dict[str, JsonValue]
    requires_manual_review: bool
    verifier_id: UUID | None
    remarks: str
    verified_at: datetime | None
    created_at: datetime


class Review(Model):
    id: UUID
    application_id: UUID
    finding_id: UUID | None
    reviewer_id: UUID
    action: ReviewAction
    remarks: str = Field(min_length=1)
    created_at: datetime


class GraphEdge(Model):
    id: UUID
    application_id: UUID
    source_type: str
    source_id: UUID
    target_type: str
    target_id: UUID
    edge_type: str
    weight: Decimal | None = Field(default=None, ge=0, le=1)
    metadata: dict[str, JsonValue]
    created_at: datetime


class AuditLogEntry(Model):
    id: int
    actor_id: UUID | None
    action: str
    entity_type: str
    entity_id: str | None
    occurred_at: datetime
    details: dict[str, JsonValue]
    prev_hash: str | None
    hash: str = Field(pattern=r"^[0-9a-f]{64}$")
