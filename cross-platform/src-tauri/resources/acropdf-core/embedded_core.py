#!/usr/bin/env python3
"""全能文件工作台內建 AcroPDF 核心。

本檔由 AcroPDF 的 integration_bridge、page_manager、annotation_manager、
redaction_engine 與 optimize_manager 抽離成無視窗核心。它只接受固定白名單命令，
不啟動 AcroPDF 圖形介面，也不連線到網路。

Copyright (c) 2026 WhaleChao. All rights reserved.
依同資料夾 ACROPDF-LICENSE 授權使用。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

_BUNDLED_TESSDATA = Path(getattr(sys, "_MEIPASS", "")) / "tessdata"
if _BUNDLED_TESSDATA.is_dir():
    os.environ["TESSDATA_PREFIX"] = str(_BUNDLED_TESSDATA)

import fitz


APP_VERSION = "1.1.0-embedded"
PROTOCOL_VERSION = 2
CAPABILITIES = [
    {"id": "view", "category": "檢視", "label": "同視窗閱讀、搜尋、縮放與頁面導覽"},
    {"id": "edit", "category": "編輯", "label": "新增文字、便利貼、螢光筆與中繼資料"},
    {"id": "pages", "category": "整理頁面", "label": "合併、分割、擷取、插入、刪除、旋轉與重排"},
    {"id": "annotate", "category": "註解", "label": "搜尋文字後加註、螢光標示與永久遮蔽"},
    {"id": "forms", "category": "表單", "label": "檢查與填寫既有 PDF 表單欄位"},
    {"id": "ocr", "category": "OCR", "label": "透過本機 Tesseract 建立可搜尋 PDF"},
    {"id": "protect", "category": "保護", "label": "AES-256 密碼、解密副本、清除中繼資料與永久遮蔽"},
    {"id": "batch", "category": "批次", "label": "浮水印、頁首頁尾、Bates 編號與最佳化"},
    {"id": "magi", "category": "MAGI", "label": "由全能文件工作台同視窗 MAGI 面板處理文件分析"},
]


def _emit(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def _source(path: str | Path) -> Path:
    source = Path(path).expanduser().resolve()
    if source.suffix.lower() != ".pdf":
        raise ValueError("內建 PDF 核心只接受 PDF 文件")
    if not source.is_file():
        raise FileNotFoundError(f"找不到 PDF：{source}")
    return source


def _open(path: str | Path, password: str = "") -> fitz.Document:
    document = fitz.open(_source(path))
    if document.needs_pass and not document.authenticate(password):
        document.close()
        raise PermissionError("文件受密碼保護，請輸入正確密碼")
    return document


def _page_indices(document: fitz.Document, raw: Any, default: int | None = None) -> list[int]:
    if raw is None:
        values = [default] if default is not None else list(range(document.page_count))
    elif isinstance(raw, int):
        values = [raw]
    else:
        values = [int(value) for value in raw]
    result = sorted({value for value in values if value is not None and 0 <= value < document.page_count})
    if not result:
        raise ValueError("沒有有效的頁碼")
    return result


def _safe_count(iterator: Any) -> int:
    try:
        return sum(1 for _ in iterator or [])
    except Exception:
        return 0


def _metadata(document: fitz.Document) -> dict[str, str]:
    raw = document.metadata or {}
    keys = ("format", "title", "author", "subject", "keywords", "creator", "producer")
    return {key: str(raw.get(key) or "") for key in keys}


def status() -> dict[str, Any]:
    return {
        "ok": True,
        "engine": "全能文件工作台內建 PDF 核心",
        "app_version": APP_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "locale": "zh-Hant-TW",
        "embedded": True,
        "opens_external_app": False,
        "privacy": "本機處理；不啟動其他 APP；不傳送文件",
        "capabilities": CAPABILITIES,
    }


def inspect_pdf(path: str | Path, password: str = "") -> dict[str, Any]:
    source = _source(path)
    document = fitz.open(source)
    try:
        encrypted = bool(document.needs_pass)
        unlocked = not encrypted or bool(password and document.authenticate(password))
        report: dict[str, Any] = {
            "protocol_version": PROTOCOL_VERSION,
            "engine_version": APP_VERSION,
            "file_name": source.name,
            "file_size": source.stat().st_size,
            "pages": document.page_count,
            "encrypted": encrypted,
            "locked": not unlocked,
            "metadata": _metadata(document),
            "characters": 0,
            "words": 0,
            "text_pages": 0,
            "scanned_pages": 0,
            "images": 0,
            "annotations": 0,
            "form_fields": 0,
            "signature_fields": 0,
            "links": 0,
            "bookmarks": 0,
            "attachments": 0,
            "rotated_pages": 0,
            "page_sizes": [],
            "warnings": [],
        }
        if not unlocked:
            report["warnings"] = ["文件受密碼保護；輸入密碼後才能完成內容與表單檢查。"]
            return report

        page_sizes: set[str] = set()
        for page in document:
            text = page.get_text("text") or ""
            non_whitespace = sum(1 for char in text if not char.isspace())
            images = len(page.get_images(full=True))
            report["characters"] += non_whitespace
            report["words"] += len(text.split())
            report["images"] += images
            report["text_pages"] += int(bool(non_whitespace))
            report["scanned_pages"] += int(not non_whitespace and bool(images))
            report["annotations"] += _safe_count(page.annots())
            widgets = list(page.widgets() or [])
            report["form_fields"] += len(widgets)
            report["signature_fields"] += sum(
                1 for widget in widgets if widget.field_type == fitz.PDF_WIDGET_TYPE_SIGNATURE
            )
            report["links"] += len(page.get_links())
            report["rotated_pages"] += int(bool(page.rotation))
            page_sizes.add(f"{round(page.rect.width)}×{round(page.rect.height)} pt")

        report["page_sizes"] = sorted(page_sizes)
        report["bookmarks"] = len(document.get_toc() or [])
        if hasattr(document, "embfile_count"):
            report["attachments"] = int(document.embfile_count())
        warnings: list[str] = []
        if report["scanned_pages"]:
            warnings.append(f"有 {report['scanned_pages']} 頁只有影像，建議執行繁體中文 OCR。")
        if document.page_count >= 6 and not report["bookmarks"]:
            warnings.append("長文件尚無書籤，建議建立導覽結構。")
        if len(page_sizes) > 1:
            warnings.append("文件含多種頁面尺寸，列印或合併前請確認版面。")
        if not report["metadata"]["title"]:
            warnings.append("文件標題中繼資料尚未設定。")
        report["warnings"] = warnings
        return report
    finally:
        document.close()


def live_validate_pdf(path: str | Path, password: str = "") -> dict[str, Any]:
    report = inspect_pdf(path, password)
    if report["locked"]:
        return {
            "protocol_version": PROTOCOL_VERSION,
            "engine_version": APP_VERSION,
            "passed": False,
            "reason": "受密碼保護的 PDF 需要使用者輸入密碼",
            "report": report,
        }
    document = _open(path, password)
    try:
        render_pages = sorted({0, max(0, document.page_count - 1)}) if document.page_count else []
        digest = hashlib.sha256()
        for page_index in render_pages:
            pixmap = document[page_index].get_pixmap(matrix=fitz.Matrix(0.75, 0.75), alpha=False)
            if not pixmap.samples or pixmap.width < 1 or pixmap.height < 1:
                raise RuntimeError(f"第 {page_index + 1} 頁無法渲染")
            digest.update(pixmap.samples)
        roundtrip = document.tobytes(garbage=3, deflate=True)
    finally:
        document.close()
    reopened = fitz.open(stream=roundtrip, filetype="pdf")
    try:
        roundtrip_pages = reopened.page_count
    finally:
        reopened.close()
    return {
        "protocol_version": PROTOCOL_VERSION,
        "engine_version": APP_VERSION,
        "passed": roundtrip_pages == report["pages"] and len(render_pages) > 0,
        "rendered_pages": len(render_pages),
        "render_sha256": digest.hexdigest(),
        "roundtrip_pages": roundtrip_pages,
        "roundtrip_bytes": len(roundtrip),
        "report": report,
    }


def render_page(path: str | Path, page_index: int, scale: float, password: str = "") -> dict[str, Any]:
    document = _open(path, password)
    try:
        if page_index < 0 or page_index >= document.page_count:
            raise IndexError(f"頁碼超出範圍：{page_index + 1}")
        safe_scale = max(0.35, min(float(scale), 3.0))
        pixmap = document[page_index].get_pixmap(
            matrix=fitz.Matrix(safe_scale, safe_scale), alpha=False, annots=True
        )
        png = pixmap.tobytes("png")
        return {
            "protocol_version": PROTOCOL_VERSION,
            "page": page_index,
            "pages": document.page_count,
            "width": pixmap.width,
            "height": pixmap.height,
            "scale": safe_scale,
            "data_url": "data:image/png;base64," + base64.b64encode(png).decode("ascii"),
        }
    finally:
        document.close()


def _traditional_font() -> dict[str, str]:
    candidates = [
        Path("/System/Library/Fonts/PingFang.ttc"),
        Path("/System/Library/Fonts/Supplemental/Songti.ttc"),
        Path("C:/Windows/Fonts/msjh.ttc"),
        Path("C:/Windows/Fonts/mingliu.ttc"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return {"fontname": "opendesktw", "fontfile": str(candidate)}
    return {"fontname": "china-t"}


def _atomic_save(
    document: fitz.Document,
    output: str | Path,
    *,
    encryption: int = fitz.PDF_ENCRYPT_KEEP,
    owner_pw: str = "",
    user_pw: str = "",
    permissions: int = -1,
) -> Path:
    destination = Path(output).expanduser().resolve()
    if destination.suffix.lower() != ".pdf":
        raise ValueError("輸出檔名必須使用 .pdf")
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.stem}-", suffix=".pdf", dir=destination.parent
    )
    os.close(handle)
    temporary = Path(temporary_name)
    try:
        document.save(
            temporary,
            garbage=4,
            deflate=True,
            clean=True,
            encryption=encryption,
            owner_pw=owner_pw,
            user_pw=user_pw,
            permissions=permissions,
        )
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def _split(document: fitz.Document, source: Path, options: dict[str, Any]) -> list[str]:
    output_dir = Path(options.get("output_dir") or source.parent).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    ranges = options.get("ranges") or [[index, index] for index in range(document.page_count)]
    outputs: list[str] = []
    for number, raw_range in enumerate(ranges, start=1):
        start, end = int(raw_range[0]), int(raw_range[1])
        if start < 0 or end < start or end >= document.page_count:
            raise ValueError(f"無效的分割範圍：{start + 1}–{end + 1}")
        part = fitz.open()
        try:
            part.insert_pdf(document, from_page=start, to_page=end)
            destination = output_dir / f"{source.stem}_第{number}部分.pdf"
            _atomic_save(part, destination, encryption=fitz.PDF_ENCRYPT_NONE)
            outputs.append(str(destination))
        finally:
            part.close()
    return outputs


def _ocr(document: fitz.Document, options: dict[str, Any]) -> fitz.Document:
    language = str(options.get("language") or "chi_tra+eng")
    dpi = max(150, min(int(options.get("dpi") or 250), 400))
    output = fitz.open()
    try:
        for page in document:
            pixmap = page.get_pixmap(dpi=dpi, alpha=False)
            ocr_bytes = pixmap.pdfocr_tobytes(language=language, compress=True)
            ocr_page = fitz.open(stream=ocr_bytes, filetype="pdf")
            try:
                output.insert_pdf(ocr_page)
            finally:
                ocr_page.close()
        return output
    except Exception:
        output.close()
        raise


def operate_pdf(
    path: str | Path,
    operation: str,
    options: dict[str, Any],
    output: str | Path | None,
) -> dict[str, Any]:
    source = _source(path)
    password = str(options.get("password") or "")
    document = _open(source, password)
    destination = Path(output).expanduser().resolve() if output else source
    result: dict[str, Any] = {"operation": operation, "output": str(destination)}
    replacement: fitz.Document | None = None
    try:
        current_page = int(options.get("page") or 0)
        if operation == "rotate":
            angle = int(options.get("angle") or 90)
            if angle not in {-270, -180, -90, 90, 180, 270}:
                raise ValueError("旋轉角度必須是 90、180 或 270")
            for index in _page_indices(document, options.get("pages"), current_page):
                page = document[index]
                page.set_rotation((page.rotation + angle) % 360)
        elif operation == "delete":
            pages = _page_indices(document, options.get("pages"), current_page)
            if len(pages) >= document.page_count:
                raise ValueError("PDF 至少必須保留一頁")
            for index in reversed(pages):
                document.delete_page(index)
        elif operation == "insert_blank":
            position = max(0, min(int(options.get("position") or current_page + 1), document.page_count))
            document.new_page(
                pno=position,
                width=float(options.get("width") or 595),
                height=float(options.get("height") or 842),
            )
        elif operation == "reorder":
            order = [int(value) for value in options.get("order") or []]
            if sorted(order) != list(range(document.page_count)):
                raise ValueError("重排順序必須完整包含每一頁")
            document.select(order)
        elif operation == "merge":
            other = _open(str(options.get("other") or ""), str(options.get("other_password") or ""))
            try:
                position = max(0, min(int(options.get("position") or document.page_count), document.page_count))
                document.insert_pdf(other, start_at=position)
            finally:
                other.close()
        elif operation == "extract":
            pages = _page_indices(document, options.get("pages"), current_page)
            replacement = fitz.open()
            for index in pages:
                replacement.insert_pdf(document, from_page=index, to_page=index)
        elif operation == "split":
            outputs = _split(document, source, options)
            return {"protocol_version": PROTOCOL_VERSION, "operation": operation, "outputs": outputs}
        elif operation == "watermark":
            text = str(options.get("text") or "").strip()
            if not text:
                raise ValueError("請輸入浮水印文字")
            fontsize = max(8.0, min(float(options.get("font_size") or 56), 180.0))
            opacity = max(0.05, min(float(options.get("opacity") or 0.22), 1.0))
            for index in _page_indices(document, options.get("pages")):
                page = document[index]
                center = fitz.Point(page.rect.width / 2, page.rect.height / 2)
                radians = math.radians(45)
                morph = (
                    center,
                    fitz.Matrix(math.cos(radians), math.sin(radians), -math.sin(radians), math.cos(radians), 0, 0),
                )
                shape = page.new_shape()
                shape.insert_text(
                    fitz.Point(center.x - len(text) * fontsize * 0.22, center.y),
                    text,
                    fontsize=fontsize,
                    color=(0.48, 0.48, 0.48),
                    morph=morph,
                    **_traditional_font(),
                )
                shape.finish(fill_opacity=opacity, stroke_opacity=opacity)
                shape.commit(overlay=True)
        elif operation == "header_footer":
            header = str(options.get("header") or "")
            footer = str(options.get("footer") or "")
            fontsize = max(6.0, min(float(options.get("font_size") or 10), 30.0))
            bates_start = max(0, int(options.get("bates_start") or 1))
            bates_digits = max(1, min(int(options.get("bates_digits") or 6), 12))
            bates_prefix = str(options.get("bates_prefix") or "")
            for index in _page_indices(document, options.get("pages")):
                page = document[index]
                bates = f"{bates_prefix}{bates_start + index:0{bates_digits}d}"
                replacements = {
                    "{page}": str(index + 1),
                    "{pages}": str(document.page_count),
                    "{bates}": bates,
                }
                header_text = header
                footer_text = footer
                for token, value in replacements.items():
                    header_text = header_text.replace(token, value)
                    footer_text = footer_text.replace(token, value)
                if header:
                    page.insert_textbox(
                        fitz.Rect(30, 10, page.rect.width - 30, 35),
                        header_text,
                        fontsize=fontsize,
                        align=fitz.TEXT_ALIGN_CENTER,
                        **_traditional_font(),
                    )
                if footer:
                    page.insert_textbox(
                        fitz.Rect(30, page.rect.height - 32, page.rect.width - 30, page.rect.height - 8),
                        footer_text,
                        fontsize=fontsize,
                        align=fitz.TEXT_ALIGN_CENTER,
                        **_traditional_font(),
                    )
        elif operation == "add_text":
            page = document[current_page]
            text = str(options.get("text") or "").strip()
            if not text:
                raise ValueError("請輸入文字")
            x = float(options.get("x") or 72)
            y = float(options.get("y") or 72)
            width = float(options.get("width") or min(360, page.rect.width - x - 36))
            height = float(options.get("height") or 100)
            page.insert_textbox(
                fitz.Rect(x, y, x + width, y + height),
                text,
                fontsize=max(6.0, min(float(options.get("font_size") or 12), 72.0)),
                color=(0, 0, 0),
                **_traditional_font(),
            )
        elif operation == "note":
            page = document[current_page]
            note = page.add_text_annot(
                fitz.Point(float(options.get("x") or 72), float(options.get("y") or 72)),
                str(options.get("text") or "全能文件工作台註解"),
            )
            note.set_info(title=str(options.get("author") or "全能文件工作台"))
            note.update()
        elif operation == "highlight_search":
            term = str(options.get("text") or "").strip()
            if not term:
                raise ValueError("請輸入要標示的文字")
            hits = 0
            for page in document:
                for rect in page.search_for(term):
                    annot = page.add_highlight_annot(rect)
                    annot.set_opacity(0.45)
                    annot.update()
                    hits += 1
            result["matches"] = hits
        elif operation == "redact_search":
            term = str(options.get("text") or "").strip()
            if not term:
                raise ValueError("請輸入要永久遮蔽的文字")
            hits = 0
            for page in document:
                page_hits = page.search_for(term)
                for rect in page_hits:
                    page.add_redact_annot(rect, fill=(0, 0, 0))
                if page_hits:
                    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
                    hits += len(page_hits)
            result["matches"] = hits
        elif operation == "fill_form":
            values = options.get("values") or {}
            changed = 0
            for page in document:
                for widget in page.widgets() or []:
                    if widget.field_name in values:
                        widget.field_value = str(values[widget.field_name])
                        widget.update()
                        changed += 1
            result["fields_changed"] = changed
        elif operation == "metadata":
            metadata = document.metadata or {}
            for key in ("title", "author", "subject", "keywords", "creator", "producer"):
                if key in options:
                    metadata[key] = str(options[key])
            document.set_metadata(metadata)
        elif operation == "optimize":
            if bool(options.get("remove_metadata")):
                document.set_metadata({})
                document.scrub()
        elif operation == "encrypt":
            owner_password = str(options.get("owner_password") or "")
            user_password = str(options.get("user_password") or "")
            if not owner_password:
                raise ValueError("請設定擁有者密碼")
            saved = _atomic_save(
                document,
                destination,
                encryption=fitz.PDF_ENCRYPT_AES_256,
                owner_pw=owner_password,
                user_pw=user_password,
                permissions=int(options.get("permissions") or -1),
            )
            result["output"] = str(saved)
            return {"protocol_version": PROTOCOL_VERSION, **result}
        elif operation == "decrypt":
            saved = _atomic_save(document, destination, encryption=fitz.PDF_ENCRYPT_NONE)
            result["output"] = str(saved)
            return {"protocol_version": PROTOCOL_VERSION, **result}
        elif operation == "ocr":
            replacement = _ocr(document, options)
        else:
            raise ValueError(f"不支援的內建 PDF 操作：{operation}")

        target = replacement or document
        saved = _atomic_save(target, destination)
        result["output"] = str(saved)
        result["pages"] = target.page_count
        return {"protocol_version": PROTOCOL_VERSION, **result}
    finally:
        if replacement is not None:
            replacement.close()
        document.close()


def create_blank(output: str | Path, pages: int = 1) -> dict[str, Any]:
    document = fitz.open()
    try:
        for _ in range(max(1, min(int(pages), 100))):
            document.new_page(width=595, height=842)
        saved = _atomic_save(document, output, encryption=fitz.PDF_ENCRYPT_NONE)
        return {
            "protocol_version": PROTOCOL_VERSION,
            "output": str(saved),
            "pages": document.page_count,
        }
    finally:
        document.close()


def compare_pdf(path: str | Path, other_path: str | Path) -> dict[str, Any]:
    left = _open(path)
    right = _open(other_path)
    try:
        changed: list[int] = []
        for index in range(max(left.page_count, right.page_count)):
            if index >= left.page_count or index >= right.page_count:
                changed.append(index)
                continue
            left_text = " ".join((left[index].get_text("text") or "").split())
            right_text = " ".join((right[index].get_text("text") or "").split())
            left_pix = left[index].get_pixmap(matrix=fitz.Matrix(0.25, 0.25), alpha=False)
            right_pix = right[index].get_pixmap(matrix=fitz.Matrix(0.25, 0.25), alpha=False)
            if left_text != right_text or hashlib.sha256(left_pix.samples).digest() != hashlib.sha256(right_pix.samples).digest():
                changed.append(index)
        return {
            "protocol_version": PROTOCOL_VERSION,
            "left_pages": left.page_count,
            "right_pages": right.page_count,
            "changed_pages": changed,
            "changed_count": len(changed),
            "identical": not changed,
        }
    finally:
        left.close()
        right.close()


def main() -> int:
    parser = argparse.ArgumentParser(prog="全能文件工作台內建 AcroPDF 核心")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--integration-status", action="store_true")
    group.add_argument("--integration-inspect", metavar="PDF")
    group.add_argument("--integration-live-test", metavar="PDF")
    group.add_argument("--embedded-render", metavar="PDF")
    group.add_argument("--embedded-operate", metavar="PDF")
    group.add_argument("--embedded-new", metavar="OUTPUT")
    group.add_argument("--embedded-compare", metavar="PDF")
    parser.add_argument("--page", type=int, default=0)
    parser.add_argument("--scale", type=float, default=1.25)
    parser.add_argument("--operation", default="")
    parser.add_argument("--options-json", default="{}")
    parser.add_argument("--output")
    parser.add_argument("--other")
    parser.add_argument("--password", default="")
    parser.add_argument("--pages", type=int, default=1)
    try:
        args = parser.parse_args()
        options = json.loads(args.options_json)
        if not isinstance(options, dict):
            raise ValueError("操作選項必須是 JSON 物件")
        if args.integration_status:
            value = status()
        elif args.integration_inspect:
            value = inspect_pdf(args.integration_inspect, args.password)
        elif args.integration_live_test:
            value = live_validate_pdf(args.integration_live_test, args.password)
        elif args.embedded_render:
            value = render_page(args.embedded_render, args.page, args.scale, args.password)
        elif args.embedded_operate:
            value = operate_pdf(args.embedded_operate, args.operation, options, args.output)
        elif args.embedded_new:
            value = create_blank(args.embedded_new, args.pages)
        else:
            if not args.other:
                raise ValueError("比較 PDF 時必須指定另一份文件")
            value = compare_pdf(args.embedded_compare, args.other)
        _emit(value)
        return 0
    except Exception as error:
        _emit({"ok": False, "error": str(error), "protocol_version": PROTOCOL_VERSION})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
