#!/usr/bin/env python3
"""Create five synthetic-only PDF red-team attempts for the evaluation runner."""
from __future__ import annotations

import csv
import json
import shutil
import sys
from pathlib import Path
from typing import Any

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from api.validation import load_rules

DATA = ROOT / "data" / "output"
OUT = Path(__file__).resolve().parent / "attempts"


def _manifest() -> dict[int, dict[str, Any]]:
    with (DATA / "ground_truth.csv").open(newline="", encoding="utf-8-sig") as stream:
        return {int(row["record_id"][-4:]): row for row in csv.DictReader(stream)}


def _copy_source(rows: dict[int, dict[str, Any]], record_no: int, dest: Path) -> pymupdf.Document:
    source = DATA / rows[record_no]["original_pdf"]
    shutil.copyfile(source, dest)
    return pymupdf.open(dest)


def generate() -> list[dict[str, Any]]:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = _manifest()
    defect_checks = load_rules().get("evaluation", {}).get("defect_checks", {})
    signature_rule = load_rules().get("anomaly_checks", {}).get("post_signature_modification", {}).get("id", "")
    cases: list[dict[str, Any]] = []

    # 1. Place a valid-looking expiry string in white text on an expired file.
    target = OUT / "attempt_01_hidden_validity_text.pdf"
    doc = _copy_source(rows, 1, target)
    doc[0].insert_text((40, doc[0].rect.height - 30), "Valid through: 2028-01-01", fontsize=8, color=(1, 1, 1), overlay=True)
    doc.saveIncr(); doc.close()
    cases.append({"attempt_id": "RT-01", "file": target.relative_to(ROOT).as_posix(), "source_record_ids": [1], "attack": "Add a white-on-white valid date after the visible expired date.", "target_defect": "expired_validity", "target_field": "valid_until", "target_rule_id": defect_checks["expired_validity"]["rule_id"], "attacker_goal": "Hide the expired validity date from a text-first review."})

    # 2. Replace a wrong reference's ASCII zero with a full-width lookalike.
    target = OUT / "attempt_02_confusable_reference.pdf"
    doc = _copy_source(rows, 15, target)
    observed = json.loads(rows[15]["observed_fields_json"])["document_reference"]
    rects = doc[0].search_for(observed)
    if not rects:
        doc.close(); raise RuntimeError("Could not locate the synthetic reference for RT-02.")
    rect = rects[0]
    doc[0].add_redact_annot(rect, fill=(1, 1, 1))
    doc[0].apply_redactions()
    lookalike = observed.replace("0", "０", 1)
    doc[0].insert_text((rect.x0, rect.y1 - 1), lookalike, fontsize=8, color=(0, 0, 0), overlay=True)
    doc.saveIncr(); doc.close()
    cases.append({"attempt_id": "RT-02", "file": target.relative_to(ROOT).as_posix(), "source_record_ids": [15], "attack": "Use a full-width zero in a wrong document reference.", "target_defect": "wrong_id", "target_field": "document_reference", "target_rule_id": defect_checks["wrong_id"]["rule_id"], "attacker_goal": "Make a wrong reference harder to compare visually and by text rules."})

    # 3. Add signature-looking text to a document whose signature line is blank.
    target = OUT / "attempt_03_signature_lookalike.pdf"
    doc = _copy_source(rows, 30, target)
    doc[0].insert_text((42, 95), "Signature: /s/ Synthetic Officer", fontsize=8, color=(0, 0, 0), overlay=True)
    doc.saveIncr(); doc.close()
    cases.append({"attempt_id": "RT-03", "file": target.relative_to(ROOT).as_posix(), "source_record_ids": [30], "attack": "Add printed signature-looking text without a cryptographic signature.", "target_defect": "missing_signature", "target_field": "signature_present", "target_rule_id": defect_checks["missing_signature"]["rule_id"], "attacker_goal": "Make a blank signature field appear present to text extraction."})

    # 4. Re-serialize one side of the known duplicate pair to change its hash.
    target = OUT / "attempt_04_reserialized_duplicate.pdf"
    source = DATA / rows[41]["original_pdf"]
    doc = pymupdf.open(source)
    doc.save(target, garbage=4, deflate=True)
    doc.close()
    cases.append({"attempt_id": "RT-04", "file": target.relative_to(ROOT).as_posix(), "source_record_ids": [29, 41], "attack": "Re-serialize a byte-identical duplicate so its SHA-256 changes.", "target_defect": "duplicate_document_across_institutions", "target_field": None, "target_rule_id": defect_checks["duplicate_document_across_institutions"]["rule_id"], "attacker_goal": "Avoid exact-file duplicate matching while preserving page content."})

    # 5. Append a harmless-looking update to a signed sample as a new revision.
    target = OUT / "attempt_05_signed_incremental_update.pdf"
    shutil.copyfile(DATA / rows[2]["original_pdf"], target)
    doc = pymupdf.open(target)
    doc[0].insert_text((42, doc[0].rect.height - 42), "Synthetic later update", fontsize=8, color=(0.1, 0.1, 0.1), overlay=True)
    doc.save(target, incremental=True, encryption=pymupdf.PDF_ENCRYPT_KEEP)
    doc.close()
    cases.append({"attempt_id": "RT-05", "file": target.relative_to(ROOT).as_posix(), "source_record_ids": [2], "attack": "Append a later PDF revision to a locally test-signed sample.", "target_defect": "post_signature_modification", "target_field": None, "target_rule_id": signature_rule, "attacker_goal": "Keep the signed appearance while changing the PDF after signing."})

    (Path(__file__).resolve().parent / "cases.json").write_text(json.dumps(cases, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    return cases


if __name__ == "__main__":
    for case in generate():
        print(f"{case['attempt_id']} {case['file']}")
