#!/usr/bin/env python3
"""Generate a deterministic synthetic AICTE-style validation dataset.

Creates 50 original PDFs plus 50 image-only noisy scan variants, a CSV ground
truth manifest, and a public test-CA certificate. Every PDF is conspicuously
marked as synthetic and not an official record. No real identifiers, logos,
or official seals are used.

Run from any directory with:
    python data/generate.py

Requirements: Faker, ReportLab, Pillow, pypdf, pyHanko, cryptography, Poppler.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import random
import shutil
import subprocess
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from faker import Faker
from PIL import Image, ImageChops, ImageEnhance, ImageFilter
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)
from reportlab.pdfgen import canvas as pdfcanvas
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from pypdf import PdfReader
from pyhanko import stamp
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.keys import load_certs_from_pemder
from pyhanko.sign import fields, signers
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext


COUNT = 50
SEED = 2601026
DOC_TYPES = (
    "affidavit",
    "fire_noc",
    "lease",
    "accreditation_letter",
    "ter_receipt",
    "structural_certificate",
)
DOC_TITLES = {
    "affidavit": "Institution Declaration",
    "fire_noc": "Fire Safety Clearance",
    "lease": "Lease Agreement",
    "accreditation_letter": "Accreditation Status Letter",
    "ter_receipt": "Technical Education Review Fee Receipt",
    "structural_certificate": "Structural Safety Certificate",
}

# These are exactly 18 labeled document instances. Cross-document findings
# use one event ID on every document participating in the planted relation.
DEFECT_LABELS: dict[int, tuple[str, str]] = {
    1: ("expired_validity", "DEF-EXPIRED-01"),
    7: ("expired_validity", "DEF-EXPIRED-01"),
    13: ("expired_validity", "DEF-EXPIRED-01"),
    9: ("name_mismatch", "DEF-NAME-01"),
    12: ("name_mismatch", "DEF-NAME-02"),
    15: ("wrong_id", "DEF-ID-01"),
    18: ("wrong_id", "DEF-ID-02"),
    21: ("edited_date", "DEF-DATE-01"),
    24: ("edited_date", "DEF-DATE-02"),
    29: ("duplicate_document_across_institutions", "DEF-DUP-01"),
    41: ("duplicate_document_across_institutions", "DEF-DUP-01"),
    30: ("missing_signature", "DEF-SIGN-01"),
    33: ("missing_signature", "DEF-SIGN-02"),
    4: ("same_faculty_id_in_3_institutions", "DEF-FACULTY-01"),
    10: ("same_faculty_id_in_3_institutions", "DEF-FACULTY-01"),
    16: ("same_faculty_id_in_3_institutions", "DEF-FACULTY-01"),
    43: ("same_address_in_2_applications", "DEF-ADDRESS-01"),
    48: ("same_address_in_2_applications", "DEF-ADDRESS-01"),
}

DECOYS: dict[int, str] = {
    2: "alternate_date_format",
    6: "nonstandard_reference_prefix",
    8: "accepted_short_name",
    11: "manual_copy_annotation",
    14: "split_address_line",
    17: "older_accepted_template_revision",
    22: "abbreviated_signatory_signature",
    23: "high_whitespace_layout",
    26: "faded_demo_stamp",
    35: "unusual_but_valid_amount_format",
}

SIGNED_RECORDS = set(DECOYS) | {29}
DUPLICATE_SOURCE = 29
DUPLICATE_COPY = 41
DUPLICATE_GROUP = "DUP-TER-0001"
FACULTY_RECORDS = (4, 10, 16)
ADDRESS_RECORDS = (43, 48)


@dataclass(frozen=True)
class Institution:
    code: str
    name: str
    short_name: str
    address: str
    signatory: str


class HtmlStoryParser(HTMLParser):
    """Convert the small, trusted HTML template vocabulary to ReportLab."""

    BLOCK_STYLES = {"h1": "title", "h2": "section", "p": "body", "li": "body"}
    INLINE_TAGS = {"b", "i", "u", "strike"}

    def __init__(self, styles: dict[str, ParagraphStyle]):
        super().__init__(convert_charrefs=True)
        self.styles = styles
        self.items: list[Any] = []
        self.current_style: str | None = None
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.BLOCK_STYLES:
            self._flush()
            self.current_style = self.BLOCK_STYLES[tag]
            self.parts = []
        elif tag == "br" and self.current_style:
            self.parts.append("<br/>")
        elif self.current_style and tag in self.INLINE_TAGS:
            self.parts.append(f"<{tag}>")
        elif self.current_style and tag == "font":
            color = next((value for key, value in attrs if key == "color"), None)
            if color and color.startswith("#") and len(color) == 7:
                self.parts.append(f'<font color="{color}">')

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCK_STYLES:
            self._flush()
        elif self.current_style and tag in self.INLINE_TAGS | {"font"}:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if self.current_style:
            self.parts.append(html.escape(data, quote=False))

    def _flush(self) -> None:
        if self.current_style is None:
            return
        content = "".join(self.parts).strip()
        if content:
            self.items.extend([Paragraph(content, self.styles[self.current_style]), Spacer(1, 5 * mm)])
        self.current_style = None
        self.parts = []


def clean_address(value: str) -> str:
    return ", ".join(part.strip() for part in value.replace("\r", "").split("\n") if part.strip())


def build_institutions(fake: Faker) -> list[Institution]:
    institutions: list[Institution] = []
    for index in range(1, 11):
        city = fake.city_name()
        name = f"Synthetic {city} Institute of Applied Studies {index:02d}"
        short = f"{city} Applied Studies {index:02d}"
        institutions.append(
            Institution(
                code=f"SYN-INST-{index:03d}",
                name=name,
                short_name=short,
                address=clean_address(fake.address()),
                signatory=fake.name(),
            )
        )
    return institutions


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def html_template(doc_type: str, observed: dict[str, Any], decoy: str | None) -> str:
    title = DOC_TITLES[doc_type]
    if doc_type == "ter_receipt":
        institution_line = "<p>Service: Synthetic Education Review Portal</p>"
        reference_lines = (
            f"<p><b>Receipt reference:</b> {esc(observed['receipt_reference'])}</p>"
            f"<p><b>Transaction reference:</b> {esc(observed['transaction_reference'])}</p>"
            f"<p><b>Paid on:</b> {esc(observed['payment_date'])}</p>"
            f"<p><b>Amount received:</b> {esc(observed['amount_inr_display'])}</p>"
        )
    else:
        institution_line = f"<p><b>Institution:</b> {esc(observed['institution_name'])}</p>"
        reference_lines = (
            f"<p><b>Application:</b> {esc(observed['application_number'])}</p>"
            f"<p><b>Document reference:</b> {esc(observed['document_reference'])}</p>"
            f"<p><b>Issue date:</b> {observed['issue_date_html']}</p>"
            f"<p><b>Valid through:</b> {esc(observed['valid_until'])}</p>"
            f"<p><b>Institution address:</b> {esc(observed['institution_address']).replace(chr(10), '<br/>')}</p>"
        )

    if doc_type == "affidavit":
        body = "I declare that the information in this synthetic application record is supplied for demonstration and review practice."
    elif doc_type == "fire_noc":
        body = "The fictional Demo Civic Safety Desk records a sample fire-safety clearance for the premises listed above. This record has no legal force."
    elif doc_type == "lease":
        body = "The fictional parties record a sample lease for the stated premises and training period. This sample is not an executed agreement."
    elif doc_type == "accreditation_letter":
        body = (
            "The Synthetic Accreditation Panel records a demonstration status for review practice. "
            f"<br/><b>Primary faculty reference:</b> {esc(observed['faculty_reference_id'])}"
        )
    elif doc_type == "ter_receipt":
        body = "This is a synthetic gateway receipt specimen. The transaction details are for testing only."
    else:
        body = "The fictional Demo Structural Review Office records a sample visual review of the named premises. This certificate is for training use only."

    extra = ""
    if decoy == "manual_copy_annotation":
        extra = "<p><i>Copy checked against the training source record.</i></p>"
    elif decoy == "older_accepted_template_revision":
        extra = "<p>Template revision: DEMO-2 (retained for this training scenario).</p>"
    elif decoy == "abbreviated_signatory_signature":
        extra = "<p>Signatory notation: <i>" + esc(observed.get("signatory_initials", "")) + "</i> (initials accepted in this specimen).</p>"
    elif decoy == "faded_demo_stamp":
        extra = '<p><font color="#b7b1a4">DEMO COPY CHECKED</font></p>'
    elif decoy == "high_whitespace_layout":
        extra = "<p><br/><br/><br/></p>"
    elif decoy == "unusual_but_valid_amount_format":
        extra = "<p>Amount format note: grouped with Indian digit separators; amount is unchanged.</p>"
    elif decoy == "split_address_line" and doc_type != "ter_receipt":
        extra = "<p>Address verified across two printed lines; postal details remain consistent.</p>"
    elif decoy == "accepted_short_name":
        extra = "<p>Registered short name appears in the institution's approved alias list.</p>"
    elif decoy == "alternate_date_format":
        extra = "<p>Date format follows DD/MM/YYYY; the calendar date is unchanged.</p>"
    elif decoy == "nonstandard_reference_prefix":
        extra = "<p>Reference prefix is a local series assigned to this synthetic issuer.</p>"

    if doc_type == "ter_receipt":
        sign_block = "<p><b>Gateway record:</b> automated synthetic receipt; no handwritten signature is expected.</p>"
    elif observed.get("signature_present", True):
        shown_signatory = observed.get("signatory_initials", observed["signatory"])
        sign_block = (
            f"<p><b>Authorized by:</b> {esc(observed['signatory'])}</p>"
            f"<p><b>Signature:</b> TEST SIGNED BY {esc(shown_signatory)}</p>"
        )
    else:
        sign_block = (
            f"<p><b>Authorized by:</b> {esc(observed['signatory'])}</p>"
            "<p><b>Signature:</b> ______________________________</p>"
        )

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{esc(title)}</title></head>
<body>
  <h1>{esc(title)}</h1>
  <h2>SYNTHETIC TRAINING RECORD</h2>
  {institution_line}
  {reference_lines}
  <p>{body}</p>
  {extra}
  {sign_block}
</body></html>"""


def page_drawer(c: pdfcanvas.Canvas, doc: SimpleDocTemplate) -> None:
    width, height = A4
    c.saveState()
    c.setFillColor(colors.HexColor("#032448"))
    c.setFont("Helvetica-Bold", 8)
    c.drawString(25 * mm, height - 17 * mm, "PREFLIGHT SYNTHETIC RECORD")
    c.setStrokeColor(colors.HexColor("#d69a45"))
    c.setLineWidth(1.2)
    c.line(25 * mm, height - 20 * mm, width - 25 * mm, height - 20 * mm)

    if hasattr(c, "setFillAlpha"):
        c.setFillAlpha(0.10)
    c.setFillColor(colors.HexColor("#718096"))
    c.setFont("Helvetica-Bold", 30)
    c.translate(width / 2, height / 2)
    c.rotate(34)
    watermark = "SYNTHETIC DEMO"
    c.drawCentredString(0, 0, watermark)
    c.restoreState()

    c.saveState()
    c.setStrokeColor(colors.HexColor("#e5e0d8"))
    c.line(25 * mm, 17 * mm, width - 25 * mm, 17 * mm)
    c.setFillColor(colors.HexColor("#526071"))
    c.setFont("Helvetica-Bold", 7)
    c.drawString(25 * mm, 11 * mm, "SYNTHETIC DEMO - NOT AN OFFICIAL RECORD")
    c.setFont("Helvetica", 7)
    c.drawRightString(width - 25 * mm, 11 * mm, f"Training copy | Page {doc.page}")
    c.restoreState()


def make_pdf(html_doc: str, destination: Path, title: str) -> bytes:
    styles = {
        "title": ParagraphStyle(
            "SyntheticTitle", fontName="Helvetica-Bold", fontSize=18,
            leading=23, textColor=colors.HexColor("#032448"), spaceAfter=3 * mm,
        ),
        "section": ParagraphStyle(
            "SyntheticSection", fontName="Helvetica-Bold", fontSize=9,
            leading=13, textColor=colors.HexColor("#8c5000"), spaceAfter=4 * mm,
        ),
        "body": ParagraphStyle(
            "SyntheticBody", fontName="Helvetica", fontSize=10.5,
            leading=16, textColor=colors.HexColor("#252a30"),
            alignment=TA_LEFT, spaceAfter=1 * mm,
        ),
    }
    parser = HtmlStoryParser(styles)
    parser.feed(html_doc)
    parser.close()
    story = [Spacer(1, 3 * mm), *parser.items, Spacer(1, 4 * mm), HRFlowable(width="100%", color=colors.HexColor("#d6d3cc"))]
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, rightMargin=25 * mm, leftMargin=25 * mm,
        topMargin=27 * mm, bottomMargin=26 * mm,
        title=title, author="PreFlight Synthetic Dataset - Test Only",
        subject="Fictional training example; not an official record",
    )
    doc.build(story, onFirstPage=page_drawer, onLaterPages=page_drawer)
    data = buffer.getvalue()
    destination.write_bytes(data)
    return data


def create_test_ca(work_dir: Path, output_dir: Path) -> tuple[Path, Path, Path]:
    """Create a local-only test root and leaf signer; return PEM file paths."""
    now = datetime.now(timezone.utc)
    root_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    root_name = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "PreFlight Synthetic Dataset - TEST ONLY"),
        x509.NameAttribute(NameOID.COMMON_NAME, "PreFlight Local Synthetic Test CA"),
    ])
    leaf_name = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "PreFlight Synthetic Dataset - TEST ONLY"),
        x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic Demonstration Signer - TEST ONLY"),
    ])

    root_cert = (
        x509.CertificateBuilder()
        .subject_name(root_name).issuer_name(root_name)
        .public_key(root_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False, content_commitment=False,
                key_encipherment=False, data_encipherment=False,
                key_agreement=False, key_cert_sign=True, crl_sign=True,
                encipher_only=None, decipher_only=None,
            ), critical=True,
        )
        .sign(root_key, hashes.SHA256())
    )
    leaf_cert = (
        x509.CertificateBuilder()
        .subject_name(leaf_name).issuer_name(root_name)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=730))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=True,
                key_encipherment=True, data_encipherment=False,
                key_agreement=False, key_cert_sign=False, crl_sign=False,
                encipher_only=None, decipher_only=None,
            ), critical=True,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION]), critical=False)
        .sign(root_key, hashes.SHA256())
    )

    root_key_path = work_dir / "synthetic_test_ca_key.pem"
    signer_key_path = work_dir / "synthetic_test_signer_key.pem"
    root_cert_path = output_dir / "synthetic_test_ca.pem"
    signer_cert_path = work_dir / "synthetic_test_signer.pem"
    root_key_path.write_bytes(root_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))
    signer_key_path.write_bytes(leaf_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))
    root_cert_path.write_bytes(root_cert.public_bytes(serialization.Encoding.PEM))
    signer_cert_path.write_bytes(leaf_cert.public_bytes(serialization.Encoding.PEM))
    return signer_key_path, signer_cert_path, root_cert_path


def sign_pdf(pdf_bytes: bytes, signer_key: Path, signer_cert: Path, root_cert: Path) -> bytes:
    cms_signer = signers.SimpleSigner.load(
        key_file=signer_key,
        cert_file=signer_cert,
        ca_chain_files=(root_cert,),
    )
    source = io.BytesIO(pdf_bytes)
    writer = IncrementalPdfFileWriter(source)
    output = io.BytesIO()
    pdf_signer = signers.PdfSigner(
        signers.PdfSignatureMetadata(
            field_name="SyntheticTestSignature",
            reason="Local synthetic dataset test signature - not an official trust mark",
        ),
        signer=cms_signer,
        new_field_spec=fields.SigFieldSpec(
            sig_field_name="SyntheticTestSignature",
            on_page=0,
            box=(335, 58, 565, 112),
        ),
        stamp_style=stamp.TextStampStyle(
            stamp_text="TEST SIGNATURE ONLY\n%(signer)s\n%(ts)s"
        ),
    )
    signed = pdf_signer.sign_pdf(writer, output=output)
    if signed is not None:
        return output.getvalue() or signed.getvalue()
    return output.getvalue()


def verify_test_signature(pdf_path: Path, root_cert_path: Path) -> bool:
    root_certs = load_certs_from_pemder([root_cert_path])
    validation_context = ValidationContext(
        trust_roots=root_certs,
        allow_fetching=False,
    )
    with pdf_path.open("rb") as stream:
        reader = signers.PdfFileReader(stream) if hasattr(signers, "PdfFileReader") else None
        if reader is None:
            from pyhanko.pdf_utils.reader import PdfFileReader
            reader = PdfFileReader(stream)
        if not reader.embedded_signatures:
            return False
        status = validate_pdf_signature(
            reader.embedded_signatures[0],
            signer_validation_context=validation_context,
            skip_diff=True,
        )
        return bool(status.bottom_line)


def render_scan_variant(
    source_pdf: Path,
    output_pdf: Path,
    temp_dir: Path,
    record_no: int,
    seed: int,
    pdftoppm: str,
) -> None:
    prefix = temp_dir / f"scan-{record_no:03d}"
    subprocess.run(
        [pdftoppm, "-f", "1", "-l", "1", "-singlefile", "-png", "-r", "160", str(source_pdf), str(prefix)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    image_path = prefix.with_suffix(".png")
    rng = random.Random(seed + record_no * 101)
    with Image.open(image_path) as opened:
        image = opened.convert("L")
        noise = Image.effect_noise(image.size, rng.uniform(2.0, 6.0)).convert("L")
        image = ImageChops.blend(image, noise, rng.uniform(0.025, 0.065))
        image = image.rotate(
            rng.uniform(-1.3, 1.3),
            resample=Image.Resampling.BICUBIC,
            expand=False,
            fillcolor=248,
        )
        image = image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.12, 0.42)))
        image = ImageEnhance.Contrast(image).enhance(rng.uniform(0.88, 1.03))
        jpeg_path = temp_dir / f"scan-{record_no:03d}.jpg"
        image.save(jpeg_path, format="JPEG", quality=rng.randint(52, 76), optimize=True)

    page_width, page_height = A4
    c = pdfcanvas.Canvas(str(output_pdf), pagesize=A4, pageCompression=1)
    c.drawImage(str(jpeg_path), 0, 0, width=page_width, height=page_height, preserveAspectRatio=False, mask="auto")
    c.showPage()
    c.save()
    image_path.unlink(missing_ok=True)
    jpeg_path.unlink(missing_ok=True)


def build_contexts(fake: Faker) -> tuple[list[Institution], list[dict[str, Any]]]:
    institutions = build_institutions(fake)
    shared_address = clean_address(fake.address())
    records: list[dict[str, Any]] = []
    for number in range(1, COUNT + 1):
        institution_index = (number - 1) // 5
        institution = institutions[institution_index]
        doc_type = DOC_TYPES[(number - 1) % len(DOC_TYPES)]
        issue = date(2026, ((number - 1) % 10) + 1, ((number - 1) % 26) + 1)
        correct: dict[str, Any] = {
            "institution_name": institution.name,
            "institution_aliases": [institution.short_name],
            "application_number": f"SYN-APP-{number:04d}",
            "document_reference": f"SYN-DOC-{number:04d}",
            "issue_date": issue.isoformat(),
            "valid_until": (issue + timedelta(days=730)).isoformat(),
            "institution_address": institution.address,
            "signatory": institution.signatory,
            "faculty_reference_id": f"FAC-SYN-{number:05d}",
        }
        if doc_type != "ter_receipt":
            correct["signature_present"] = True
        if doc_type == "ter_receipt":
            correct.update({
                "receipt_reference": f"SYN-TER-{number:04d}",
                "transaction_reference": f"SYN-TRX-{number:04d}",
                "payment_date": issue.isoformat(),
                "amount_inr": 12500,
                "amount_inr_display": "INR 12,500.00",
            })
        observed = deepcopy(correct)
        if doc_type != "ter_receipt":
            observed["signature_present"] = True
        if number == 1 or number == 7 or number == 13:
            observed["valid_until"] = "2023-03-31"
        if number in (9, 12):
            other = institutions[(institution_index + 1) % len(institutions)]
            observed["institution_name"] = other.name
        if number in (15, 18):
            observed["document_reference"] = f"SYN-DOC-X{number + 100:04d}"
        if number in (21, 24):
            old_date = observed["issue_date"]
            changed_date = (issue + timedelta(days=9)).isoformat()
            observed["issue_date"] = changed_date
            observed["issue_date_html"] = (
                f'<strike>{esc(old_date)}</strike> '
                f'<font color="#a53e30"><b>{esc(changed_date)}</b></font> '
                '<i>(typed date correction)</i>'
            )
            observed["date_edit_trace"] = [old_date, changed_date]
        if number in (29, 41):
            observed.update({
                "receipt_reference": "SYN-TER-DUP-7771",
                "transaction_reference": "SYN-TRX-DUP-7771",
                "payment_date": "2026-09-15",
                "amount_inr": 12500,
                "amount_inr_display": "12,500.00",
            })
        if number in (30, 33):
            observed["signature_present"] = False
        if number in FACULTY_RECORDS:
            observed["faculty_reference_id"] = "FAC-SYN-SHARED-0007"
        if number in ADDRESS_RECORDS:
            observed["institution_address"] = shared_address

        decoy = DECOYS.get(number)
        if decoy == "accepted_short_name":
            observed["institution_name"] = institution.short_name
        if decoy == "alternate_date_format":
            observed["issue_date"] = issue.strftime("%d/%m/%Y")
            observed["issue_date_html"] = esc(observed["issue_date"])
        if decoy == "nonstandard_reference_prefix":
            correct["document_reference"] = f"LOCAL/DEMO/{number:04d}"
            observed["document_reference"] = correct["document_reference"]
        if decoy == "split_address_line":
            observed["institution_address"] = institution.address.replace(", ", ",\n")
        if decoy == "abbreviated_signatory_signature":
            initials = " ".join(part[0] + "." for part in institution.signatory.split() if part)
            observed["signatory_initials"] = initials
        if decoy == "unusual_but_valid_amount_format":
            observed["amount_inr_display"] = "Rs. 12,500.00"

        records.append({
            "record_no": number,
            "institution_index": institution_index,
            "institution": institution,
            "doc_type": doc_type,
            "correct": correct,
            "observed": observed,
            "defect_label": DEFECT_LABELS.get(number, ("", ""))[0],
            "defect_group": DEFECT_LABELS.get(number, ("", ""))[1],
            "decoy_label": "odd_but_valid" if decoy else "",
            "decoy_detail": decoy or "",
        })
    return institutions, records


def write_ground_truth(records: list[dict[str, Any]], output_dir: Path) -> None:
    csv_path = output_dir / "ground_truth.csv"
    fieldnames = [
        "record_id", "institution_code", "institution_name", "application_number",
        "document_type", "original_pdf", "scanned_pdf", "document_sha256",
        "correct_fields_json", "observed_fields_json", "defect_label", "defect_group",
        "decoy_label", "decoy_detail", "digital_signature", "signature_trust",
    ]
    with csv_path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            number = record["record_no"]
            institution: Institution = record["institution"]
            original_rel = Path("originals") / f"SYN-{number:04d}_{record['doc_type']}.pdf"
            scan_rel = Path("scanned") / f"SYN-{number:04d}_{record['doc_type']}_scan.pdf"
            original = output_dir / original_rel
            if record["doc_type"] == "ter_receipt":
                keys = ("receipt_reference", "transaction_reference", "payment_date", "amount_inr", "amount_inr_display")
            else:
                keys = ("institution_name", "institution_aliases", "application_number", "document_reference", "issue_date", "valid_until", "institution_address", "signatory", "signature_present")
                if record["doc_type"] == "accreditation_letter":
                    keys += ("faculty_reference_id",)
            correct_fields = {key: record["correct"][key] for key in keys if key in record["correct"]}
            observed_keys = tuple(key for key in keys if key != "institution_aliases")
            observed_fields = {key: record["observed"][key] for key in observed_keys if key in record["observed"]}
            for optional_key in ("signature_present", "date_edit_trace", "signatory_initials"):
                if optional_key in record["observed"]:
                    observed_fields[optional_key] = record["observed"][optional_key]
            writer.writerow({
                "record_id": f"SYN-REC-{number:04d}",
                "institution_code": institution.code,
                "institution_name": institution.name,
                "application_number": f"SYN-APP-{number:04d}",
                "document_type": record["doc_type"],
                "original_pdf": original_rel.as_posix(),
                "scanned_pdf": scan_rel.as_posix(),
                "document_sha256": hashlib.sha256(original.read_bytes()).hexdigest(),
                "correct_fields_json": json.dumps(correct_fields, ensure_ascii=True, sort_keys=True, separators=(",", ":")),
                "observed_fields_json": json.dumps(observed_fields, ensure_ascii=True, sort_keys=True, separators=(",", ":")),
                "defect_label": record["defect_label"],
                "defect_group": record["defect_group"],
                "decoy_label": record["decoy_label"],
                "decoy_detail": record["decoy_detail"],
                "digital_signature": "true" if number in SIGNED_RECORDS or number == DUPLICATE_COPY else "false",
                "signature_trust": "local_test_ca_only" if number in SIGNED_RECORDS or number == DUPLICATE_COPY else "unsigned",
            })


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent / "output")
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()

    output_dir = args.output_dir.resolve()
    originals_dir = output_dir / "originals"
    scans_dir = output_dir / "scanned"
    originals_dir.mkdir(parents=True, exist_ok=True)
    scans_dir.mkdir(parents=True, exist_ok=True)
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise SystemExit("Poppler pdftoppm is required to create scanned variants. Install Poppler or add pdftoppm to PATH.")

    random.seed(args.seed)
    fake = Faker("en_IN")
    fake.seed_instance(args.seed)
    _, records = build_contexts(fake)
    if len(records) != COUNT or sum(bool(r["defect_label"]) for r in records) != 18:
        raise RuntimeError("Dataset planning error: expected 50 records and 18 labeled defect instances.")
    if len([r for r in records if r["decoy_label"]]) != 10:
        raise RuntimeError("Dataset planning error: expected 10 valid decoys.")

    work_dir = output_dir / ".working"
    work_dir.mkdir(exist_ok=True)
    try:
        signer_key, signer_cert, root_cert = create_test_ca(work_dir, output_dir)
        source_duplicate_bytes: bytes | None = None

        for record in records:
            number = record["record_no"]
            destination = originals_dir / f"SYN-{number:04d}_{record['doc_type']}.pdf"
            if number == DUPLICATE_COPY:
                if source_duplicate_bytes is None:
                    raise RuntimeError("Duplicate source must be generated before its linked copy.")
                destination.write_bytes(source_duplicate_bytes)
                continue

            observed = dict(record["observed"])
            institution: Institution = record["institution"]
            observed.setdefault("institution_name", institution.name)
            observed.setdefault("institution_address", institution.address)
            observed.setdefault("application_number", f"SYN-APP-{number:04d}")
            observed.setdefault("document_reference", f"SYN-DOC-{number:04d}")
            observed.setdefault("issue_date", record["correct"]["issue_date"])
            observed.setdefault("issue_date_html", esc(observed["issue_date"]))
            observed.setdefault("valid_until", record["correct"]["valid_until"])
            observed.setdefault("signatory", institution.signatory)
            if record["doc_type"] == "ter_receipt":
                observed.setdefault("receipt_reference", record["correct"]["receipt_reference"])
                observed.setdefault("transaction_reference", record["correct"]["transaction_reference"])
                observed.setdefault("payment_date", record["correct"]["payment_date"])
                observed.setdefault("amount_inr_display", record["correct"]["amount_inr_display"])
            if record["doc_type"] == "accreditation_letter":
                observed.setdefault("faculty_reference_id", record["correct"]["faculty_reference_id"])

            html_doc = html_template(record["doc_type"], observed, record["decoy_detail"] or None)
            raw = make_pdf(html_doc, destination, DOC_TITLES[record["doc_type"]])
            if number in SIGNED_RECORDS:
                raw = sign_pdf(raw, signer_key, signer_cert, root_cert)
                destination.write_bytes(raw)
            if number == DUPLICATE_SOURCE:
                source_duplicate_bytes = destination.read_bytes()

        # Signatures are local test-only and trusted only against the bundled root.
        for number in sorted(SIGNED_RECORDS):
            path = originals_dir / f"SYN-{number:04d}_{records[number - 1]['doc_type']}.pdf"
            if not verify_test_signature(path, root_cert):
                raise RuntimeError(f"Local test signature did not validate for record {number}.")

        source_scan: Path | None = None
        for record in records:
            number = record["record_no"]
            scan_path = scans_dir / f"SYN-{number:04d}_{record['doc_type']}_scan.pdf"
            original_path = originals_dir / f"SYN-{number:04d}_{record['doc_type']}.pdf"
            if number == DUPLICATE_COPY:
                if source_scan is None:
                    raise RuntimeError("Duplicate scan source was not created.")
                scan_path.write_bytes(source_scan.read_bytes())
            else:
                render_scan_variant(original_path, scan_path, work_dir, number, args.seed, pdftoppm)
                if number == DUPLICATE_SOURCE:
                    source_scan = scan_path
    finally:
        for temporary_file in work_dir.iterdir():
            if temporary_file.is_file():
                temporary_file.unlink()
        work_dir.rmdir()

    # Verify the duplicate is byte-identical and the noisy copies are image-only PDFs.
    duplicate_source = originals_dir / f"SYN-{DUPLICATE_SOURCE:04d}_ter_receipt.pdf"
    duplicate_copy = originals_dir / f"SYN-{DUPLICATE_COPY:04d}_ter_receipt.pdf"
    if hashlib.sha256(duplicate_source.read_bytes()).digest() != hashlib.sha256(duplicate_copy.read_bytes()).digest():
        raise RuntimeError("The duplicate-document pair does not have matching file hashes.")
    for record in records:
        scan_path = scans_dir / f"SYN-{record['record_no']:04d}_{record['doc_type']}_scan.pdf"
        scan_reader = PdfReader(scan_path)
        if len(scan_reader.pages) != 1:
            raise RuntimeError(f"Expected one scanned page in {scan_path.name}.")
        if (scan_reader.pages[0].extract_text() or "").strip():
            raise RuntimeError(f"Scanned variant unexpectedly contains selectable text: {scan_path.name}")

    write_ground_truth(records, output_dir)
    readme = output_dir / "README.txt"
    readme.write_text(
        "PreFlight synthetic document dataset\n"
        "50 fictional source PDFs and 50 noisy image-only scan variants.\n"
        "All records are synthetic and marked NOT AN OFFICIAL RECORD.\n"
        "The test CA is local to this dataset and is not a public trust root.\n"
        "ground_truth.csv contains expected fields, observed fields, planted labels, and file hashes.\n",
        encoding="ascii",
    )
    print(f"Created {COUNT} originals, {COUNT} noisy scans, 18 labeled defect instances, and 10 valid decoys.")
    print(f"Output: {output_dir}")
    print(f"Signed source records: {len(SIGNED_RECORDS)}; duplicate copies retain the source signature bytes.")


if __name__ == "__main__":
    main()
