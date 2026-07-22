#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
APP_ROOT="$PROJECT_ROOT/cross-platform"

cd "$APP_ROOT"
npm ci
npm run check
npm run frontend:build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib live_complete_office_pipeline -- --ignored --nocapture

DEFAULT_SIGNING_KEY="$HOME/Library/Application Support/OpenDesk TW/Signing/opendesk-tauri.key"
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" && -f "$DEFAULT_SIGNING_KEY" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$DEFAULT_SIGNING_KEY"
fi
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(< "$TAURI_SIGNING_PRIVATE_KEY_PATH")"
fi
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" && "$(uname -s)" == "Darwin" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -a WhaleChao -s OpenDeskTW-Tauri-Signing -w)"
fi
test -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}"
test -n "${TAURI_SIGNING_PRIVATE_KEY:-}"
test -n "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
npm run build -- --bundles app,dmg

APP_BUNDLE="$(/usr/bin/find src-tauri/target/release/bundle/macos -maxdepth 1 -name 'OpenDesk TW.app' -type d -print -quit)"
DMG="$(/usr/bin/find src-tauri/target/release/bundle/dmg -maxdepth 1 -name '*.dmg' -type f -print -quit)"
UPDATER_ARCHIVE="$(/usr/bin/find src-tauri/target/release/bundle/macos -maxdepth 1 -name '*.app.tar.gz' -type f -print -quit)"
test -n "$APP_BUNDLE"
test -n "$DMG"
test -n "$UPDATER_ARCHIVE"
test -s "$UPDATER_ARCHIVE.sig"
/usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
print "CROSS_PLATFORM_MAC_PASS $APP_BUNDLE $DMG $UPDATER_ARCHIVE.sig"
