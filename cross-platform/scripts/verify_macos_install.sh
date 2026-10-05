#!/usr/bin/env bash
set -euo pipefail
root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/opendesk-install-verification"
mkdir -p "$root"
image=$(find src-tauri/target/release/bundle/dmg -name '*.dmg' -maxdepth 1 -print -quit)
hdiutil verify "$image"
hdiutil attach "$image" -readonly -nobrowse -mountpoint "$root/mount"
trap 'hdiutil detach "$root/mount" >/dev/null 2>&1 || true' EXIT
app=$(find "$root/mount" -maxdepth 1 -name '*.app' -print -quit)
[ -n "$app" ]
ditto "$app" "$root/installed.app"
hdiutil detach "$root/mount"
trap - EXIT
codesign --verify --deep --strict "$root/installed.app"
export OPENDESK_DATA_DIR="$root/profile"
export OPENDESK_DIAGNOSTICS="$root/diagnostics"
"$root/installed.app/Contents/MacOS/document-workbench-tw" --verify-install "$root"
"$root/installed.app/Contents/MacOS/document-workbench-tw" >"$root/gui.log" 2>&1 &
gui_pid=$!
trap 'kill "$gui_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 180); do
  [ -f "$root/diagnostics/window_ready.json" ] && break
  kill -0 "$gui_pid"
  sleep .5
done
node --input-type=module - "$root" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const proof = JSON.parse(fs.readFileSync(path.join(root,'verification.json')));
const ready = JSON.parse(fs.readFileSync(path.join(root,'diagnostics/window_ready.json')));
const version = JSON.parse(fs.readFileSync('package.json')).version;
if (!proof.passed || !proof.packaged_core || proof.version !== version || ready.version !== version || ready.summary.navigation !== 6) throw new Error('Installed verification failed');
fs.writeFileSync('macos-install-verification.json',JSON.stringify({...proof,window_ready:true,dmg_verified:true,codesign_integrity:true},null,2));
JS
kill "$gui_pid"
wait "$gui_pid" || true
trap - EXIT
