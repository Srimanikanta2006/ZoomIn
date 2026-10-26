#!/usr/bin/env python3
"""Run the YAML evaluator over the generated synthetic manifest and PDFs."""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.validation import ValidationApplication, ValidationDocument, ValidationRequest, evaluate
from api.pdf_features import collect_pdf_features
from data.pipeline import classify_document, extract_pdf, local_extract, map_fields


def main() -> int:
    output_dir = Path(__file__).resolve().parent / "output"
    manifest = output_dir / "ground_truth.csv"
    request_apps: list[ValidationApplication] = []

    with manifest.open(newline="", encoding="utf-8-sig") as stream:
        rows = list(csv.DictReader(stream))
    for row in rows:
        app_id = uuid5(NAMESPACE_URL, f"preflight:{row['application_number']}")
        institution_id = row["institution_code"]
        doc_path = output_dir / row["original_pdf"]
        text, word_boxes, _page_modes = extract_pdf(doc_path)
        doc_type = classify_document(text)
        fields = local_extract(text, doc_type)
        field_boxes = map_fields(fields, word_boxes)
        if fields.get("signature_present") is not None:
            signature_words = [word for word in word_boxes if word["text"].casefold().startswith("signature")]
            if signature_words:
                field_boxes["signature_present"] = [{"page": w["page"], "bbox": w["bbox"], "word": w["text"]} for w in signature_words[:1]]
        pdf_features = collect_pdf_features(doc_path, fields, field_boxes)

        correct_fields = json.loads(row["correct_fields_json"])
        aliases = {"institution_name": correct_fields.get("institution_aliases", [])}
        application = ValidationApplication(
            application_id=app_id,
            application_number=row["application_number"],
            institution_id=institution_id,
            institution_name=row["institution_name"],
            application_type="single_document_demo",
            claims={"values": {key: value for key, value in correct_fields.items() if key != "institution_aliases"}, "aliases": aliases},
            documents=[ValidationDocument(
                document_id=row["record_id"],
                file_name=doc_path.name,
                document_type=row["document_type"],
                sha256=row["document_sha256"],
                fields=fields,
                field_boxes=field_boxes,
                **pdf_features,
            )],
        )
        request_apps.append(application)

    result = evaluate(ValidationRequest(applications=request_apps))
    expected_to_rule = {
        "expired_validity": ("DOCUMENT-VALIDITY-PERIOD", "valid_until"),
        "name_mismatch": ("CLAIM-FIELD-COMPARISON", "institution_name"),
        "wrong_id": ("CLAIM-FIELD-COMPARISON", "document_reference"),
        "edited_date": ("CLAIM-FIELD-COMPARISON", "issue_date"),
        "duplicate_document_across_institutions": ("DUPLICATE-FILE-CROSS-INSTITUTION", None),
        "missing_signature": ("CLAIM-FIELD-COMPARISON", "signature_present"),
        "same_faculty_id_in_3_institutions": ("SHARED-FACULTY-REFERENCE", None),
        "same_address_in_2_applications": ("SHARED-INSTITUTION-ADDRESS", None),
    }
    finding_keys = {
        (str(claim.application_id), claim.field_key, claim.finding.rule_id)
        for claim in result.claims
        if claim.status in {"Contradicted", "Expired"}
    }
    cross_rule_ids = {rule_id for rule_id, field in expected_to_rule.values() if field is None}
    finding_keys.update(
        (str(finding.application_id), "", finding.rule_id)
        for finding in result.findings
        if finding.rule_id in cross_rule_ids
    )

    print(f"Evaluated {len(request_apps)} synthetic applications; emitted {len(result.findings)} standard findings and {len(result.claims)} claim-ledger entries.")
    print("Planted defect acceptance (observed document evidence vs declared claims):")
    failed = False
    totals: dict[str, list[int]] = {}
    for row in rows:
        defect = row["defect_label"]
        if defect not in expected_to_rule:
            continue
        rule_id, field = expected_to_rule[defect]
        app_id = str(uuid5(NAMESPACE_URL, f"preflight:{row['application_number']}"))
        caught = (app_id, field or "", rule_id) in finding_keys
        counter = totals.setdefault(defect, [0, 0])
        counter[0] += int(caught)
        counter[1] += 1
        if not caught:
            failed = True
    for defect, (caught, total) in totals.items():
        print(f"{defect}: {caught}/{total} caught")
    evidence_ok = True
    for row in rows:
        if row["defect_label"] not in expected_to_rule:
            continue
        rule_id, field = expected_to_rule[row["defect_label"]]
        app_id = str(uuid5(NAMESPACE_URL, f"preflight:{row['application_number']}"))
        matches = [
            finding for finding in result.findings
            if str(finding.application_id) == app_id and finding.rule_id == rule_id
            and (field is None or any(claim.finding.finding_id == finding.finding_id and claim.field_key == field for claim in result.claims))
        ]
        evidence_ok = evidence_ok and bool(matches) and all(finding.evidence.page is not None and finding.evidence.bbox is not None for finding in matches)
    print(f"Planted defect findings have page and bbox evidence: {evidence_ok}")
    decoy_ids = {
        str(uuid5(NAMESPACE_URL, f"preflight:{row['application_number']}"))
        for row in rows if row["decoy_label"]
    }
    decoy_conflicts = [
        claim for claim in result.claims
        if str(claim.application_id) in decoy_ids and claim.status in {"Contradicted", "Expired"}
    ]
    print(f"Valid decoys without claim conflicts: {10 if not decoy_conflicts else 10 - len({str(item.application_id) for item in decoy_conflicts})}/10")
    for claim in decoy_conflicts:
        print(f"  decoy conflict: application {claim.application_id}, {claim.field_key} ({claim.status})")
    reason_checks = {
        "expired_validity": "validity date",
        "name_mismatch": "institution name",
        "wrong_id": "document reference",
        "edited_date": "issue date",
        "duplicate_document_across_institutions": "same document file",
        "missing_signature": "blank signature line",
    }
    reasons_ok = all(
        any(phrase in finding.reason.casefold() for finding in result.findings if finding.rule_id == expected_to_rule[defect][0])
        for defect, phrase in reason_checks.items()
    )
    print(f"Expected reason text present for defects #1-#6: {reasons_ok}")
    failed = failed or not reasons_ok or not evidence_ok or bool(decoy_conflicts)

    anomaly_rule_ids = {
        "metadata_inconsistency": "PDF-METADATA-CONTENT-MISMATCH",
        "post_signature_modification": "PDF-POST-SIGNATURE-CHANGE",
        "multiple_revisions": "PDF-MULTIPLE-REVISIONS",
        "mixed_fonts": "PDF-MIXED-FONTS-IN-FIELD",
        "impossible_dates": "FIELD-IMPOSSIBLE-DATE",
        "id_formats": "FIELD-ID-FORMAT",
    }
    anomaly_labels = {
        "metadata_inconsistency": set(),
        "post_signature_modification": set(),
        "multiple_revisions": set(),
        "mixed_fonts": {"edited_date"},
        "impossible_dates": set(),
        "id_formats": {"wrong_id"},
    }
    anomaly_predictions: dict[str, set[str]] = {name: set() for name in anomaly_rule_ids}
    for finding in result.findings:
        for check, rule_id in anomaly_rule_ids.items():
            if finding.rule_id == rule_id:
                anomaly_predictions[check].add(str(finding.application_id))
    print("Anomaly check precision / recall against labeled synthetic cases:")
    for check, rule_id in anomaly_rule_ids.items():
        positives = {
            str(uuid5(NAMESPACE_URL, f"preflight:{row['application_number']}"))
            for row in rows if row["defect_label"] in anomaly_labels[check]
        }
        predicted = anomaly_predictions[check]
        tp = len(positives & predicted)
        fp = len(predicted - positives)
        fn = len(positives - predicted)
        tn = len(rows) - tp - fp - fn
        precision = f"{tp / (tp + fp):.2f}" if tp + fp else "N/A"
        recall = f"{tp / (tp + fn):.2f}" if tp + fn else "N/A"
        print(f"{check}: precision={precision}, recall={recall}, TP={tp}, FP={fp}, FN={fn}, TN={tn}")
        failed = failed or fn > 0 or fp > 0

    decoy_application_ids = {
        str(uuid5(NAMESPACE_URL, f"preflight:{row['application_number']}"))
        for row in rows if row["decoy_label"]
    }
    decoy_anomaly_findings = [
        finding for finding in result.findings
        if finding.rule_id in set(anomaly_rule_ids.values()) and str(finding.application_id) in decoy_application_ids
    ]
    print(f"Anomaly findings on valid decoys: {len(decoy_anomaly_findings)}")
    failed = failed or bool(decoy_anomaly_findings)
    print(f"All findings conform to the standard shape: {all(set(f.model_dump()) == {'finding_id','application_id','type','severity','document','evidence','rule_id','reason','confidence','status'} for f in result.findings)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
