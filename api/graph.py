"""Pseudonymized association graph for the local synthetic demo dataset."""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import imagehash
import networkx as nx
import pymupdf
import yaml
from PIL import Image
from pydantic import BaseModel, ConfigDict

from .models import Finding, FindingSeverity, FindingStatus

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "data" / "output" / "ground_truth.csv"
RULES_FILE = Path(__file__).resolve().parent / "rules" / "graph.yaml"
PDF_ROOT = DATASET.parent
ID_NAMESPACE = uuid.UUID("f6f59678-061e-4e80-89aa-a516ad65dd0b")
DEFAULT_DEMO_SALT = "preflight-synthetic-demo-only-rotate-for-real-data"


class GraphModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GraphNode(GraphModel):
    id: str
    type: str
    label: str
    application_id: str | None = None
    application_key: str | None = None
    institution_name: str | None = None
    cluster_id: str | None = None
    flagged: bool = False


class GraphEdge(GraphModel):
    id: str
    source: str
    target: str
    type: str
    weight: float
    why_flagged: str | None = None


class GraphResponse(GraphModel):
    generated_at: datetime
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    alerts: list[Finding]


def _stable_id(kind: str, key: str) -> str:
    return str(uuid.uuid5(ID_NAMESPACE, f"{kind}:{key}"))


def _salted_hash(value: str) -> str:
    salt = os.getenv("GRAPH_HASH_SALT", DEFAULT_DEMO_SALT).encode("utf-8")
    normalized = re.sub(r"\s+", " ", value.strip().casefold())
    return hashlib.sha256(salt + b":" + normalized.encode("utf-8")).hexdigest()


def _simhash(text: str) -> int:
    tokens = re.findall(r"[a-z0-9]+", text.casefold())
    if not tokens:
        return 0
    bits = [0] * 64
    for token in tokens:
        digest = int.from_bytes(hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest(), "big")
        for index in range(64):
            bits[index] += 1 if digest & (1 << index) else -1
    value = 0
    for index, score in enumerate(bits):
        if score >= 0:
            value |= 1 << index
    return value


@lru_cache(maxsize=128)
def _pdf_signatures(path: Path, modified_ns: int) -> tuple[str | None, str | None, frozenset[str]]:
    try:
        with pymupdf.open(path) as pdf:
            first = pdf[0]
            pix = first.get_pixmap(matrix=pymupdf.Matrix(0.5, 0.5), alpha=False)
            image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            perceptual = str(imagehash.phash(image))
            text = "\n".join(page.get_text("text") for page in pdf)
            tokens = set(re.findall(r"[a-z0-9]+", text.casefold()))
            return perceptual, f"{_simhash(text):016x}", frozenset(tokens)
    except Exception:
        return None, None, frozenset()


def _hamming(left: str, right: str) -> int:
    return (int(left, 16) ^ int(right, 16)).bit_count()


def load_graph_rules() -> dict[str, Any]:
    with RULES_FILE.open(encoding="utf-8") as source:
        return yaml.safe_load(source)


def build_demo_graph() -> GraphResponse:
    rules = load_graph_rules()
    if not DATASET.exists():
        return GraphResponse(generated_at=datetime.now(timezone.utc), nodes=[], edges=[], alerts=[])

    rows: list[dict[str, Any]] = []
    with DATASET.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            row["observed"] = json.loads(row["observed_fields_json"] or "{}")
            rows.append(row)

    nodes: dict[str, GraphNode] = {}
    edges: dict[str, GraphEdge] = {}
    flagged_ids: set[str] = set()
    alerts: list[Finding] = []
    graph = nx.Graph()

    def add_node(kind: str, key: str, label: str, row: dict[str, Any], flagged: bool = False) -> str:
        node_id = _stable_id(kind, key)
        existing = nodes.get(node_id)
        nodes[node_id] = GraphNode(
            id=node_id,
            type=kind,
            label=label,
            application_id=row.get("application_number"),
            application_key=str(uuid.uuid5(ID_NAMESPACE, row["application_number"])) if row.get("application_number") else None,
            institution_name=row.get("institution_name"),
            flagged=flagged or bool(existing and existing.flagged),
        )
        graph.add_node(node_id, type=kind)
        if flagged:
            flagged_ids.add(node_id)
        return node_id

    def add_edge(source: str, target: str, edge_type: str, weight: float = 1, reason: str | None = None) -> str:
        edge_id = _stable_id("edge", f"{edge_type}:{min(source, target)}:{max(source, target)}")
        edges[edge_id] = GraphEdge(id=edge_id, source=source, target=target, type=edge_type, weight=weight, why_flagged=reason)
        graph.add_edge(source, target, type=edge_type, weight=weight)
        return edge_id

    affiliations: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    documents: list[dict[str, Any]] = []
    for row in rows:
        institution = row["institution_name"]
        application = row["application_number"]
        record_id = row["record_id"]
        fields = row["observed"]
        institution_node = add_node("institution", row["institution_code"], institution, row)
        app_node = add_node("application", application, application, row)
        add_edge(institution_node, app_node, "application")

        pdf_path = PDF_ROOT / row["original_pdf"]
        doc_node = add_node("document", record_id, f"{row['document_type'].replace('_', ' ').title()} · {record_id[-4:]}", row)
        add_edge(app_node, doc_node, "submitted_document")
        try:
            modified_ns = pdf_path.stat().st_mtime_ns
        except OSError:
            modified_ns = 0
        phash, simhash, text_tokens = _pdf_signatures(pdf_path, modified_ns)
        documents.append({"node": doc_node, "app": app_node, "institution": institution_node, "row": row,
                          "sha": row.get("document_sha256", ""), "phash": phash, "simhash": simhash, "text_tokens": text_tokens})

        for field, kind in (("faculty_reference_id", "faculty"), ("institution_address", "address"), ("signatory", "signatory")):
            value = fields.get(field)
            if not value:
                continue
            value_hash = _salted_hash(str(value))
            label = f"Faculty ref · {value_hash[:5]}" if kind == "faculty" else (
                f"Address · {value_hash[:5]}" if kind == "address" else f"Signatory · {value_hash[:5]}"
            )
            entity_node = add_node(kind, value_hash, label, row)
            add_edge(doc_node, entity_node, f"{kind}_association")
            affiliations[(kind, value_hash)].append({"row": row, "entity_node": entity_node, "institution_node": institution_node,
                                                      "app_node": app_node, "doc_node": doc_node})

    def add_alert(kind: str, severity: FindingSeverity, reason: str, participants: list[dict[str, Any]], rule_id: str,
                  evidence_text: str) -> None:
        unique_institutions = {item["row"]["institution_code"] for item in participants}
        unique_apps = {item["row"]["application_number"] for item in participants}
        rule_config = rules[kind]
        if len(unique_apps) < rule_config.get("min_applications", 1) or len(unique_institutions) < rule_config.get("min_institutions", 1):
            return
        for item in participants:
            row = item["row"]
            application = row["application_number"]
            alerts.append(Finding(
                finding_id=uuid.uuid5(ID_NAMESPACE, f"{rule_id}:{application}"),
                application_id=uuid.uuid5(ID_NAMESPACE, application),
                type=kind,
                severity=severity,
                document={"document_id": uuid.uuid5(ID_NAMESPACE, row["record_id"]), "name": row["original_pdf"]},
                evidence={"page": 1, "bbox": None, "extracted": evidence_text},
                rule_id=rule_id,
                reason=f"{reason} This is an indicator requiring human verification.",
                confidence=0.98,
                status=FindingStatus.OPEN,
            ))
        for item in participants:
            flagged_ids.update(item[key] for key in ("institution_node", "app_node", "doc_node") if key in item)
            if "entity_node" in item:
                flagged_ids.add(item["entity_node"])

    for (kind, value_hash), participants in affiliations.items():
        institutions = {item["row"]["institution_code"] for item in participants}
        applications = {item["row"]["application_number"] for item in participants}
        rule_config = rules[f"shared_{kind}"]
        if len(applications) < rule_config.get("min_applications", 1) or len(institutions) < rule_config.get("min_institutions", 1):
            continue
        count = len(institutions)
        reason = rule_config["reason"].format(count=count if kind == "faculty" else len(applications)) if rule_config.get("enabled") else None
        if reason is not None:
            add_alert(rule_config["type"], FindingSeverity(rule_config["severity"]), reason, participants,
                      rule_config["rule_id"], f"{rule_config['evidence_label']} hash {value_hash[:12]} across {count} institutions")
        entity_node = participants[0]["entity_node"]
        for participant in participants:
            add_edge(entity_node, participant["institution_node"], f"shared_{kind}", 1, reason)

    for i, left in enumerate(documents):
        for right in documents[i + 1:]:
            if left["row"]["institution_code"] == right["row"]["institution_code"]:
                continue
            if left["row"]["document_type"] != right["row"]["document_type"]:
                continue
            same_binary = bool(left["sha"] and left["sha"] == right["sha"])
            p_distance = _hamming(left["phash"], right["phash"]) if left["phash"] and right["phash"] else 64
            t_distance = _hamming(left["simhash"], right["simhash"]) if left["simhash"] and right["simhash"] else 64
            token_union = left["text_tokens"] | right["text_tokens"]
            text_similarity = len(left["text_tokens"] & right["text_tokens"]) / len(token_union) if token_union else 0
            duplicate_rule = rules["duplicate_document"]
            near_duplicate = (
                p_distance <= duplicate_rule["max_phash_distance"]
                and t_distance <= duplicate_rule["max_text_hash_distance"]
                and text_similarity >= duplicate_rule["min_text_overlap"]
            )
            if not same_binary and not near_duplicate:
                continue
            reason = duplicate_rule["reason_exact"] if same_binary else duplicate_rule["reason_similar"]
            add_edge(left["node"], right["node"], "duplicate_document", 1.0 if same_binary else 0.9, reason)
            participants = [
                {"row": left["row"], "institution_node": left["institution"], "app_node": left["app"], "doc_node": left["node"]},
                {"row": right["row"], "institution_node": right["institution"], "app_node": right["app"], "doc_node": right["node"]},
            ]
            evidence = ("identical file SHA-256 " + left["sha"][:16]) if same_binary else f"image pHash distance {p_distance}; text hash distance {t_distance}; text overlap {text_similarity:.0%}"
            add_alert("duplicate_document", FindingSeverity(duplicate_rule["severity"]), reason, participants, duplicate_rule["rule_id"], evidence)

    for node_id in flagged_ids:
        if node_id in nodes:
            nodes[node_id] = nodes[node_id].model_copy(update={"flagged": True})
    for component in nx.connected_components(graph):
        cluster_id = _stable_id("cluster", min(component))
        for node_id in component:
            nodes[node_id] = nodes[node_id].model_copy(update={"cluster_id": cluster_id})
    return GraphResponse(generated_at=datetime.now(timezone.utc), nodes=list(nodes.values()), edges=list(edges.values()), alerts=alerts)
