# Synthetic red-team cases

`generate.py` creates five synthetic PDF attempts from the generated dataset. `cases.json` records each attack goal and the target rule; `results.json` records the latest measured outcome from `eval/run.py`. The attempt PDFs are in `attempts/`.

Current run: three attempts produced their target indicator. The signature-looking text case and the re-serialized duplicate case were not detected. These are reported in Metrics under **What we miss**. Red-team outcomes test the current local pipeline and YAML evaluator only; they do not establish security against other attacks.

Regenerate the PDFs with `python eval/red_team/generate.py`; rerun all metrics with `python eval/run.py`. Every file is fictional, locally generated, and for demonstration only.
