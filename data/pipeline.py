#!/usr/bin/env python3
"""Text-first synthetic document pipeline with optional free-tier Gemini.

Defaults to local extraction when Gemini is not explicitly enabled. Gemini
calls require both --gemini-free-tier and GEMINI_API_KEY; only the fixed
gemini-2.5-flash-lite model is used. Text is redacted before any hosted call.

Examples:
    python data/pipeline.py --limit 10
    GEMINI_API_KEY=... python data/pipeline.py --limit 10 --gemini-free-tier
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api.pdf_features import collect_pdf_features


PIPELINE_VERSION = "preflight-pipeline-v4"
GEMINI_MODEL = "gemini-2.5-flash-lite"


def write_demo_status(cache_dir: Path, llm_status: str) -> None:
    """Expose only aggregate extraction availability to the local demo API."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    degraded = llm_status == "local_fallback_after_gemini_error"
    status = {
        "llm_degraded": degraded,
        "message": "Hosted extraction was unavailable; local extraction was used. Human review is required." if degraded else "",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    target = cache_dir / "demo_status.json"
    temporary = cache_dir / "demo_status.tmp"
    temporary.write_text(json.dumps(status, ensure_ascii=True), encoding="utf-8")
    temporary.replace(target)
DOCUMENT_TYPES = (
    "application_form",
    "affidavit",
    "fire_noc",
    "lease",
    "accreditation_letter",
    "ter_receipt",
    "structural_certificate",
)

FIELD_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "document_type": {"type": "STRING", "enum": list(DOCUMENT_TYPES)},
        "institution_name": {"type": ["STRING", "NULL"]},
        "application_number": {"type": ["STRING", "NULL"]},
        "document_reference": {"type": ["STRING", "NULL"]},
        "issue_date": {"type": ["STRING", "NULL"]},
        "valid_until": {"type": ["STRING", "NULL"]},
        "institution_address": {"type": ["STRING", "NULL"]},
        "faculty_reference_id": {"type": ["STRING", "NULL"]},
        "receipt_reference": {"type": ["STRING", "NULL"]},
        "transaction_reference": {"type": ["STRING", "NULL"]},
        "payment_date": {"type": ["STRING", "NULL"]},
        "amount_inr": {"type": ["NUMBER", "NULL"]},
        "amount_inr_display": {"type": ["STRING", "NULL"]},
        "signatory": {"type": ["STRING", "NULL"]},
        "signature_present": {"type": ["BOOLEAN", "NULL"]},
    },
    "required": [
        "document_type", "institution_name", "application_number", "document_reference",
        "issue_date", "valid_until", "institution_address", "faculty_reference_id",
        "receipt_reference", "transaction_reference", "payment_date", "amount_inr",
        "amount_inr_display", "signatory", "signature_present",
    ],
    "additionalProperties": False,
}

EMPTY_FIELDS: dict[str, Any] = {
    "document_type": "affidavit",
    "institution_name": None,
    "application_number": None,
    "document_reference": None,
    "issue_date": None,
    "valid_until": None,
    "institution_address": None,
    "faculty_reference_id": None,
    "receipt_reference": None,
    "transaction_reference": None,
    "payment_date": None,
    "amount_inr": None,
    "amount_inr_display": None,
    "signatory": None,
    "signature_present": None,
}

TITLE_RULES = (
    ("application_form", ("application for approval", "application form", "application details")),
    ("affidavit", ("institution declaration", "affidavit")),
    ("fire_noc", ("fire safety clearance", "fire noc", "no objection certificate")),
    ("lease", ("lease agreement", "lease deed")),
    ("accreditation_letter", ("accreditation status letter", "accreditation letter")),
    ("ter_receipt", ("technical education review fee receipt", "ter receipt", "receipt reference")),
    ("structural_certificate", ("structural safety certificate", "structural certificate")),
)


def emit(step: str, status: str, **details: Any) -> None:
    event = {
        "event": "progress",
        "step": step,
        "status": status,
        "time": datetime.now().astimezone().isoformat(timespec="seconds"),
        **details,
    }
    print(json.dumps(event, ensure_ascii=True, separators=(",", ":")), flush=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def locate_tesseract() -> None:
    configured = os.environ.get("TESSERACT_CMD")
    candidates = [
        Path(configured) if configured else None,
        Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
        Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            parent = str(candidate.parent)
            os.environ["PATH"] = parent + os.pathsep + os.environ.get("PATH", "")
            tessdata = candidate.parent / "tessdata"
            if tessdata.is_dir():
                os.environ.setdefault("TESSDATA_PREFIX", str(tessdata))
            return


def extract_pdf(path: Path) -> tuple[str, list[dict[str, Any]], list[str]]:
    """Extract page text/word boxes first; OCR only pages with no text layer."""
    doc = pymupdf.open(path)
    page_texts: list[str] = []
    word_boxes: list[dict[str, Any]] = []
    page_modes: list[str] = []
    try:
        for page_index, page in enumerate(doc, start=1):
            words = page.get_text("words", sort=True)
            text = page.get_text("text", sort=True).strip()
            has_text = bool(text and any(str(item[4]).strip() for item in words))
            if has_text:
                mode = "text_layer"
            else:
                locate_tesseract()
                try:
                    text_page = page.get_textpage_ocr(language="eng", dpi=300, full=True)
                    words = page.get_text("words", textpage=text_page, sort=True)
                    text = page.get_text("text", textpage=text_page, sort=True).strip()
                    mode = "ocr" if text else "ocr_empty"
                except Exception as exc:
                    raise RuntimeError(f"OCR failed on page {page_index}: {type(exc).__name__}: {exc}") from exc
            page_texts.append(text)
            page_modes.append(mode)
            for word in words:
                if len(word) < 5 or not str(word[4]).strip():
                    continue
                x0, y0, x1, y1, token = word[:5]
                word_boxes.append({
                    "page": page_index,
                    "text": str(token),
                    "bbox": [round(float(x0), 2), round(float(y0), 2), round(float(x1), 2), round(float(y1), 2)],
                })
    finally:
        doc.close()
    return "\n".join(page_texts), word_boxes, page_modes


def classify_document(text: str) -> str:
    sample = re.sub(r"\s+", " ", text[:5000]).casefold()
    for doc_type, markers in TITLE_RULES:
        if any(marker in sample for marker in markers):
            return doc_type
    return "affidavit"


def redact_personal_data(text: str) -> tuple[str, dict[str, str], list[dict[str, Any]]]:
    """Replace personal names and identifiers; retain values only in memory."""
    token_to_value: dict[str, str] = {}
    audit: list[dict[str, Any]] = []
    token_for: dict[tuple[str, str], str] = {}
    occurrence_counts: dict[str, int] = defaultdict(int)

    def get_token(category: str, value: str) -> str:
        original = value.strip()
        key = (category, original.casefold())
        token = token_for.get(key)
        if token is None:
            token = f"[REDACTED_{category.upper()}_{len(token_for) + 1:03d}]"
            token_for[key] = token
            token_to_value[token] = original
            audit.append({
                "category": category,
                "replacement": token,
                "occurrences": 0,
                "character_count": len(original),
            })
        return token

    def record_occurrences(token: str, count: int) -> None:
        if count <= 0:
            return
        occurrence_counts[token] += count
        for entry in audit:
            if entry["replacement"] == token:
                entry["occurrences"] = occurrence_counts[token]
                break

    result = text
    patterns: tuple[tuple[str, re.Pattern[str]], ...] = (
        ("email", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)),
        ("phone", re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)")),
        ("aadhaar_like_id", re.compile(r"(?<!\d)(?:\d[ -]?){11}\d(?!\d)")),
        ("pan_like_id", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.I)),
        ("faculty_id", re.compile(r"\bFAC-[A-Z0-9-]+\b", re.I)),
    )
    for category, pattern in patterns:
        def replace_identifier(match: re.Match[str], c: str = category) -> str:
            token = get_token(c, match.group(0))
            record_occurrences(token, 1)
            return token
        result = pattern.sub(replace_identifier, result)

    # OCR can reorder words in a label (for example, "AuthorizedPrimary ... by:
    # Aadi Name"). Search both normal and partial label forms, then redact the
    # recovered name everywhere it appears, including its signature line.
    name_patterns = (
        re.compile(r"(?im)(?:authorized\s*by|signatory|declarant|witness)\s*:\s*([^\r\n]{2,90})"),
        re.compile(r"(?im)\bby\s*:\s*([^\r\n]{2,70})"),
        re.compile(r"(?im)TEST\s+SIGNED\s+BY\s+([^\r\n]{2,70})"),
    )
    stop_words = {"signature", "test", "signed", "by", "authorized", "primary", "faculty", "we", "the", "copy"}
    names: set[str] = set()
    for pattern in name_patterns:
        for match in pattern.finditer(result):
            words = re.findall(r"[A-Za-z][A-Za-z.'-]*", match.group(1))
            words = [word for word in words if word.casefold() not in stop_words]
            if len(words) >= 2:
                names.add(" ".join(words[:3]))

    for name in sorted(names, key=len, reverse=True):
        token = get_token("person_name", name)
        exact_name = re.compile(r"\b" + r"\s+".join(re.escape(part) for part in name.split()) + r"\b", re.I)
        result, count = exact_name.subn(lambda _match, t=token: t, result)
        record_occurrences(token, count)
        for part in name.split():
            component = re.compile(r"\b" + re.escape(part) + r"\b", re.I)
            result, count = component.subn(lambda _match, t=token: t, result)
            record_occurrences(token, count)
    return result, token_to_value, audit


def restore_redactions(value: Any, token_map: dict[str, str]) -> Any:
    if isinstance(value, str):
        for token, original in token_map.items():
            value = value.replace(token, original)
        return value
    if isinstance(value, list):
        return [restore_redactions(item, token_map) for item in value]
    if isinstance(value, dict):
        return {key: restore_redactions(item, token_map) for key, item in value.items()}
    return value


def validate_fields(fields: dict[str, Any]) -> dict[str, Any]:
    expected = set(EMPTY_FIELDS)
    actual = set(fields)
    if actual != expected:
        raise ValueError(f"Strict extraction schema mismatch: missing={sorted(expected-actual)}, extra={sorted(actual-expected)}")
    if fields["document_type"] not in DOCUMENT_TYPES:
        raise ValueError("document_type is outside the allowed enum")
    for key, value in fields.items():
        if key == "document_type":
            continue
        if value is None:
            continue
        if key == "amount_inr":
            if isinstance(value, bool) or not isinstance(value, (float, int)):
                raise ValueError("amount_inr must be a number or null")
        elif key == "signature_present":
            if not isinstance(value, bool):
                raise ValueError("signature_present must be boolean or null")
        elif not isinstance(value, str):
            raise ValueError(f"{key} must be string or null")
    return fields


def gemini_extract(redacted_text: str, api_key: str, doc_type: str) -> dict[str, Any]:
    prompt = (
        "Extract only values explicitly present in the supplied synthetic document text. "
        "Use null when absent. Preserve the printed value, including apparent discrepancies. "
        "Do not infer corrected or canonical values. Copy REDACTED tokens literally if they "
        "occupy a requested field. The document type has been independently classified as "
        f"{doc_type}.\n\nDOCUMENT TEXT:\n{redacted_text[:24000]}"
    )
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": FIELD_SCHEMA,
            "temperature": 0,
        },
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        + GEMINI_MODEL
        + ":generateContent?"
        + urllib.parse.urlencode({"key": api_key})
    )
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Gemini HTTP {exc.code}") from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Gemini request failed: {type(exc).__name__}") from None
    try:
        raw = result["candidates"][0]["content"]["parts"][0]["text"]
        fields = json.loads(raw)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        raise RuntimeError("Gemini returned no valid JSON content") from None
    return validate_fields(fields)


def local_extract(text: str, doc_type: str) -> dict[str, Any]:
    fields = dict(EMPTY_FIELDS)
    fields["document_type"] = doc_type

    def first(pattern: str, flags: int = re.I) -> str | None:
        match = re.search(pattern, text, flags)
        return match.group(1).strip() if match else None

    def paragraph_value(label: str) -> str | None:
        lines = text.splitlines()
        label_pattern = re.compile(re.escape(label) + r"\s*:\s*(.*)$", re.I)
        stop_line = re.compile(
            r"^(?:Application\s*:|Document reference\s*:|Issue date\s*:|Valid through\s*:|"
            r"Institution address\s*:|Primary faculty reference\s*:|Authorized by\s*:|Signature\s*:|"
            r"I declare\b|The fictional\b|The Synthetic\b|This is\b|Service\s*:|Receipt reference\s*:|"
            r"Transaction reference\s*:|Paid on\s*:|Amount received\s*:|SYNTHETIC DEMO\b|Training copy\b)",
            re.I,
        )
        for index, line in enumerate(lines):
            match = label_pattern.search(line.strip())
            if not match:
                continue
            pieces = [match.group(1).strip()] if match.group(1).strip() else []
            for continuation in lines[index + 1 :]:
                candidate = continuation.strip()
                if not candidate or stop_line.match(candidate):
                    break
                pieces.append(candidate)
            value = re.sub(r"\s+", " ", " ".join(pieces)).strip()
            value = re.sub(r"\s+DEMO\s*$", "", value, flags=re.I)
            return value or None
        return None

    def person_name(raw: str | None) -> str | None:
        if not raw:
            return None
        words = re.findall(r"[A-Za-z][A-Za-z.'-]*", raw)
        stop = {"signature", "test", "signed", "by", "we", "the", "copy", "demo"}
        while words and words[-1].casefold() in stop:
            words.pop()
        return " ".join(words[:3]) if words else None

    if doc_type != "ter_receipt":
        fields["institution_name"] = first(r"Institution\s*:\s*([^\r\n]+)")
        fields["application_number"] = first(r"Application\s*:\s*([^\s\r\n]+)")
        fields["document_reference"] = first(r"Document reference\s*:\s*([^\s\r\n]+)")
        issue_match = re.search(r"Issue date\s*:\s*([^\r\n]+)", text, re.I)
        if issue_match:
            dates = re.findall(r"(?:20\d{2}-\d{2}-\d{2}|\d{2}/\d{2}/20\d{2})", issue_match.group(1))
            fields["issue_date"] = dates[-1] if dates else issue_match.group(1).strip()
        fields["valid_until"] = first(r"Valid through\s*:\s*([^\s\r\n]+)")
        fields["institution_address"] = paragraph_value("Institution address")
        # PyMuPDF can concatenate the footer's DEMO watermark to the preceding
        # ID token, so allow that known suffix while keeping the ID width exact.
        faculty_match = re.search(r"\b(FAC-SYN-(?:SHARED-[A-Z0-9]{4}|[A-Z0-9]{5}))(?:DEMO)?\b", text, re.I)
        fields["faculty_reference_id"] = faculty_match.group(1) if faculty_match else None
        signatory = re.search(r"(?:Authorized\s*by|\bby)\s*:\s*(.*?)(?=\s+Signature\s*:|\r?\n|$)", text, re.I | re.S)
        fields["signatory"] = person_name(signatory.group(1) if signatory else None)
        signature_match = re.search(r"\bSignature\s*:\s*(.{0,100})", text, re.I)
        if signature_match:
            signature_line = signature_match.group(1).splitlines()[0].strip()
            fields["signature_present"] = "_" not in signature_line and bool(signature_line)
    else:
        fields["receipt_reference"] = first(r"Receipt reference\s*:\s*([^\s\r\n]+)")
        fields["transaction_reference"] = first(r"Transaction reference\s*:\s*([^\s\r\n]+)")
        fields["payment_date"] = first(r"Paid on\s*:\s*([^\s\r\n]+)")
        amount_line = first(r"Amount received\s*:\s*([^\r\n]+)")
        if amount_line:
            fields["amount_inr_display"] = amount_line
            number = re.search(r"[\d,]+(?:\.\d+)?", amount_line)
            if number:
                try:
                    fields["amount_inr"] = float(Decimal(number.group(0).replace(",", "")))
                except InvalidOperation:
                    pass
    return validate_fields(fields)


def token_stream(value: str) -> list[str]:
    return [token.casefold() for token in re.findall(r"[\w]+", value, flags=re.UNICODE) if token]


def map_value_to_boxes(value: Any, words: list[dict[str, Any]], related_value: Any = None) -> list[dict[str, Any]]:
    if value is None:
        return []
    display = str(related_value if related_value is not None else value)
    needle = token_stream(display)
    if not needle:
        return []
    flattened: list[tuple[str, dict[str, Any]]] = []
    for word in words:
        for token in token_stream(word["text"]):
            flattened.append((token, word))
    for start in range(max(0, len(flattened) - len(needle) + 1)):
        if [token for token, _ in flattened[start : start + len(needle)]] == needle:
            boxes: list[dict[str, Any]] = []
            seen: set[tuple[int, tuple[float, ...]]] = set()
            for _, word in flattened[start : start + len(needle)]:
                key = (word["page"], tuple(word["bbox"]))
                if key not in seen:
                    seen.add(key)
                    boxes.append({"page": word["page"], "bbox": word["bbox"], "word": word["text"]})
            return boxes
    return []


def map_fields(fields: dict[str, Any], words: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    boxes: dict[str, list[dict[str, Any]]] = {}
    for name, value in fields.items():
        related = fields.get("amount_inr_display") if name == "amount_inr" else None
        boxes[name] = map_value_to_boxes(value, words, related_value=related)
    return boxes


def append_redaction_audit(cache_dir: Path, file_hash: str, audit: list[dict[str, Any]]) -> None:
    if not audit:
        return
    log_path = cache_dir / "redaction_audit.jsonl"
    entry = {
        "time": datetime.now().astimezone().isoformat(timespec="seconds"),
        "file_sha256": file_hash,
        "removed": audit,
    }
    with log_path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(entry, ensure_ascii=True, separators=(",", ":")) + "\n")


def emit_field_accuracy(
    output_rows: list[dict[str, Any]],
    ground_truth: dict[str, dict[str, Any]],
) -> None:
    observed: dict[str, list[bool]] = defaultdict(list)
    canonical: dict[str, list[bool]] = defaultdict(list)
    for result in output_rows:
        gt = ground_truth[result["relative_path"]]
        model_fields = result["fields"]
        observed_fields = gt["observed_fields_json"]
        correct_fields = gt["correct_fields_json"]
        observed["document_type"].append(
            result["document_type"] == gt["document_type"]
        )
        for name, target in observed_fields.items():
            if name in model_fields:
                observed[name].append(values_equal(model_fields.get(name), target, name))
        for name, target in correct_fields.items():
            if name in model_fields:
                canonical[name].append(values_equal(model_fields.get(name), target, name))

    print("\nPer-field extraction accuracy vs ground_truth.csv (observed document values):")
    print("field\tcorrect/total\taccuracy")
    for name in sorted(observed):
        values = observed[name]
        correct = sum(values)
        print(f"{name}\t{correct}/{len(values)}\t{correct / len(values):.1%}")
    print("\nPer-field agreement with canonical correct_fields_json:")
    print("field\tcorrect/total\taccuracy")
    for name in sorted(canonical):
        values = canonical[name]
        correct = sum(values)
        print(f"{name}\t{correct}/{len(values)}\t{correct / len(values):.1%}")


def values_equal(actual: Any, expected: Any, field: str) -> bool:
    if actual is None or expected is None:
        return actual is expected
    if field == "signature_present":
        return bool(actual) == bool(expected)
    if field == "amount_inr":
        try:
            return Decimal(str(actual)).quantize(Decimal("0.01")) == Decimal(str(expected)).quantize(Decimal("0.01"))
        except InvalidOperation:
            return False
    a = re.sub(r"\s+", " ", str(actual)).strip().casefold()
    b = re.sub(r"\s+", " ", str(expected)).strip().casefold()
    if field in {"issue_date", "valid_until", "payment_date"}:
        for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
            try:
                a = datetime.strptime(a, fmt).date().isoformat()
                break
            except ValueError:
                continue
        for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
            try:
                b = datetime.strptime(b, fmt).date().isoformat()
                break
            except ValueError:
                continue
    if field == "amount_inr_display":
        a = re.sub(r"[^\d.]", "", a)
        b = re.sub(r"[^\d.]", "", b)
    return a == b


def select_rows(rows: list[dict[str, str]], limit: int, mode: str) -> list[dict[str, Any]]:
    chosen: list[dict[str, Any]] = []
    if mode == "original":
        subset = rows[:limit]
        for row in subset:
            chosen.append({**row, "relative_path": row["original_pdf"]})
    elif mode == "scanned":
        subset = rows[:limit]
        for row in subset:
            chosen.append({**row, "relative_path": row["scanned_pdf"]})
    else:
        original_count = (limit + 1) // 2
        for row in rows[:original_count]:
            chosen.append({**row, "relative_path": row["original_pdf"]})
        scan_count = limit - original_count
        for row in rows[original_count : original_count + scan_count]:
            chosen.append({**row, "relative_path": row["scanned_pdf"]})
    return chosen


def run_one(
    record: dict[str, Any],
    data_root: Path,
    cache_dir: Path,
    use_gemini: bool,
    api_key: str | None,
) -> dict[str, Any]:
    relative_path = record["relative_path"]
    path = data_root / relative_path
    if not path.is_file():
        raise FileNotFoundError(f"Generated document not found: {path}")
    file_hash = sha256_file(path)
    desired_mode = f"gemini:{GEMINI_MODEL}" if use_gemini else "local"
    cache_path = cache_dir / f"{file_hash}.json"
    emit("cache", "check", document=relative_path, file_sha256=file_hash)
    if cache_path.is_file():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if cached.get("pipeline_version") == PIPELINE_VERSION and cached.get("mode") == desired_mode:
                write_demo_status(cache_dir, cached["llm_status"])
                emit("cache", "hit", document=relative_path, file_sha256=file_hash)
                emit("text_or_ocr", "cached", document=relative_path, page_modes=cached["page_modes"])
                emit("classify", "cached", document=relative_path, document_type=cached["document_type"])
                emit("redact", "cached", document=relative_path, replacements=len(cached.get("redaction_summary", [])))
                emit("gemini_extract", "cached", document=relative_path, status=cached["llm_status"])
                emit("field_mapping", "cached", document=relative_path, mapped_fields=sum(bool(v) for v in cached["field_boxes"].values()), field_count=len(cached["field_boxes"]))
                emit("pdf_features", "cached", document=relative_path, revision_count=cached.get("revision_count"), signature_present=cached.get("signature_present"))
                return {
                    "relative_path": relative_path,
                    "document_type": cached["document_type"],
                    "page_modes": cached["page_modes"],
                    "fields": cached["fields"],
                    "field_boxes": cached["field_boxes"],
                    "llm_status": cached["llm_status"],
                    "file_sha256": file_hash,
                    "pdf_metadata": cached.get("pdf_metadata", {}),
                    "revision_count": cached.get("revision_count"),
                    "signature_present": cached.get("signature_present"),
                    "signature_intact": cached.get("signature_intact"),
                    "signature_covers_file": cached.get("signature_covers_file"),
                    "field_font_spans": cached.get("field_font_spans", {}),
                }
        except (OSError, json.JSONDecodeError, KeyError, TypeError):
            pass
    emit("cache", "miss", document=relative_path, file_sha256=file_hash)

    start = time.perf_counter()
    try:
        text, words, page_modes = extract_pdf(path)
    except Exception as exc:
        emit("text_or_ocr", "error", document=relative_path, error=str(exc))
        raise
    elapsed = round(time.perf_counter() - start, 3)
    for page_number, mode in enumerate(page_modes, start=1):
        emit("text_or_ocr", "complete", document=relative_path, page=page_number, method=mode, word_count=sum(w["page"] == page_number for w in words), seconds=elapsed)

    doc_type = classify_document(text)
    emit("classify", "complete", document=relative_path, document_type=doc_type)

    redacted_text, token_map, redaction_audit = redact_personal_data(text)
    append_redaction_audit(cache_dir, file_hash, redaction_audit)
    emit("redact", "complete", document=relative_path, categories={entry["category"]: entry["occurrences"] for entry in redaction_audit}, replacements=len(redaction_audit))

    fallback_fields = local_extract(text, doc_type)
    llm_status = "local_fallback"
    if use_gemini and api_key:
        try:
            emit("gemini_extract", "started", document=relative_path, model=GEMINI_MODEL, input_chars=len(redacted_text))
            fields = gemini_extract(redacted_text, api_key, doc_type)
            fields = restore_redactions(fields, token_map)
            # Preserve explicit local findings where the model returned null.
            for field, value in fallback_fields.items():
                if fields.get(field) is None and value is not None:
                    fields[field] = value
            fields["document_type"] = doc_type
            fields = validate_fields(fields)
            llm_status = "gemini_free_tier"
            emit("gemini_extract", "complete", document=relative_path, model=GEMINI_MODEL)
        except Exception as exc:
            fields = fallback_fields
            llm_status = "local_fallback_after_gemini_error"
            emit("gemini_extract", "fallback", document=relative_path, error=str(exc))
    else:
        fields = fallback_fields
        emit("gemini_extract", "skipped", document=relative_path, reason="free-tier Gemini not enabled or API key unavailable; using local extraction")

    field_boxes = map_fields(fields, words)
    mapped = sum(bool(boxes) for boxes in field_boxes.values())
    emit("field_mapping", "complete", document=relative_path, mapped_fields=mapped, field_count=len(field_boxes))
    pdf_features = collect_pdf_features(path, fields, field_boxes)
    mixed_field_count = sum(
        len({span["font"] for span in spans}) > 1
        for spans in pdf_features["field_font_spans"].values()
    )
    emit("pdf_features", "complete", document=relative_path, revision_count=pdf_features["revision_count"], signature_present=pdf_features["signature_present"], mixed_font_fields=mixed_field_count)

    cached = {
        "pipeline_version": PIPELINE_VERSION,
        "mode": desired_mode,
        "file_sha256": file_hash,
        "document_type": doc_type,
        "extracted_text": text,
        "word_boxes": words,
        "page_modes": page_modes,
        "fields": fields,
        "field_boxes": field_boxes,
        "llm_status": llm_status,
        "redaction_summary": redaction_audit,
        **pdf_features,
    }
    cache_path.write_text(json.dumps(cached, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")
    write_demo_status(cache_dir, llm_status)
    return {
        "relative_path": relative_path,
        "document_type": doc_type,
        "page_modes": page_modes,
        "fields": fields,
        "field_boxes": field_boxes,
        "llm_status": llm_status,
        "file_sha256": file_hash,
        **pdf_features,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=10, help="number of generated docs to evaluate (default: 10)")
    parser.add_argument("--inputs", choices=("mixed", "original", "scanned"), default="mixed")
    parser.add_argument("--ground-truth", type=Path, default=Path(__file__).resolve().parent / "output" / "ground_truth.csv")
    parser.add_argument("--data-root", type=Path, default=Path(__file__).resolve().parent / "output")
    parser.add_argument("--cache-dir", type=Path, default=Path(__file__).resolve().parent / "cache")
    parser.add_argument(
        "--gemini-free-tier",
        action="store_true",
        help="enable the fixed Gemini Flash-Lite model; use only an API key on a free-tier project",
    )
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be positive")
    if not args.ground_truth.is_file():
        parser.error(f"ground truth not found: {args.ground_truth}")
    api_key = os.environ.get("GEMINI_API_KEY")
    if args.gemini_free_tier and not api_key:
        parser.error("--gemini-free-tier needs GEMINI_API_KEY from a free-tier Google AI Studio project")

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    with args.ground_truth.open(newline="", encoding="utf-8-sig") as stream:
        gt_rows = list(csv.DictReader(stream))
    by_original_path: dict[str, dict[str, Any]] = {}
    for row in gt_rows:
        row["correct_fields_json"] = json.loads(row["correct_fields_json"])
        row["observed_fields_json"] = json.loads(row["observed_fields_json"])
        by_original_path[row["original_pdf"]] = row
        by_original_path[row["scanned_pdf"]] = row

    records = select_rows(gt_rows, min(args.limit, len(gt_rows)), args.inputs)
    outputs: list[dict[str, Any]] = []
    for record in records:
        result = run_one(record, args.data_root, args.cache_dir, args.gemini_free_tier, api_key)
        result["document_type"] = result["document_type"]
        outputs.append(result)
        # Keep the report input limited to the chosen 10 examples.
        record["relative_path"] = result["relative_path"]

    eval_map = {result["relative_path"]: by_original_path[result["relative_path"]] for result in outputs}
    print(f"\nProcessed {len(outputs)} documents; LLM modes: {dict((mode, sum(o['llm_status'] == mode for o in outputs)) for mode in sorted({o['llm_status'] for o in outputs}))}")
    emit_field_accuracy(outputs, eval_map)
    print(f"\nRedaction audit: {args.cache_dir / 'redaction_audit.jsonl'}")
    print(f"Hash cache: {args.cache_dir}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        emit("pipeline", "cancelled")
        raise SystemExit(130)

