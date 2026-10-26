# Synthetic document dataset

Run `python data/generate.py` from the repository root. Install `data/requirements.txt` first and make Poppler's `pdftoppm` available on `PATH`.

The generator writes 50 source PDFs and 50 noisy, image-only scan variants to `data/output/`, plus `ground_truth.csv` and the public certificate for a local test CA. The signer and CA private keys are temporary and are deleted after generation. The test CA is not a public trust root.

All institutions and records are fictional. Every PDF is visibly marked `SYNTHETIC DEMO - NOT AN OFFICIAL RECORD`. The CSV contains expected fields, observed fields, defect labels and cross-document group IDs. It includes 18 labeled defect instances and 10 odd-looking but valid decoys. The fixed default seed makes the sample data stable; use `--seed` to generate a different set.

The defect groups cover expired validity, name mismatch, wrong ID, edited date, duplicate documents across institutions, missing signature, one faculty reference shared across three institutions, and one address shared across two applications. Some originals have a digital signature from the local test CA. Scanned copies are image-only and therefore do not retain embedded digital signatures.

## Extraction pipeline

Run `python data/pipeline.py --limit 10 --inputs mixed` after installing `data/requirements.txt` and Tesseract OCR. The pipeline uses PDF text first and OCR only for pages without a text layer. It emits JSON progress events, caches extraction by source-file SHA-256, redacts names and identifier-like values before any hosted-model call, and records redaction categories and counts without storing the removed values in the audit log. Field locations are matched to extracted word boxes.

The default is a local regex-based fallback. Gemini is optional: set `GEMINI_API_KEY` and pass `--gemini-free-tier` to use the fixed `gemini-2.5-flash-lite` model with a strict JSON response schema. Only use an API key on a Google AI Studio free-tier project; there is no paid-model fallback. If the request fails, the pipeline uses local extraction. Do not send real or personal documents to this synthetic-data demo.

The run prints per-field accuracy against observed values in `ground_truth.csv`; canonical agreement is printed separately because some generated documents intentionally contain defects. OCR accuracy depends on scan quality and may be lower.

The YAML validation rules also check PDF title metadata, post-signature changes, revision counts, mixed text-span fonts, calendar dates, and ID formats. Run `python data/validate_dataset.py` to print anomaly precision/recall. Mixed-font and ID-format checks have labeled positives in this dataset; checks without labeled positive examples report precision/recall as `N/A` rather than inventing a score. Signature trust is not established by integrity checking; human review remains necessary.
