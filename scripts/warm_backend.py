#!/usr/bin/env python3
"""Warm PreFlight's synthetic PDF cache and make lightweight API requests before a demo."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def request(base_url: str, path: str, token: str | None) -> None:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{base_url.rstrip('/')}{path}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            response.read()
            print(f"ready {path} ({response.status})")
    except (urllib.error.URLError, TimeoutError) as exc:
        raise SystemExit(f"API warm-up failed for {path}: {exc}") from None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=os.getenv("PREFLIGHT_API_URL", "http://localhost:7860"))
    parser.add_argument("--token", default=os.getenv("PREFLIGHT_DEMO_TOKEN"), help="optional signed-in demo token to warm authenticated views")
    parser.add_argument("--documents", type=int, default=10, help="synthetic PDFs to extract/cache locally (0 skips PDF warm-up)")
    args = parser.parse_args()

    if args.documents:
        pipeline = ROOT / "data" / "pipeline.py"
        dataset = ROOT / "data" / "output" / "ground_truth.csv"
        if not dataset.is_file():
            raise SystemExit("Synthetic dataset is missing. Generate it with python data/generate.py first.")
        result = subprocess.run(
            [sys.executable, str(pipeline), "--limit", str(args.documents), "--inputs", "mixed", "--cache-dir", str(ROOT / "data" / "cache")],
            cwd=ROOT,
            check=False,
        )
        if result.returncode:
            raise SystemExit(result.returncode)
        print(f"warmed {args.documents} synthetic document cache entries")

    request(args.api_url, "/health", None)
    request(args.api_url, "/demo/status", args.token)
    if args.token:
        request(args.api_url, "/rules", args.token)
        request(args.api_url, "/workflow-config?view=institution_portal", args.token)
        request(args.api_url, "/eval/metrics", args.token)
    print("PreFlight demo warm-up complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
