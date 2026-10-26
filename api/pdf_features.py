"""Collect local PDF metadata, signature integrity, revisions, and font spans."""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import pymupdf


DATE_TOKEN = re.compile(r"\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,4}|\d{1,2}/\d{1,2}/\d{4})\b")
WATERMARK_TEXT = re.compile(r"\b(?:SYNTHETIC DEMO|DEMO COPY CHECKED)\b", re.I)


def _intersects(left: list[float], right: tuple[float, float, float, float], padding: float = 0.0) -> bool:
    return not (
        left[2] < right[0] - padding or left[0] > right[2] + padding
        or left[3] < right[1] - padding or left[1] > right[3] + padding
    )


def collect_pdf_features(
    path: Path,
    fields: dict[str, Any],
    field_boxes: dict[str, list[Any]],
) -> dict[str, Any]:
    """Read local PDF features only; never contacts a hosted service."""
    pdf = pymupdf.open(path)
    metadata = dict(pdf.metadata or {})
    revision_count = int(pdf.version_count)
    field_font_spans: dict[str, list[dict[str, Any]]] = {}
    try:
        for field, boxes in field_boxes.items():
            spans_found: list[dict[str, Any]] = []
            for box in boxes:
                page_number = box.page if hasattr(box, "page") else box.get("page")
                bbox = box.bbox if hasattr(box, "bbox") else box.get("bbox")
                if page_number is None or bbox is None or page_number > len(pdf):
                    continue
                page = pdf[page_number - 1]
                for block in page.get_text("dict").get("blocks", []):
                    for line in block.get("lines", []):
                        line_spans = line.get("spans", [])
                        intersecting = [span for span in line_spans if _intersects(span["bbox"], bbox)]
                        if not intersecting:
                            continue
                        if field in {"issue_date", "valid_until", "payment_date"}:
                            # Include adjacent date spans on a correction line, but
                            # exclude the bold field label from the font comparison.
                            candidates = [span for span in line_spans if DATE_TOKEN.search(span.get("text", ""))]
                        else:
                            candidates = intersecting
                        for span in candidates:
                            if WATERMARK_TEXT.search(str(span.get("text", ""))):
                                continue
                            record = {
                                "font": str(span.get("font", "unknown")),
                                "text": str(span.get("text", "")).strip(),
                                "page": page_number,
                                "bbox": [round(float(v), 2) for v in span["bbox"]],
                            }
                            if record["text"] and record not in spans_found:
                                spans_found.append(record)
            if spans_found:
                field_font_spans[field] = spans_found
    finally:
        pdf.close()

    signed = False
    intact: bool | None = None
    covers_file: bool | None = None
    try:
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.sign.validation import SignatureCoverageLevel, validate_pdf_signature
        from pyhanko_certvalidator import ValidationContext

        logger = logging.getLogger("pyhanko.sign.validation.generic_cms")
        previous_level = logger.level
        logger.setLevel(logging.CRITICAL)
        try:
            with path.open("rb") as stream:
                reader = PdfFileReader(stream)
                signed = bool(reader.embedded_signatures)
                if signed:
                    status = validate_pdf_signature(
                        reader.embedded_signatures[0],
                        signer_validation_context=ValidationContext(trust_roots=[], allow_fetching=False),
                    )
                    intact = bool(status.intact)
                    covers_file = status.coverage == SignatureCoverageLevel.ENTIRE_FILE
        finally:
            logger.setLevel(previous_level)
    except Exception:
        # Signature inspection is optional at runtime; report unknown and keep
        # the other local checks available if a PDF is unreadable by pyHanko.
        if signed:
            intact = None
            covers_file = None

    return {
        "pdf_metadata": {key: value for key, value in metadata.items() if value is not None},
        "revision_count": revision_count,
        "signature_present": signed,
        "signature_intact": intact,
        "signature_covers_file": covers_file,
        "field_font_spans": field_font_spans,
    }
