"""Regressions for document preservation and secure PDF output.
SPDX-License-Identifier: AGPL-3.0-or-later
"""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fitz

spec = importlib.util.spec_from_file_location("embedded_core", Path(__file__).resolve().parents[1] / "src-tauri/resources/acropdf-core/embedded_core.py")
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


class PdfSafety(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="opendesk-safety-")
        self.root = Path(self.directory.name)
        self.source = self.root / "來源.pdf"
        with fitz.open() as document:
            for index in range(3):
                document.new_page().insert_text((72, 72), f"Page {index + 1} SECRET")
            document.set_metadata({"title": "Retained title"})
            document.save(self.source)

    def tearDown(self):
        self.directory.cleanup()

    def encrypt(self):
        encrypted = self.root / "加密.pdf"
        with fitz.open(self.source) as document:
            document.save(encrypted, encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="reader", owner_pw="owner")
        return encrypted

    def assert_encrypted(self, path, pages):
        with fitz.open(path) as document:
            self.assertTrue(document.needs_pass)
            self.assertTrue(document.authenticate("reader"))
            self.assertEqual(document.page_count, pages)
            self.assertEqual(document.metadata["title"], "Retained title")

    def test_extract_preserves_password_and_metadata(self):
        source = self.encrypt()
        output = self.root / "擷取.pdf"
        core.operate_pdf(source, "extract", {"pages": [1], "password": "reader"}, output)
        self.assert_encrypted(output, 1)
        self.assert_encrypted(source, 3)

    def test_split_preserves_password_and_never_overwrites_previous_outputs(self):
        source = self.encrypt()
        options = {"password": "reader", "output_dir": str(self.root / "分割")}
        first = core.operate_pdf(source, "split", options)["outputs"]
        previous = [Path(path).read_bytes() for path in first]
        second = core.operate_pdf(source, "split", options)["outputs"]
        self.assertFalse(set(first) & set(second))
        self.assertEqual(previous, [Path(path).read_bytes() for path in first])
        for path in first + second:
            self.assert_encrypted(path, 1)

    def test_atomic_replace_failure_keeps_original_and_cleans_temporary(self):
        original = self.source.read_bytes()
        with patch.object(core.os, "replace", side_effect=OSError("disk unavailable")):
            with self.assertRaises(OSError):
                core.operate_pdf(self.source, "rotate", {"angle": 90})
        self.assertEqual(original, self.source.read_bytes())
        self.assertEqual([self.source], list(self.root.iterdir()))

    @unittest.skipUnless(os.name == "posix", "POSIX permissions")
    def test_replacement_preserves_restrictive_permissions(self):
        self.source.chmod(0o600)
        core.operate_pdf(self.source, "rotate", {"angle": 90})
        self.assertEqual(self.source.stat().st_mode & 0o777, 0o600)

    def test_export_cannot_overwrite_source_or_hard_link(self):
        original = self.source.read_bytes()
        link = self.root / "hardlink.pdf"
        os.link(self.source, link)
        for target in (self.source, link):
            with self.assertRaises(ValueError):
                core.operate_pdf(self.source, "export", {"format": "txt"}, target)
        self.assertEqual(original, self.source.read_bytes())

    def test_failed_export_keeps_existing_output(self):
        output = self.root / "export.txt"
        output.write_text("original", encoding="utf-8")
        with patch.object(core.os, "replace", side_effect=OSError("disk unavailable")):
            with self.assertRaises(OSError):
                core.operate_pdf(self.source, "export", {"format": "txt"}, output)
        self.assertEqual(output.read_text(), "original")
        self.assertFalse(list(self.root.glob(".opendesk-*")))

    def test_invalid_page_selection_does_not_partially_apply(self):
        original = self.source.read_bytes()
        with self.assertRaises(ValueError):
            core.operate_pdf(self.source, "delete", {"pages": [0, 99]})
        self.assertEqual(original, self.source.read_bytes())

    def test_zero_insert_position_is_respected(self):
        core.operate_pdf(self.source, "insert_blank", {"position": 0})
        with fitz.open(self.source) as document:
            self.assertEqual(document[0].get_text(), "")
            self.assertIn("Page 1", document[1].get_text())

    def test_redaction_removes_overlap_image_pixels_and_text(self):
        image_pdf = self.root / "image.pdf"
        with fitz.open() as document:
            page = document.new_page()
            image = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 100, 100), False)
            image.clear_with(0)
            page.insert_image(fitz.Rect(60, 40, 200, 150), pixmap=image)
            page.insert_text((72, 72), "SECRET")
            document.save(image_pdf)
        core.operate_pdf(image_pdf, "redact_search", {"text": "SECRET"})
        with fitz.open(image_pdf) as document:
            self.assertNotIn("SECRET", document[0].get_text())
            rectangle = fitz.Rect(75, 61, 90, 70)
            # Redacted pixels in every surviving raster are white, not original black.
            images = document[0].get_images(full=True)
            self.assertTrue(images)
            for item in images:
                pix = fitz.Pixmap(document, item[0])
                self.assertEqual(pix.pixel(13, 24), (255, 255, 255))

    def test_xlsx_export_treats_formula_like_pdf_text_as_literal(self):
        source = self.root / "formula.pdf"
        with fitz.open() as document:
            document.new_page().insert_text((72, 72), '=HYPERLINK("https://example.invalid","unsafe")')
            document.save(source)
        output = self.root / "export.xlsx"
        core.operate_pdf(source, "export", {"format": "xlsx"}, output)
        from openpyxl import load_workbook
        workbook = load_workbook(output)
        self.assertEqual(workbook.active["A1"].data_type, "s")
        self.assertTrue(workbook.active["A1"].value.startswith("="))
        workbook.close()

    def test_ocr_adds_search_layer_without_rebuilding_document(self):
        source = self.root / "scan.pdf"
        with fitz.open() as document:
            page = document.new_page()
            page.add_text_annot((200, 200), "Preserve annotation")
            page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(50, 50, 100, 100), "uri": "https://example.invalid"})
            document.set_toc([[1, "Bookmark", 1]])
            document.set_metadata({"title": "OCR retained"})
            document.save(source, encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="reader", owner_pw="owner")
        with fitz.open() as recognized:
            recognized.new_page().insert_text((72, 72), "SEARCHABLE")
            payload = recognized.tobytes()
        with patch.object(fitz.Pixmap, "pdfocr_tobytes", return_value=payload):
            core.operate_pdf(source, "ocr", {"password": "reader", "language": "eng"})
        with fitz.open(source) as document:
            self.assertTrue(document.needs_pass)
            self.assertTrue(document.authenticate("reader"))
            self.assertIn("SEARCHABLE", document[0].get_text())
            self.assertEqual(document.metadata["title"], "OCR retained")
            self.assertEqual(len(list(document[0].annots())), 1)
            self.assertEqual(len(document[0].get_links()), 1)
            self.assertEqual(document.get_toc(), [[1, "Bookmark", 1]])

    def test_reader_password_respects_no_edit_or_copy_permissions(self):
        output = self.root / "restricted.pdf"
        core.operate_pdf(self.source, "encrypt", {"owner_password": "owner", "user_password": "reader", "permissions": 0}, output)
        original = output.read_bytes()
        for operation, options, target in [("rotate", {"angle":90}, None), ("export", {"format":"txt"}, self.root / "no.txt")]:
            with self.assertRaises(PermissionError):
                core.operate_pdf(output, operation, {**options, "password":"reader"}, target)
        self.assertEqual(output.read_bytes(), original)
        core.operate_pdf(output, "rotate", {"angle":90, "password":"owner"})
        self.assertNotEqual(output.read_bytes(), original)

    def test_extract_keeps_requested_page_order(self):
        output = self.root / "ordered.pdf"
        core.operate_pdf(self.source, "extract", {"pages":[2,0]}, output)
        with fitz.open(output) as document:
            self.assertIn("Page 3", document[0].get_text())
            self.assertIn("Page 1", document[1].get_text())

    def test_oversized_text_does_not_silently_disappear(self):
        original = self.source.read_bytes()
        with self.assertRaises(ValueError):
            core.operate_pdf(self.source, "add_text", {"text":"too large " * 5000, "width":30, "height":20})
        self.assertEqual(self.source.read_bytes(), original)

    def test_encrypted_signature_preserves_password_and_verifies(self):
        from test_embedded_pdf_core import make_certificate
        source = self.encrypt()
        certificate = self.root / "identity.p12"
        make_certificate(certificate, b"secret")
        output = self.root / "signed.pdf"
        core.operate_pdf(source, "sign", {"password":"reader", "certificate":str(certificate), "certificate_password":"secret", "field_name":"Signature1"}, output)
        self.assert_encrypted(output, 3)
        report = core.verify_signatures_pdf(output, {"password":"reader"})
        self.assertEqual(report["count"],1)
        self.assertTrue(report["signatures"][0]["intact"])
        self.assertTrue(report["signatures"][0]["valid"])
        self.assertFalse(report["signatures"][0]["trusted"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
