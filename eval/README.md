# Synthetic evaluation

Run `python eval/run.py` from the repository root. It processes all 50 originals and 50 scanned variants through `data.pipeline.run_one`, then sends each 50-document input mode through the production YAML evaluator. The default is local extraction; the optional `--gemini-free-tier` flag uses the existing fixed free-tier Gemini path only when configured.

The runner writes `results/metrics.json`, `results/field_accuracy.csv`, and `results/defect_metrics.csv`. It reports observed-value extraction accuracy by field and input mode, per-defect precision/recall, defect-check false-positive rate across valid decoys, wall time, pipeline errors, and individual missed cases. Defect-to-rule mappings are read from `api/rules/validation.yaml` under `evaluation.defect_checks`.

The `/metrics` page loads the generated JSON through the authenticated FastAPI `GET /eval/metrics` endpoint. The endpoint and page view are recorded in the audit chain. The deployment image includes the latest report at build time; rerun the evaluation and rebuild the image to refresh it.

All records and reports are synthetic. Metrics describe this generated set and should not be read as real-world accuracy estimates.
