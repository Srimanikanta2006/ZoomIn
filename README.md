---
title: ZoomIn
emoji: 🔍
colorFrom: blue
colorTo: yellow
sdk: docker
app_port: 7860
---

# ZoomIn

AICTE application validation prototype. Demo data must be synthetic; people make all review decisions.

## Monorepo

- `web/` — Next.js, Tailwind, shadcn-compatible UI setup, and Supabase sign-in.
- `api/` — FastAPI health service for the Hugging Face Spaces Docker container.
- `Dockerfile` — Hugging Face Spaces Docker SDK entry point. The API listens on port `7860`.
- `web/supabase/migrations/` — ordered auth, audit, and application schema migrations.
- `web/supabase/seed.sql` — five synthetic demo applications and related records.

## Local setup

1. Copy `.env.example` to `web/.env.local` and set the Supabase URL and anon key.
2. From `web/`, run `supabase start` and `supabase db reset` to apply migrations and seed five demo applications. For a linked project, run `supabase db push`; seed separately only when demo data is wanted.
3. In `web/`, run `npm install` and `npm run dev`.
4. In the repository root, run `uvicorn api.main:app --reload --port 7860` with `WEB_ORIGIN=http://localhost:3000`.

Set `DEMO_MODE=true` for the API and `NEXT_PUBLIC_DEMO_MODE=true` for the web app only when enabling the synthetic demo controls and quick-demo sign-in buttons. Keep both disabled outside a demo environment.

## Audit integrity and officer letters

Migration `202610260007_integrity_letters_handbook.sql` adds the admin-only `POST /audit/verify` integrity check, bilingual editable deficiency-letter drafts from the latest officer-accepted findings, and handbook rule proposal storage. Draft letters require an officer approval RPC before they are marked approved. All create, edit, approve, and integrity-check actions are written to the existing hash chain.

The admin Rule Studio can propose a restricted YAML rule from a pasted handbook clause. `GEMINI_API_KEY` is optional and only needed for this hosted-model action; without it, the API explains that no proposal was created. Detected personal data is redacted before the model call, and only the redacted clause, source hash, YAML, and redaction counts are stored. Repeated clause hashes return the cached proposal. Only the configured YAML fields, operators, and severities can be approved. Approved YAML is loaded by `/validate`; draft YAML is never evaluated. Keep the key out of browser variables and local commits.

Apply migrations with `supabase db push` (or local `supabase db reset`) before using these screens. The audit integrity response covers the chain through the check's snapshot; the check event is appended afterward and is included in the next verification.

## Evaluation and Metrics

Run `python eval/run.py` to process all 50 generated originals and 50 scanned variants through the extraction pipeline and YAML evaluator. The report includes field accuracy, per-defect precision/recall, decoy false-positive rate, average processing time, missed cases, and five synthetic red-team outcomes. Reports are written under `eval/results/`; the authenticated API exposes the latest `metrics.json` to the officer Metrics page. See `eval/README.md` for modes and report notes.

## Demo mode

The Supabase seed preloads five synthetic applications. Apply migration `202610260008_demo_mode.sql` for the admin-only **Reset demo** action and issuer-outage control; reset reopens the sample findings, clears demo reviews and verification checks, restores application status, and records the action in the hash chain. Run `python scripts/warm_backend.py` before presenting to populate the local file-hash extraction cache and warm the API. It processes ten synthetic PDFs by default; pass `--documents 0` to skip extraction, or `--token` / `PREFLIGHT_DEMO_TOKEN` to warm authenticated API views. The API degraded-mode banner appears after a free-tier LLM error and local extraction fallback.

For deployment, set `NEXT_PUBLIC_API_URL` to the API URL used by the browser and `WEB_ORIGIN` to the web app's exact origin. Use only free services and synthetic demo records.

## Validation rules and claim ledger

The API loads application checks from `api/rules/validation.yaml`. It supports field comparisons, fuzzy institution-name matching, date validity, repeated values across documents, application-type document checklists, and PDF metadata, signature, revision, font, date, and ID anomaly checks. `POST /validate` accepts extracted document fields and optional application claims; an `application_form` document can supply those claims directly. Include the PDF features collected by `api/pdf_features.py` for metadata, signature, revision, and font checks. Each claim result links to supporting document fields and includes a standard finding. Successful validation runs append a low-detail event to the Supabase hash-chained audit log; apply the migrations through `202610260003_validation_audit.sql` and send a signed-in bearer token.

Run the synthetic acceptance evaluation with `python data/validate_dataset.py`. It uses the generated canonical manifest as the demo application-form claims and original synthetic PDFs as evidence.
