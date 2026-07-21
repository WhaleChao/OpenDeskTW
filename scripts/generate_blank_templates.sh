#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
OUTPUT_DIRECTORY="$PROJECT_ROOT/AppResources/Templates"
RUNTIME_ROOT="/Users/ai/.cache/codex-runtimes/codex-primary-runtime/dependencies"
NODE_BIN="$RUNTIME_ROOT/node/bin/node"
NODE_MODULES="$RUNTIME_ROOT/node/node_modules"
PYTHON_BIN="$RUNTIME_ROOT/python/bin/python3"

if [[ ! -x "$NODE_BIN" ]]; then
    NODE_BIN="$(command -v node)"
fi
if [[ ! -x "$PYTHON_BIN" ]]; then
    PYTHON_BIN="$(command -v python3)"
fi

/bin/mkdir -p "$OUTPUT_DIRECTORY"
NODE_PATH="$NODE_MODULES" "$NODE_BIN" "$SCRIPT_DIR/generate_blank_templates.js" "$OUTPUT_DIRECTORY"
"$PYTHON_BIN" "$SCRIPT_DIR/generate_blank_spreadsheet.py" "$OUTPUT_DIRECTORY"
