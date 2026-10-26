#!/usr/bin/env python3
"""Run extraction, YAML validation, defect metrics, and the synthetic red team."""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.validation import ValidationApplication, ValidationDocument, ValidationRequest, evaluate, load_rules
from data.pipeline import EMPTY_FIELDS, PIPELINE_VERSION, run_one, sha256_file, values_equal
from eval.red_team.generate import generate as generate_red_team

DATA_DIR = ROOT / "data" / "output"
RESULTS_DIR = Path(__file__).resolve().parent / "results"
CACHE_DIR = Path(__file__).resolve().parent / "cache"

DEFECT_RULES: dict[str, tuple[str, str | None]] = {
    name: (check["rule_id"], check.get("field"))
    for name, check in load_rules().get("evaluation", {}).get("defect_checks", {}).items()
}


def read_manifest(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8-sig") as stream:
        rows = list(csv.DictReader(stream))
    for row in rows:
        row["correct_fields_json"] = json.loads(row["correct_fields_json"])
        row["observed_fields_json"] = json.loads(row["observed_fields_json"])
    return rows


def input_records(rows: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    records = []
    for row in rows:
        modes = ("original", "scanned") if mode == "both" else (mode,)
        for item_mode in modes:
            relative_path = row[f"{item_mode}_pdf"]
            records.append({**row, "relative_path": relative_path, "input_mode": item_mode})
    return records


def process_records(records: list[dict[str, Any]], data_root: Path, cache_dir: Path, gemini: bool, api_key: str | None) -> tuple[list[dict[str, Any]], int]:
    results = []
    cache_hits = 0
    desired_mode = f"gemini:{__import__('data.pipeline', fromlist=['GEMINI_MODEL']).GEMINI_MODEL}" if gemini else "local"
    for index, record in enumerate(records, start=1):
        path = data_root / record["relative_path"]
        if not path.is_file():
            raise FileNotFoundError(f"Generated input is missing: {path}")
        file_hash = sha256_file(path)
        cache_path = cache_dir / f"{file_hash}.json"
        cache_hit = False
        if cache_path.is_file():
            try:
                cached = json.loads(cache_path.read_text(encoding="utf-8"))
                cache_hit = cached.get("pipeline_version") == PIPELINE_VERSION and cached.get("mode") == desired_mode
            except (OSError, json.JSONDecodeError):
                pass
        started = time.perf_counter()
        try:
            output = run_one(record, data_root, cache_dir, gemini, api_key)
            output_error = None
        except Exception as exc:  # Preserve the rest of a run when OCR/runtime fails.
            output = {"relative_path": record["relative_path"], "document_type": "unknown", "page_modes": [], "fields": dict(EMPTY_FIELDS), "field_boxes": {}, "llm_status": "pipeline_error", "file_sha256": file_hash}
            output_error = f"{type(exc).__name__}: {exc}"
        elapsed = time.perf_counter() - started
        results.append({
            **output,
            "record_id": record["record_id"],
            "application_number": record["application_number"],
            "defect_label": record["defect_label"],
            "decoy_label": record["decoy_label"],
            "input_mode": record["input_mode"],
            "processing_seconds": round(elapsed, 4),
            "cache_hit": cache_hit,
            "pipeline_error": output_error,
        })
        cache_hits += int(cache_hit)
        print(f"Evaluation progress: {index}/{len(records)} · {record['relative_path']} · {elapsed:.2f}s" + (" · cached" if cache_hit else ""), flush=True)
    return results, cache_hits


def field_metrics(records: list[dict[str, Any]], outputs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_path = {item["relative_path"]: item for item in outputs}
    totals: dict[tuple[str, str, str], list[int]] = defaultdict(lambda: [0, 0])
    for record in records:
        output = by_path[record["relative_path"]]
        mode = record["input_mode"]
        observed = record["observed_fields_json"]
        canonical = record["correct_fields_json"]
        fields = output["fields"]
        total = totals[(mode, "document_type", "observed")]
        total[1] += 1; total[0] += int(output["document_type"] == record["document_type"])
        for field, target in observed.items():
            if field not in fields:
                continue
            current = totals[(mode, field, "observed")]
            current[1] += 1; current[0] += int(values_equal(fields.get(field), target, field))
        for field, target in canonical.items():
            if field == "institution_aliases" or field not in fields:
                continue
            current = totals[(mode, field, "canonical")]
            current[1] += 1; current[0] += int(values_equal(fields.get(field), target, field))
    return [
        {"input_mode": mode, "field": field, "target": target, "correct": counts[0], "total": counts[1], "accuracy": round(counts[0] / counts[1], 4) if counts[1] else None}
        for (mode, field, target), counts in sorted(totals.items())
    ]


def make_application(record: dict[str, Any], output: dict[str, Any], suffix: str = "") -> ValidationApplication:
    correct = record["correct_fields_json"]
    aliases = {"institution_name": correct.get("institution_aliases", [])}
    claims = {key: value for key, value in correct.items() if key != "institution_aliases"}
    fields = dict(output.get("fields") or EMPTY_FIELDS)
    fields["document_type"] = output.get("document_type", record["document_type"])
    boxes = output.get("field_boxes") or {}
    if fields.get("signature_present") is not None:
        signature_words = [word for boxes_for_field in boxes.values() for word in boxes_for_field if str(word.get("word", "")).casefold().startswith("signature")]
        if signature_words:
            boxes = {**boxes, "signature_present": signature_words[:1]}
    document_data = {
        "document_id": f"{record['record_id']}-{suffix or output.get('input_mode','doc')}",
        "file_name": Path(output.get("relative_path", record["original_pdf"])).name,
        "document_type": output.get("document_type", record["document_type"]),
        "sha256": output.get("file_sha256") or record["document_sha256"],
        "fields": fields,
        "field_boxes": boxes,
        **{key: output[key] for key in ("pdf_metadata", "revision_count", "signature_present", "signature_intact", "signature_covers_file", "field_font_spans") if key in output},
    }
    return ValidationApplication(
        application_id=uuid5(NAMESPACE_URL, f"preflight:{record['application_number']}"),
        application_number=record["application_number"],
        institution_id=record["institution_code"],
        institution_name=record["institution_name"],
        application_type="single_document_demo",
        claims={"values": claims, "aliases": aliases},
        documents=[ValidationDocument(**document_data)],
    )


def run_validation(rows: list[dict[str, Any]], outputs: list[dict[str, Any]], mode: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    by_path = {item["relative_path"]: item for item in outputs if item["input_mode"] == mode}
    records = [{**row, "relative_path": row[f"{mode}_pdf"], "input_mode": mode} for row in rows]
    applications = [make_application(row, by_path[record["relative_path"]], mode) for row, record in zip(rows, records)]
    response = evaluate(ValidationRequest(applications=applications))
    app_ids = {str(app.application_id): app for app in applications}
    flagged_fields: dict[str, set[str]] = defaultdict(set)
    for claim in response.claims:
        if claim.status.value in {"Contradicted", "Expired"}:
            flagged_fields[str(claim.application_id)].add(claim.field_key)
    flagged_rules: dict[str, set[str]] = defaultdict(set)
    for finding in response.findings:
        flagged_rules[str(finding.application_id)].add(finding.rule_id)

    defect_metrics = []
    misses = []
    predicted_by_label: dict[str, set[str]] = {}
    for defect, (rule_id, field) in DEFECT_RULES.items():
        positives = {row["application_number"] for row in rows if row["defect_label"] == defect}
        predicted = set()
        for app_id, application in app_ids.items():
            app_number = application.application_number
            has_prediction = field in flagged_fields[app_id] if field else rule_id in flagged_rules[app_id]
            if has_prediction:
                predicted.add(app_number)
        predicted_by_label[defect] = predicted
        tp = len(predicted & positives)
        fp = len(predicted - positives)
        fn = len(positives - predicted)
        tn = len(rows) - tp - fp - fn
        defect_metrics.append({
            "input_mode": mode, "defect_type": defect, "rule_id": rule_id, "field": field,
            "positive_count": len(positives), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": round(tp / (tp + fp), 4) if tp + fp else None,
            "recall": round(tp / (tp + fn), 4) if tp + fn else None,
            "false_positive_rate": round(fp / (fp + tn), 4) if fp + tn else None,
        })
        misses.extend({"input_mode": mode, "application_number": app_number, "defect_type": defect, "rule_id": rule_id, "field": field, "why": "No matching validation finding was emitted for the planted defect."} for app_number in sorted(positives - predicted))

    decoys = {row["application_number"] for row in rows if row["decoy_label"]}
    decoy_flagged = {app for predicted in predicted_by_label.values() for app in predicted if app in decoys}
    decoy_metrics = {
        "input_mode": mode,
        "decoy_count": len(decoys),
        "flagged_count": len(decoy_flagged),
        "false_positive_rate": round(len(decoy_flagged) / len(decoys), 4) if decoys else None,
        "flagged_applications": sorted(decoy_flagged),
    }
    return {"input_mode": mode, "finding_count": len(response.findings), "defect_metrics": defect_metrics, "decoy_false_positive_rate": decoy_metrics, "what_we_miss": misses}, applications


def run_red_team(cases: list[dict[str, Any]], rows: list[dict[str, Any]], processed: list[dict[str, Any]], data_root: Path, cache_dir: Path, gemini: bool, api_key: str | None) -> list[dict[str, Any]]:
    by_record = {row["record_id"]: row for row in rows}
    output_by_path = {item["relative_path"]: item for item in processed}
    red_outputs: dict[str, dict[str, Any]] = {}
    for case in cases:
        output = run_one({"relative_path": case["file"]}, data_root, cache_dir, gemini, api_key)
        red_outputs[case["attempt_id"]] = output

    apps: list[ValidationApplication] = []
    case_to_numbers: dict[str, list[str]] = {}
    for case in cases:
        record_numbers = case["source_record_ids"]
        numbers: list[str] = []
        if case["attempt_id"] == "RT-04":
            # Evaluate the source and re-serialized copy as separate institutions.
            source_row, copy_row = by_record["SYN-REC-0029"], by_record["SYN-REC-0041"]
            source_output = output_by_path[source_row["original_pdf"]]
            copy_output = {**red_outputs[case["attempt_id"]], "relative_path": case["file"]}
            apps.extend([make_application(source_row, source_output, "rt-source"), make_application(copy_row, copy_output, "rt-reserialized")])
            numbers = [source_row["application_number"], copy_row["application_number"]]
        else:
            record = by_record[f"SYN-REC-{record_numbers[0]:04d}"]
            output = {**red_outputs[case["attempt_id"]], "relative_path": case["file"]}
            apps.append(make_application(record, output, case["attempt_id"]))
            numbers = [record["application_number"]]
        case_to_numbers[case["attempt_id"]] = numbers

    response = evaluate(ValidationRequest(applications=apps))
    rule_by_app: dict[str, set[str]] = defaultdict(set)
    field_by_app: dict[str, set[str]] = defaultdict(set)
    for finding in response.findings:
        rule_by_app[str(finding.application_id)].add(finding.rule_id)
    for claim in response.claims:
        if claim.status.value in {"Contradicted", "Expired"}:
            field_by_app[str(claim.application_id)].add(claim.field_key)
    app_by_number = {app.application_number: app for app in apps}
    results = []
    for case in cases:
        numbers = case_to_numbers[case["attempt_id"]]
        if case["target_field"]:
            detected = any(case["target_field"] in field_by_app[str(app_by_number[number].application_id)] for number in numbers)
        else:
            detected = any(case["target_rule_id"] in rule_by_app[str(app_by_number[number].application_id)] for number in numbers)
        results.append({
            "attempt_id": case["attempt_id"], "attack": case["attack"], "attacker_goal": case["attacker_goal"],
            "target_defect": case["target_defect"], "target_rule_id": case["target_rule_id"],
            "result": "resisted" if detected else "not_detected",
            "indicator_emitted": detected,
            "applications": numbers,
            "pipeline_error": red_outputs[case["attempt_id"]].get("pipeline_error"),
        })
    return results


def print_report(report: dict[str, Any]) -> None:
    print("\nFIELD EXTRACTION ACCURACY (observed values)")
    print("mode\tfield\tcorrect/total\taccuracy")
    for row in report["field_extraction_accuracy"]:
        if row["target"] == "observed":
            accuracy = "N/A" if row["accuracy"] is None else f"{row['accuracy']:.1%}"
            print(f"{row['input_mode']}\t{row['field']}\t{row['correct']}/{row['total']}\t{accuracy}")
    print("\nFLAG PRECISION / RECALL BY PLANTED DEFECT")
    print("mode\tdefect type\tprecision\trecall\tTP\tFP\tFN")
    for scenario in report["validation"]:
        for row in scenario["defect_metrics"]:
            precision = "N/A" if row["precision"] is None else f"{row['precision']:.1%}"
            recall = "N/A" if row["recall"] is None else f"{row['recall']:.1%}"
            print(f"{row['input_mode']}\t{row['defect_type']}\t{precision}\t{recall}\t{row['tp']}\t{row['fp']}\t{row['fn']}")
        decoys = scenario["decoy_false_positive_rate"]
        print(f"{scenario['input_mode']}\tdecoy false-positive rate\t—\t—\t{decoys['flagged_count']}/{decoys['decoy_count']}\t—\t—")
    print(f"\nAverage pipeline time: {report['average_processing_seconds']:.3f}s per document over {report['documents_processed']} documents")
    print("\nWHAT WE MISS")
    misses = [miss for scenario in report["validation"] for miss in scenario["what_we_miss"]]
    if not misses:
        print("No planted defect was missed in the evaluated modes.")
    else:
        for item in misses:
            print(f"{item['input_mode']}\t{item['application_number']}\t{item['defect_type']}\t{item['why']}")
    print("\nRED-TEAM RESULTS")
    for item in report["red_team"]:
        print(f"{item['attempt_id']}\t{item['result']}\t{item['target_defect']}\t{item['attack']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ground-truth", type=Path, default=DATA_DIR / "ground_truth.csv")
    parser.add_argument("--data-root", type=Path, default=DATA_DIR)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--output-dir", type=Path, default=RESULTS_DIR)
    parser.add_argument("--inputs", choices=("original", "scanned", "both"), default="both")
    parser.add_argument("--gemini-free-tier", action="store_true", help="use the configured free-tier Gemini model via the existing pipeline")
    args = parser.parse_args()
    api_key = os.getenv("GEMINI_API_KEY")
    if args.gemini_free_tier and not api_key:
        parser.error("--gemini-free-tier requires GEMINI_API_KEY from a free-tier project")
    if not args.ground_truth.is_file():
        parser.error(f"Ground truth not found: {args.ground_truth}")
    tesseract = os.getenv("TESSERACT_CMD")
    if not tesseract and Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe").is_file():
        os.environ["TESSERACT_CMD"] = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    rows = read_manifest(args.ground_truth)
    records = input_records(rows, args.inputs)
    outputs, cache_hits = process_records(records, args.data_root, args.cache_dir, args.gemini_free_tier, api_key)
    modes = ("original", "scanned") if args.inputs == "both" else (args.inputs,)
    scenarios = [run_validation(rows, outputs, mode)[0] for mode in modes]
    field_report = field_metrics(records, outputs)
    red_team_cases = generate_red_team()
    red_team = run_red_team(red_team_cases, rows, outputs, ROOT, args.cache_dir, args.gemini_free_tier, api_key)
    red_team_misses = [
        {"input_mode": "red_team", "application_number": item["applications"][0], "defect_type": item["target_defect"], "rule_id": item["target_rule_id"], "field": None, "why": f"Red-team case {item['attempt_id']} was not detected."}
        for item in red_team if not item["indicator_emitted"]
    ]
    errors = [{"relative_path": item["relative_path"], "error": item["pipeline_error"]} for item in outputs if item.get("pipeline_error")]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {"name": "PreFlight synthetic generated set", "records": len(rows), "modes": list(modes), "synthetic_only": True},
        "pipeline": {"llm_mode": "gemini_free_tier" if args.gemini_free_tier else "local", "cache_hits": cache_hits, "cache_misses": len(outputs) - cache_hits},
        "documents_processed": len(outputs),
        "average_processing_seconds": round(sum(item["processing_seconds"] for item in outputs) / len(outputs), 4) if outputs else 0,
        "processing_seconds_total": round(sum(item["processing_seconds"] for item in outputs), 4),
        "field_extraction_accuracy": field_report,
        "validation": scenarios,
        "what_we_miss": [miss for scenario in scenarios for miss in scenario["what_we_miss"]] + red_team_misses,
        "red_team": red_team,
        "pipeline_errors": errors,
    }
    (args.output_dir / "metrics.json").write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    (args.output_dir / "red_team_results.json").write_text(json.dumps(red_team, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    (Path(__file__).resolve().parent / "red_team" / "results.json").write_text(json.dumps(red_team, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    with (args.output_dir / "field_accuracy.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=["input_mode", "field", "target", "correct", "total", "accuracy"])
        writer.writeheader(); writer.writerows(field_report)
    defect_rows = [metric for scenario in scenarios for metric in scenario["defect_metrics"]]
    with (args.output_dir / "defect_metrics.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=["input_mode", "defect_type", "rule_id", "field", "positive_count", "tp", "fp", "fn", "tn", "precision", "recall", "false_positive_rate"])
        writer.writeheader(); writer.writerows(defect_rows)
    print_report(report)
    print(f"\nMetrics JSON: {args.output_dir / 'metrics.json'}")
    print(f"Red-team results: {args.output_dir / 'red_team_results.json'}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
