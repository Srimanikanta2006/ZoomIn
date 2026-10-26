# PreFlight project instructions

PreFlight is a hackathon prototype for AICTE application validation. Use synthetic data only.

- All services and APIs must be free to use; do not add paid dependencies or services.
- Humans make every decision. Never claim a document is forged. Say “indicator requiring human verification.”
- Every module emits findings with exactly this shape: `finding_id`, `application_id`, `type`, `severity`, `document`, `evidence` (`page`, `bbox`, `extracted`), `rule_id`, `reason`, `confidence`, `status`.
- Store validation rules in YAML; do not hardcode rules.
- Log every action to the hash-chained audit table.
- Redact personal data before any hosted-model call.
- Cache LLM and OCR results by file hash and degrade gracefully on failure.
- Follow the root `DESIGN.md` for UI, using short, plain text. The full Stitch export is retained in `design/stitch/` as the screen and code reference.
- Stack: Next.js, Tailwind, shadcn, FastAPI, Supabase Postgres/Storage, PyMuPDF, PaddleOCR/Tesseract, pyHanko, OpenCV, imagehash, and NetworkX.
- Keep commits small, explain changes briefly, and do not add unrequested features.
