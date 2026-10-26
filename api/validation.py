"""YAML-driven application checks and claim-to-document evidence linking."""
from __future__ import annotations

import re
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

import yaml
from pydantic import BaseModel, ConfigDict, Field

from .models import ClaimLedgerStatus, Finding, FindingDocument, FindingEvidence, FindingSeverity, FindingStatus


RULES_PATH = Path(__file__).resolve().parent / "rules" / "validation.yaml"


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceBox(InputModel):
    page: int | None = Field(default=None, ge=1)
    bbox: tuple[float, float, float, float] | None = None
    word: str | None = None


class FontSpan(InputModel):
    font: str
    text: str
    page: int = Field(ge=1)
    bbox: tuple[float, float, float, float]


class ValidationDocument(InputModel):
    document_id: str
    file_name: str
    document_type: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    fields: dict[str, Any]
    field_boxes: dict[str, list[EvidenceBox]] = Field(default_factory=dict)
    pdf_metadata: dict[str, Any] = Field(default_factory=dict)
    revision_count: int | None = Field(default=None, ge=1)
    signature_present: bool | None = None
    signature_intact: bool | None = None
    signature_covers_file: bool | None = None
    field_font_spans: dict[str, list[FontSpan]] = Field(default_factory=dict)


class ApplicationClaims(InputModel):
    values: dict[str, Any] = Field(default_factory=dict)
    aliases: dict[str, list[str]] = Field(default_factory=dict)


class ValidationApplication(InputModel):
    application_id: UUID
    application_number: str
    institution_id: str
    institution_name: str
    application_type: str
    claims: ApplicationClaims = Field(default_factory=ApplicationClaims)
    documents: list[ValidationDocument]


class ValidationRequest(InputModel):
    applications: list[ValidationApplication] = Field(min_length=1)
    reference_date: date | None = None


ClaimStatus = ClaimLedgerStatus


class ClaimEvidence(InputModel):
    document_id: str
    document_name: str
    field_key: str
    value: Any
    page: int | None
    bbox: tuple[float, float, float, float] | None


class ClaimResult(InputModel):
    claim_id: UUID
    application_id: UUID
    field_key: str
    declared_value: Any
    status: ClaimLedgerStatus
    evidence_fields: list[ClaimEvidence]
    finding: Finding


class ValidationResponse(InputModel):
    findings: list[Finding]
    claims: list[ClaimResult]


def load_rules(path: Path = RULES_PATH) -> dict[str, Any]:
    with path.open(encoding="utf-8") as stream:
        config = yaml.safe_load(stream)
    if not isinstance(config, dict) or not isinstance(config.get("rules"), list):
        raise ValueError("Validation rules YAML must contain a rules list")
    return config


def _norm(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"[^\w]+", "", str(value).casefold(), flags=re.UNICODE)


def _name_key(value: Any) -> str:
    generic = {"synthetic", "institute", "institution", "of", "the", "and", "applied", "studies", "college", "university"}
    parts = [part.casefold() for part in re.findall(r"[\w]+", str(value), flags=re.UNICODE)]
    return " ".join(part for part in parts if part not in generic and not part.isdigit())


def _same(
    field: str,
    left: Any,
    right: Any,
    aliases: list[str],
    fuzzy_name: bool,
    threshold: float,
    date_formats: list[str],
) -> tuple[bool, float]:
    if _norm(left) == _norm(right):
        return True, 1.0
    if field in {"issue_date", "valid_until", "payment_date"}:
        try:
            def parse_date(value: Any) -> date:
                for date_format in date_formats:
                    try:
                        return datetime.strptime(str(value), date_format).date()
                    except ValueError:
                        continue
                raise ValueError("unsupported date format")
            left_date = parse_date(left)
            right_date = parse_date(right)
            return left_date == right_date, float(left_date == right_date)
        except ValueError:
            pass
    if fuzzy_name:
        candidates = [str(left), *aliases]
        right_key = _name_key(right)
        similarity = max((SequenceMatcher(None, right_key, _name_key(candidate)).ratio() for candidate in candidates), default=0.0)
        return similarity >= threshold, similarity
    return False, 0.0


def _evidence(document: ValidationDocument | None, field: str | None, extracted: Any) -> FindingEvidence:
    if document is None:
        return FindingEvidence(page=None, bbox=None, extracted="" if extracted is None else str(extracted))
    boxes = document.field_boxes.get(field, []) if field else []
    if not boxes:
        boxes = next((candidate for candidate in document.field_boxes.values() if candidate), [])
    box = boxes[0] if boxes else None
    return FindingEvidence(
        page=box.page if box else None,
        bbox=box.bbox if box else None,
        extracted="" if extracted is None else str(extracted),
    )


def _finding(
    application: ValidationApplication,
    *,
    key: str,
    rule_id: str,
    kind: str,
    severity: str,
    reason: str,
    document: ValidationDocument | None,
    field: str | None,
    extracted: Any,
    confidence: float = 1.0,
) -> Finding:
    identity = f"{application.application_id}:{rule_id}:{key}"
    doc_id = uuid5(NAMESPACE_URL, document.document_id) if document else uuid5(NAMESPACE_URL, f"{application.application_id}:missing:{key}")
    return Finding(
        finding_id=uuid5(NAMESPACE_URL, identity),
        application_id=application.application_id,
        type=kind,
        severity=FindingSeverity(severity),
        document=FindingDocument(document_id=doc_id, name=document.file_name if document else "Application checklist"),
        evidence=_evidence(document, field, extracted),
        rule_id=rule_id,
        reason=reason,
        confidence=max(0.0, min(1.0, confidence)),
        status=FindingStatus.OPEN,
    )


def _claim_evidence(documents: list[ValidationDocument], field: str) -> list[ClaimEvidence]:
    linked: list[ClaimEvidence] = []
    for document in documents:
        if document.document_type == "application_form":
            continue
        value = document.fields.get(field)
        if value is None:
            continue
        boxes = document.field_boxes.get(field, [])
        box = boxes[0] if boxes else None
        linked.append(ClaimEvidence(
            document_id=document.document_id,
            document_name=document.file_name,
            field_key=field,
            value=value,
            page=box.page if box else None,
            bbox=box.bbox if box else None,
        ))
    return linked


def _valid_calendar_date(value: Any, formats: list[str]) -> bool:
    return any(_parse_date(value, date_format) is not None for date_format in formats)


def _parse_date(value: Any, date_format: str) -> date | None:
    try:
        return datetime.strptime(str(value), date_format).date()
    except (TypeError, ValueError):
        return None


def _anomaly_finding(
    application: ValidationApplication,
    document: ValidationDocument,
    *,
    key: str,
    rule_id: str,
    kind: str,
    severity: str,
    reason: str,
    field: str | None = None,
    extracted: Any = None,
    box: EvidenceBox | None = None,
) -> Finding:
    finding = _finding(
        application,
        key=key,
        rule_id=rule_id,
        kind=kind,
        severity=severity,
        reason=reason,
        document=document,
        field=field,
        extracted=extracted,
    )
    if box:
        finding = finding.model_copy(update={
            "evidence": FindingEvidence(page=box.page, bbox=box.bbox, extracted="" if extracted is None else str(extracted))
        })
    return finding


def check_document_anomalies(
    application: ValidationApplication,
    document: ValidationDocument,
    checks: dict[str, Any],
) -> list[Finding]:
    findings: list[Finding] = []
    meta_rule = checks["metadata_inconsistency"]
    expected_titles = meta_rule.get("expected_title_by_type", {}).get(document.document_type, [])
    title = str(document.pdf_metadata.get("title") or "").strip().casefold()
    title_conflict = bool(title and expected_titles and not any(expected.casefold() in title for expected in expected_titles))
    timestamp_conflict = False
    if meta_rule.get("check_creation_modification_order"):
        date_pattern = re.compile(r"^D:(\d{14})")
        creation = date_pattern.match(str(document.pdf_metadata.get("creationDate") or ""))
        modification = date_pattern.match(str(document.pdf_metadata.get("modDate") or ""))
        if creation and modification:
            timestamp_conflict = modification.group(1) < creation.group(1)
        elif document.pdf_metadata.get("creationDate") or document.pdf_metadata.get("modDate"):
            timestamp_conflict = not (creation and modification)
    if title_conflict or timestamp_conflict:
        findings.append(_anomaly_finding(
            application, document,
            key=f"metadata:{title}:{timestamp_conflict}", rule_id=meta_rule["id"], kind="metadata_inconsistency",
            severity=meta_rule["severity"], reason=meta_rule["reason"], extracted=f"PDF title: {title or 'missing'}; timestamp order consistent: {not timestamp_conflict}",
        ))

    signature_rule = checks["post_signature_modification"]
    if document.signature_present and (
        document.signature_intact is False
        or (signature_rule.get("require_full_coverage", True) and document.signature_covers_file is False)
    ):
        findings.append(_anomaly_finding(
            application, document,
            key="signature-integrity", rule_id=signature_rule["id"], kind="post_signature_modification",
            severity=signature_rule["severity"], reason=signature_rule["reason"],
            field="signature_present", extracted="Signature validation reports changes after signing.",
        ))

    revisions_rule = checks["multiple_revisions"]
    if document.revision_count is not None:
        maximum = revisions_rule["max_signed_revisions"] if document.signature_present else revisions_rule["max_unsigned_revisions"]
        if document.revision_count > int(maximum):
            findings.append(_anomaly_finding(
                application, document,
                key=f"revisions:{document.revision_count}", rule_id=revisions_rule["id"], kind="multiple_revisions",
                severity=revisions_rule["severity"], reason=revisions_rule["reason"],
                extracted=f"PDF revision count: {document.revision_count}",
            ))

    font_rule = checks["mixed_fonts"]
    for field in font_rule["fields"]:
        spans = document.field_font_spans.get(field, [])
        fonts: dict[str, list[FontSpan]] = {}
        for span in spans:
            fonts.setdefault(span.font, []).append(span)
        if len(fonts) >= int(font_rule["minimum_distinct_fonts"]):
            counts = sorted(((len(items), name) for name, items in fonts.items()), reverse=True)
            baseline = counts[0][1]
            unusual = next((span for span in spans if span.font != baseline), spans[-1])
            value = document.fields.get(field)
            findings.append(_anomaly_finding(
                application, document,
                key=f"mixed-font:{field}:{','.join(sorted(fonts))}", rule_id=font_rule["id"], kind="mixed_fonts_within_field",
                severity=font_rule["severity"], reason=f"{font_rule['reason']} Field: {field}.",
                field=field, extracted=unusual.text or value, box=EvidenceBox(page=unusual.page, bbox=unusual.bbox),
            ))

    date_rule = checks["impossible_dates"]
    for field in date_rule["fields"]:
        value = document.fields.get(field)
        if value is None or not str(value).strip() or _valid_calendar_date(value, date_rule["formats"]):
            continue
        findings.append(_anomaly_finding(
            application, document,
            key=f"invalid-date:{field}:{value}", rule_id=date_rule["id"], kind="impossible_date",
            severity=date_rule["severity"], reason=date_rule["reason"], field=field, extracted=value,
        ))

    id_rule = checks["id_formats"]
    for field, patterns in id_rule["fields"].items():
        value = document.fields.get(field)
        if value is None or any(re.fullmatch(pattern, str(value), flags=re.I) for pattern in patterns):
            continue
        findings.append(_anomaly_finding(
            application, document,
            key=f"invalid-id:{field}:{value}", rule_id=id_rule["id"], kind="id_format_mismatch",
            severity=id_rule["severity"], reason=f"{id_rule['reason']} Field: {field}.", field=field, extracted=value,
        ))
    return findings


def evaluate(request: ValidationRequest, config: dict[str, Any] | None = None) -> ValidationResponse:
    config = config or load_rules()
    rules = config["rules"]
    rule_by_kind = {rule["kind"]: rule for rule in rules}
    reference_date = request.reference_date or date.today()
    findings: list[Finding] = []
    claim_results: list[ClaimResult] = []
    seen_claims: set[str] = set()

    comparison = rule_by_kind["field_comparison"]
    declared_field_keys = set(comparison.get("fields", [])) | {rule_by_kind["date_arithmetic"]["field"]}
    name_fields = set(comparison.get("name_fields", []))
    threshold = float(comparison.get("fuzzy_name_threshold", 1.0))
    for application in request.applications:
        declared_claims = dict(application.claims.values)
        for form in application.documents:
            if form.document_type == "application_form":
                declared_claims.update({
                    key: value for key, value in form.fields.items()
                    if key in declared_field_keys and value is not None
                })
        for field, declared in declared_claims.items():
            claim_key = f"{application.application_id}:{field}"
            if claim_key in seen_claims:
                continue
            seen_claims.add(claim_key)
            linked = _claim_evidence(application.documents, field)
            best = linked[0] if linked else None
            target_document = next((doc for doc in application.documents if best and doc.document_id == best.document_id), None)
            rule = rule_by_kind.get("date_arithmetic") if field == "valid_until" else comparison
            expired_rule = rule_by_kind.get("date_arithmetic")
            is_expired = False
            if field == expired_rule.get("field") and best and best.value:
                try:
                    valid_date = date.fromisoformat(str(best.value))
                    operation = expired_rule["operation"]
                    if operation == "on_or_after_reference_date":
                        is_expired = valid_date < reference_date
                    else:
                        raise ValueError(f"Unsupported date arithmetic operation: {operation}")
                except ValueError:
                    is_expired = False
            if not best:
                status = ClaimStatus.UNSUPPORTED
                reason = f"No document evidence was found for the declared {field}. Human verification is required."
                kind = "claim_unsupported"
                severity = "medium"
                score = 0.0
            elif is_expired:
                status = ClaimStatus.EXPIRED
                reason = expired_rule["expired_reason"].format(value=best.value, reference_date=reference_date.isoformat())
                kind = expired_rule["expired_type"]
                severity = expired_rule["severity"]
                score = 1.0
            elif field not in comparison.get("fields", []) and field != expired_rule.get("field"):
                status = ClaimStatus.UNSUPPORTED
                reason = f"No YAML rule is configured to assess the declared {field}. Human verification is required."
                kind = "claim_unsupported"
                severity = "medium"
                score = 0.0
            else:
                matches = []
                for evidence in linked:
                    ok, similarity = _same(
                        field,
                        declared,
                        evidence.value,
                        application.claims.aliases.get(field, []),
                        field in name_fields,
                        threshold,
                        comparison.get("date_formats", ["%Y-%m-%d"]),
                    )
                    matches.append((ok, similarity, evidence))
                match = max(matches, key=lambda result: result[1], default=(False, 0.0, best))
                if match[0]:
                    status = ClaimStatus.SUPPORTED
                    reason = f"The declared {field} is supported by extracted document evidence."
                    kind = "claim_supported"
                    severity = "info"
                    score = match[1]
                    best = match[2]
                    target_document = next((doc for doc in application.documents if doc.document_id == best.document_id), target_document)
                else:
                    status = ClaimStatus.CONTRADICTED
                    reason = comparison.get("mismatch_reasons", {}).get(field, comparison["mismatch_reason"]).format(field=field)
                    kind = comparison["mismatch_type"]
                    severity = comparison["severity"]
                    score = match[1]
                    best = match[2]
                    target_document = next((doc for doc in application.documents if doc.document_id == best.document_id), target_document)
            finding = _finding(
                application,
                key=f"claim:{field}",
                rule_id=expired_rule["id"] if status == ClaimStatus.EXPIRED else comparison["id"],
                kind=kind,
                severity=severity,
                reason=reason,
                document=target_document,
                field=field,
                extracted=best.value if best else None,
                confidence=score,
            )
            findings.append(finding)
            claim_results.append(ClaimResult(
                claim_id=uuid5(NAMESPACE_URL, claim_key),
                application_id=application.application_id,
                field_key=field,
                declared_value=declared,
                status=status,
                evidence_fields=linked,
                finding=finding,
            ))

        expected_rule = rule_by_kind.get("field_expected_value")
        if expected_rule:
            for document in application.documents:
                for field, expected in expected_rule["fields"].items():
                    actual = document.fields.get(field)
                    if field in declared_claims or actual is None or actual == expected:
                        continue
                    finding = _finding(
                        application,
                        key=f"{expected_rule['id']}:{document.document_id}:{field}",
                        rule_id=expected_rule["id"],
                        kind=expected_rule["finding_type"],
                        severity=expected_rule["severity"],
                        reason=expected_rule["reason"],
                        document=document,
                        field=field,
                        extracted=actual,
                    )
                    findings.append(finding)

        checklist_rule = rule_by_kind["required_documents"]
        checklist = config.get("checklists", {}).get(application.application_type)
        if checklist is not None:
            present = {document.document_type for document in application.documents}
            for required in checklist.get("required_documents", []):
                if required in present:
                    continue
                findings.append(_finding(
                    application,
                    key=f"missing:{required}",
                    rule_id=checklist_rule["id"],
                    kind=checklist_rule["finding_type"],
                    severity=checklist_rule["severity"],
                    reason=checklist_rule["reason"].format(document_type=required),
                    document=None,
                    field=None,
                    extracted=None,
                    confidence=1.0,
                ))

        anomaly_checks = config.get("anomaly_checks", {})
        for document in application.documents:
            findings.extend(check_document_anomalies(application, document, anomaly_checks))

        handbook_policy = config.get("handbook_rule_policy", {})
        date_formats = handbook_policy.get("date_formats", ["%Y-%m-%d"])
        for rule in config.get("approved_handbook_rules", []):
            for document in application.documents:
                actual = document.fields.get(rule["field"])
                operator = rule["operator"]
                violation = False
                if operator == "field_required":
                    violation = actual is None or not str(actual).strip()
                elif operator == "field_equals":
                    violation = actual is None or _norm(actual) != _norm(rule.get("expected"))
                elif operator == "date_on_or_after_reference":
                    parsed_date = next((_parse_date(actual, fmt) for fmt in date_formats if actual is not None and _parse_date(actual, fmt)), None)
                    violation = parsed_date is None or parsed_date < reference_date
                else:
                    raise ValueError(f"Unsupported handbook rule operator: {operator}")
                if violation:
                    box = document.field_boxes.get(rule["field"], [])
                    evidence = box[0] if box else None
                    findings.append(_finding(
                        application,
                        key=f"{rule['id']}:{document.document_id}:{rule['field']}",
                        rule_id=rule["id"],
                        kind=rule["finding_type"],
                        severity=rule["severity"],
                        reason=rule["reason"],
                        document=document,
                        field=rule["field"],
                        extracted=actual,
                        confidence=0.0 if actual is None else 1.0,
                    ).model_copy(update={
                        "evidence": FindingEvidence(
                            page=evidence.page if evidence else None,
                            bbox=evidence.bbox if evidence else None,
                            extracted="" if actual is None else str(actual),
                        )
                    }))

    for rule in rules:
        if rule["kind"] != "cross_document_equality":
            continue
        key = rule["key"]
        groups: list[list[tuple[ValidationApplication, ValidationDocument, Any]]] = []
        threshold = float(rule.get("fuzzy_threshold", 1.0))
        for application in request.applications:
            for document in application.documents:
                value = document.sha256 if key == "sha256" else document.fields.get(key.removeprefix("field:"))
                if value is None:
                    continue
                normalized = _norm(value)
                if not normalized:
                    continue
                matching_group = next((candidate for candidate in groups if max(
                    SequenceMatcher(None, normalized, _norm(item[2])).ratio() for item in candidate
                ) >= threshold), None)
                if matching_group is None:
                    groups.append([(application, document, value)])
                else:
                    matching_group.append((application, document, value))
        for group in groups:
            distinct = {
                str(application.application_id) if rule.get("scope") == "application" else application.institution_id
                for application, _, _ in group
            }
            if len(distinct) < int(rule["minimum_distinct_institutions"]):
                continue
            for application, document, value in group:
                field = key.removeprefix("field:") if key.startswith("field:") else None
                findings.append(_finding(
                    application,
                    key=f"{rule['id']}:{_norm(value)}:{document.document_id}",
                    rule_id=rule["id"],
                    kind=rule["finding_type"],
                    severity=rule["severity"],
                    reason=rule["reason"],
                    document=document,
                    field=field,
                    extracted=str(value),
                    confidence=1.0,
                ))

    return ValidationResponse(findings=findings, claims=claim_results)
