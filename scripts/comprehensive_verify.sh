#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
RUN_ID="$(/bin/date +%Y%m%d-%H%M%S)"
RUN_ROOT="$PROJECT_ROOT/Tests/Comprehensive-$RUN_ID"
FIXTURES="$RUN_ROOT/Fixtures"
PDF_ROOT="$RUN_ROOT/PDF"
RENDER_ROOT="$RUN_ROOT/Renders"
NODE_BIN="/Users/ai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
NODE_MODULES="/Users/ai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"
PYTHON_BIN="/Users/ai/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
VALIDATE_DOCX="/Users/ai/.codex/skills/docx/scripts/office/validate.py"
VALIDATE_PPTX="/Users/ai/.codex/skills/pptx/scripts/office/validate.py"

/bin/mkdir -p "$FIXTURES" "$PDF_ROOT" "$RENDER_ROOT/Writer" "$RENDER_ROOT/Sheets" "$RENDER_ROOT/Slides"

NODE_PATH="$NODE_MODULES" "$NODE_BIN" "$PROJECT_ROOT/scripts/generate_office_feature_matrix.js" "$FIXTURES"
"$PYTHON_BIN" "$PROJECT_ROOT/scripts/generate_office_feature_matrix.py" "$FIXTURES"
"$PYTHON_BIN" "$PROJECT_ROOT/scripts/verify_office_feature_matrix.py" "$FIXTURES" "$RUN_ROOT/OfficeFeatureMatrix.json"
python3 "$VALIDATE_DOCX" "$FIXTURES/OpenDeskTW_完整文字功能.docx"
python3 "$VALIDATE_PPTX" "$FIXTURES/OpenDeskTW_完整簡報功能.pptx"

"$PROJECT_ROOT/scripts/build_app.sh"
CLI="$PROJECT_ROOT/dist/OpenDesk TW.app/Contents/MacOS/OpenDeskTW"
"$CLI" --office-self-test > "$RUN_ROOT/AppSelfTest.json"
/usr/bin/jq -e '.passed == true and .passedCount == 47 and .totalCount == 47' "$RUN_ROOT/AppSelfTest.json" >/dev/null

"$CLI" --convert-pdf "$FIXTURES/OpenDeskTW_完整文字功能.docx" "$PDF_ROOT" >/dev/null
"$CLI" --convert-pdf "$FIXTURES/OpenDeskTW_完整試算表功能.xlsx" "$PDF_ROOT" >/dev/null
"$CLI" --convert-pdf "$FIXTURES/OpenDeskTW_完整簡報功能.pptx" "$PDF_ROOT" >/dev/null
"$PYTHON_BIN" "$PROJECT_ROOT/scripts/verify_office_feature_matrix.py" "$FIXTURES" "$RUN_ROOT/OfficeFeatureMatrix-WithPDF.json" "$PDF_ROOT"

WRITER_PDF="$(/usr/bin/find "$PDF_ROOT" -name 'OpenDeskTW_完整文字功能.pdf' -type f -print -quit)"
SHEETS_PDF="$(/usr/bin/find "$PDF_ROOT" -name 'OpenDeskTW_完整試算表功能.pdf' -type f -print -quit)"
SLIDES_PDF="$(/usr/bin/find "$PDF_ROOT" -name 'OpenDeskTW_完整簡報功能.pdf' -type f -print -quit)"
/opt/homebrew/bin/pdftoppm -png -f 1 -singlefile -r 100 "$WRITER_PDF" "$RENDER_ROOT/Writer/page-1" >/dev/null 2>&1
/opt/homebrew/bin/pdftoppm -png -f 1 -singlefile -r 100 "$SHEETS_PDF" "$RENDER_ROOT/Sheets/page-1" >/dev/null 2>&1
/opt/homebrew/bin/pdftoppm -png -f 2 -singlefile -r 100 "$SLIDES_PDF" "$RENDER_ROOT/Slides/page-2" >/dev/null 2>&1

/usr/bin/codesign --verify --deep --strict "$PROJECT_ROOT/dist/OpenDesk TW.app"
print "COMPREHENSIVE_VERIFY_PASS $RUN_ROOT"
