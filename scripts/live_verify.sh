#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
RUN_ID="$(/bin/date +%Y%m%d-%H%M%S)"
RUN_ROOT="$PROJECT_ROOT/Tests/LiveRun-$RUN_ID"
FIXTURES="$RUN_ROOT/Fixtures"
ROUNDTRIP="$RUN_ROOT/RoundTrip"
PDF_ROOT="$RUN_ROOT/PDF"
NEW_DOCUMENTS="$RUN_ROOT/NewDocuments"
NODE_BIN="/Users/ai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
NODE_MODULES="/Users/ai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"
PYTHON_BIN="/Users/ai/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
VALIDATE_DOCX="/Users/ai/.codex/skills/docx/scripts/office/validate.py"
VALIDATE_PPTX="/Users/ai/.codex/skills/pptx/scripts/office/validate.py"
SOFFICE="/Applications/LibreOffice.app/Contents/MacOS/soffice"

/bin/mkdir -p "$FIXTURES" "$ROUNDTRIP" "$PDF_ROOT" "$NEW_DOCUMENTS"

NODE_PATH="$NODE_MODULES" "$NODE_BIN" "$PROJECT_ROOT/scripts/generate_live_documents.js" "$FIXTURES"
"$PYTHON_BIN" "$PROJECT_ROOT/scripts/generate_live_spreadsheet.py" "$FIXTURES"

"$PROJECT_ROOT/scripts/build_app.sh"
CLI="$PROJECT_ROOT/dist/OpenDesk TW.app/Contents/MacOS/OpenDeskTW"
TEMPLATE_ROOT="$PROJECT_ROOT/dist/OpenDesk TW.app/Contents/Resources/Templates"
"$PYTHON_BIN" "$PROJECT_ROOT/scripts/verify_blank_templates.py" "$TEMPLATE_ROOT"
"$CLI" --create-document text "$NEW_DOCUMENTS/Blank-Document.docx"
"$CLI" --create-document spreadsheet "$NEW_DOCUMENTS/Blank-Spreadsheet.xlsx"
"$CLI" --create-document presentation "$NEW_DOCUMENTS/Blank-Presentation.pptx"
"$PYTHON_BIN" "$PROJECT_ROOT/scripts/verify_blank_templates.py" "$NEW_DOCUMENTS"
python3 "$VALIDATE_DOCX" "$NEW_DOCUMENTS/Blank-Document.docx"
python3 "$VALIDATE_PPTX" "$NEW_DOCUMENTS/Blank-Presentation.pptx"
"$CLI" --health
MAGI_STATUS="$("$CLI" --magi-status)"
print -r -- "$MAGI_STATUS" | /usr/bin/jq -e '.activeVersion == "v2"' >/dev/null
print -r -- "$MAGI_STATUS" | /usr/bin/jq -e '.singleActiveSafe == true' >/dev/null
print -r -- "$MAGI_STATUS" | /usr/bin/jq -e '.endpoints[] | select(.id == "main") | .healthy == true' >/dev/null
print -r -- "$MAGI_STATUS" | /usr/bin/jq -e '.endpoints[] | select(.id == "tools") | .healthy == true' >/dev/null
print -r -- "$MAGI_STATUS" | /usr/bin/jq -e '.v3Compatibility.compatible == true' >/dev/null
print -r -- "$MAGI_STATUS" | /usr/bin/jq -e '.v3Compatibility.v2RoutesPreserved == true' >/dev/null
print -r -- "$MAGI_STATUS" | /usr/bin/jq -e '.v3Compatibility.canonicalEnvelopeVerified == true' >/dev/null
# V3 的離線品質驗證程序可以在候選版資料夾中執行；只有正式 runtime
# 的 V3 服務與 V2 同時存在才算衝突。上方狀態報告已使用同一規則驗證。
if /usr/bin/pgrep -fl 'MAGI_v3|magi_v3' | /usr/bin/grep -i 'python' | /usr/bin/grep -F '/Library/Application Support/MAGI/runtime/MAGI_v3/' >/dev/null; then
    print -u2 "正式 MAGI V3 runtime 不應與正在運作的 V2 同時啟動"
    exit 1
fi
"$CLI" --scan "$FIXTURES/OpenDeskTW_LIVE_Writer.docx"
"$CLI" --scan "$FIXTURES/OpenDeskTW_LIVE_Sheets.xlsx"
"$CLI" --scan "$FIXTURES/OpenDeskTW_LIVE_Slides.pptx"
DOCUMENT_HEALTH="$("$CLI" --document-health "$FIXTURES/OpenDeskTW_LIVE_Writer.docx")"
[[ "$DOCUMENT_HEALTH" == *"三項一致通過"* ]]
EXTRACTED_TEXT="$("$CLI" --extract-text "$FIXTURES/OpenDeskTW_LIVE_Writer.docx")"
print -r -- "$EXTRACTED_TEXT" | /usr/bin/jq -e '.originalCharacterCount > 100 and .truncated == false and (.text | contains("功能驗證表格"))' >/dev/null
MAGI_ANALYSIS="$("$CLI" --magi-analyze "$FIXTURES/OpenDeskTW_LIVE_Writer.docx" summary "請確認這是一份功能驗證文件，並列出三個主要驗證項目。")"
print -r -- "$MAGI_ANALYSIS" | /usr/bin/jq -e '.reply.compatibilityVersion == "v2" and .reply.degraded == false and (.reply.text | length > 20)' >/dev/null

python3 "$VALIDATE_DOCX" "$FIXTURES/OpenDeskTW_LIVE_Writer.docx"
"$CLI" --headings "$FIXTURES/OpenDeskTW_LIVE_Writer.docx"
"$CLI" --renumber-headings "$FIXTURES/OpenDeskTW_LIVE_Writer.docx"
python3 "$VALIDATE_DOCX" "$FIXTURES/OpenDeskTW_LIVE_Writer-重新編號.docx"
HEADING_OUTPUT="$("$CLI" --headings "$FIXTURES/OpenDeskTW_LIVE_Writer-重新編號.docx")"
[[ "$HEADING_OUTPUT" == *"〔壹、〕"* ]]
[[ "$HEADING_OUTPUT" == *"〔貳、〕"* ]]

"$SOFFICE" "-env:UserInstallation=file:///tmp/OpenDeskTW-Live-$RUN_ID-PPTX" --headless --convert-to pptx --outdir "$ROUNDTRIP" "$FIXTURES/OpenDeskTW_LIVE_Slides.pptx"
python3 "$VALIDATE_PPTX" "$ROUNDTRIP/OpenDeskTW_LIVE_Slides.pptx"
"$SOFFICE" "-env:UserInstallation=file:///tmp/OpenDeskTW-Live-$RUN_ID-XLSX" --headless --convert-to xlsx --outdir "$ROUNDTRIP" "$FIXTURES/OpenDeskTW_LIVE_Sheets.xlsx"
"$PYTHON_BIN" "$PROJECT_ROOT/scripts/verify_spreadsheet.py" "$ROUNDTRIP/OpenDeskTW_LIVE_Sheets.xlsx"

"$CLI" --convert-pdf "$FIXTURES/OpenDeskTW_LIVE_Writer.docx" "$PDF_ROOT"
"$CLI" --convert-pdf "$FIXTURES/OpenDeskTW_LIVE_Sheets.xlsx" "$PDF_ROOT"
"$CLI" --convert-pdf "$FIXTURES/OpenDeskTW_LIVE_Slides.pptx" "$PDF_ROOT"

WRITER_PDF="$(/usr/bin/find "$PDF_ROOT" -name 'OpenDeskTW_LIVE_Writer.pdf' -type f -print -quit)"
SHEETS_PDF="$(/usr/bin/find "$PDF_ROOT" -name 'OpenDeskTW_LIVE_Sheets.pdf' -type f -print -quit)"
SLIDES_PDF="$(/usr/bin/find "$PDF_ROOT" -name 'OpenDeskTW_LIVE_Slides.pdf' -type f -print -quit)"
/opt/homebrew/bin/pdfinfo "$WRITER_PDF" | /usr/bin/grep -q 'Pages:.*2'
/opt/homebrew/bin/pdfinfo "$SHEETS_PDF" | /usr/bin/grep -q 'Pages:.*3'
/opt/homebrew/bin/pdfinfo "$SLIDES_PDF" | /usr/bin/grep -q 'Pages:.*2'
/opt/homebrew/bin/pdftotext "$WRITER_PDF" - | /usr/bin/grep -q '第 2 頁，共 2 頁'
/opt/homebrew/bin/pdftotext "$SHEETS_PDF" - | /usr/bin/grep -q '公式應為 26'
/opt/homebrew/bin/pdftotext "$SLIDES_PDF" - | /usr/bin/grep -q '完整性檢查矩陣'

/usr/bin/codesign --verify --deep --strict "$PROJECT_ROOT/dist/OpenDesk TW.app"
print "LIVE_VERIFY_PASS $RUN_ROOT"
