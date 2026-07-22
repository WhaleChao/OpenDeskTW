#!/usr/bin/env python3
"""建立 PDF sidecar 實際 Python 相依套件的授權清單。"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from importlib import metadata
from pathlib import Path

from packaging.requirements import Requirement


ROOT_DISTRIBUTIONS = (
    "PyInstaller",
    "PyMuPDF",
    "python-docx",
    "openpyxl",
    "python-pptx",
    "pyHanko",
    "pyhanko-certvalidator",
    "xsdata",
    "Pillow",
)
LICENSE_MARKERS = ("license", "copying", "notice", "authors", "copyright")


def configure_utf8_console() -> None:
    """避免 Windows 子程序繼承 cp1252 後無法輸出繁體中文建置訊息。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="backslashreplace")


def canonical(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._@+-]+", "_", value)


def is_license_file(relative: Path) -> bool:
    return any(
        any(part.lower().startswith(marker) for marker in LICENSE_MARKERS)
        for part in relative.parts
    )


def license_expression(distribution: metadata.Distribution) -> str:
    expression = distribution.metadata.get("License-Expression")
    if expression:
        return expression.strip()
    value = distribution.metadata.get("License")
    if value and len(value.strip()) < 160 and "\n" not in value:
        return value.strip()
    classifiers = [
        item.removeprefix("License :: ").strip()
        for item in distribution.metadata.get_all("Classifier", [])
        if item.startswith("License :: ")
    ]
    return "; ".join(classifiers) or "請參閱隨附授權原文"


def active_requirements(distribution: metadata.Distribution) -> list[str]:
    names: list[str] = []
    for raw in distribution.requires or []:
        requirement = Requirement(raw)
        if requirement.marker and not requirement.marker.evaluate({"extra": ""}):
            continue
        names.append(requirement.name)
    return names


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    output = arguments.output.expanduser().resolve()
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    queue = list(ROOT_DISTRIBUTIONS)
    found: dict[str, metadata.Distribution] = {}
    while queue:
        requested = queue.pop(0)
        key = canonical(requested)
        if key in found:
            continue
        try:
            distribution = metadata.distribution(requested)
        except metadata.PackageNotFoundError as error:
            raise SystemExit(f"缺少必要 Python 相依套件：{requested}") from error
        actual_key = canonical(distribution.metadata.get("Name") or requested)
        if actual_key in found:
            continue
        found[actual_key] = distribution
        queue.extend(active_requirements(distribution))

    rows: list[tuple[str, str, str, str, int]] = []
    copied_total = 0
    for key, distribution in sorted(found.items()):
        name = distribution.metadata.get("Name") or key
        version = distribution.version
        project_url = distribution.metadata.get("Home-page") or ""
        if not project_url:
            for item in distribution.metadata.get_all("Project-URL", []):
                if "," in item:
                    label, url = item.split(",", 1)
                    if label.strip().lower() in {"homepage", "repository", "source"}:
                        project_url = url.strip()
                        break
        destination = output / safe_name(f"{name}@{version}")
        destination.mkdir(parents=True)
        copied = 0
        used_names: set[str] = set()
        for relative in distribution.files or []:
            relative_path = Path(str(relative))
            if not is_license_file(relative_path):
                continue
            source = Path(distribution.locate_file(relative)).resolve()
            if not source.is_file():
                continue
            base = safe_name("__".join(relative_path.parts))
            candidate = base
            index = 2
            while candidate.lower() in used_names:
                candidate = f"{index}-{base}"
                index += 1
            used_names.add(candidate.lower())
            shutil.copyfile(source, destination / candidate)
            copied += 1
        copied_total += copied
        rows.append((name, version, license_expression(distribution), project_url, copied))

    lines = [
        "# Python／PDF sidecar 第三方授權",
        "",
        "此檔由 `generate_python_licenses.py` 依目前建置環境自動產生。",
        "",
        "| 套件 | 版本 | 授權 | 上游 | 授權檔數 |",
        "|---|---:|---|---|---:|",
    ]
    for name, version, expression, project_url, copied in rows:
        upstream = f"<{project_url}>" if project_url else "—"
        lines.append(f"| {name} | {version} | {expression} | {upstream} | {copied} |")
    lines.extend(
        [
            "",
            f"共 {len(rows)} 個套件、{copied_total} 份上游授權／告知檔。",
            "",
        ]
    )
    (output / "README.md").write_text("\n".join(lines), encoding="utf-8")
    (output / "packages.json").write_text(
        json.dumps(
            [
                {"name": name, "version": version, "license": expression, "url": project_url}
                for name, version, expression, project_url, _ in rows
            ],
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    if len(rows) < len(ROOT_DISTRIBUTIONS) or copied_total < 5:
        raise SystemExit("Python 第三方授權封裝不完整")
    print(f"Python 授權封裝：{len(rows)} 個套件、{copied_total} 份授權檔")


if __name__ == "__main__":
    configure_utf8_console()
    main()
