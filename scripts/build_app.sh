#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
BUILD_ROOT="$PROJECT_ROOT/build"
DIST_ROOT="$PROJECT_ROOT/dist"
APP_BUNDLE="$DIST_ROOT/OpenDesk TW.app"

/usr/bin/swift build -c release --package-path "$PROJECT_ROOT"
BIN_DIR="$(/usr/bin/swift build -c release --package-path "$PROJECT_ROOT" --show-bin-path)"

/bin/rm -rf "$APP_BUNDLE"
/bin/mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources" "$BUILD_ROOT"
/usr/bin/install -m 755 "$BIN_DIR/OpenDeskTW" "$APP_BUNDLE/Contents/MacOS/OpenDeskTW"
/usr/bin/install -m 644 "$PROJECT_ROOT/AppResources/Info.plist" "$APP_BUNDLE/Contents/Info.plist"

/bin/zsh "$PROJECT_ROOT/scripts/generate_blank_templates.sh"
/bin/mkdir -p "$APP_BUNDLE/Contents/Resources/Templates"
/usr/bin/install -m 644 "$PROJECT_ROOT/AppResources/Templates/Blank-Document.docx" "$APP_BUNDLE/Contents/Resources/Templates/Blank-Document.docx"
/usr/bin/install -m 644 "$PROJECT_ROOT/AppResources/Templates/Blank-Spreadsheet.xlsx" "$APP_BUNDLE/Contents/Resources/Templates/Blank-Spreadsheet.xlsx"
/usr/bin/install -m 644 "$PROJECT_ROOT/AppResources/Templates/Blank-Presentation.pptx" "$APP_BUNDLE/Contents/Resources/Templates/Blank-Presentation.pptx"

/bin/mkdir -p "$APP_BUNDLE/Contents/Resources/Verification"
/usr/bin/install -m 644 "$PROJECT_ROOT/AppResources/Verification/OpenDeskTW_完整文字功能.docx" "$APP_BUNDLE/Contents/Resources/Verification/OpenDeskTW_完整文字功能.docx"
/usr/bin/install -m 644 "$PROJECT_ROOT/AppResources/Verification/OpenDeskTW_完整試算表功能.xlsx" "$APP_BUNDLE/Contents/Resources/Verification/OpenDeskTW_完整試算表功能.xlsx"
/usr/bin/install -m 644 "$PROJECT_ROOT/AppResources/Verification/OpenDeskTW_完整簡報功能.pptx" "$APP_BUNDLE/Contents/Resources/Verification/OpenDeskTW_完整簡報功能.pptx"
/usr/bin/install -m 644 "$PROJECT_ROOT/AppResources/Verification/OfficeFeatureMatrix.json" "$APP_BUNDLE/Contents/Resources/Verification/OfficeFeatureMatrix.json"

MAGI_COMPATIBILITY="$BUILD_ROOT/MAGICompatibility.json"
/bin/zsh "$PROJECT_ROOT/scripts/generate_magi_compatibility.sh" "$MAGI_COMPATIBILITY"
/usr/bin/install -m 644 "$MAGI_COMPATIBILITY" "$APP_BUNDLE/Contents/Resources/MAGICompatibility.json"

ICON_PNG="$BUILD_ROOT/AppIcon-1024.png"
ICONSET="$BUILD_ROOT/AppIcon.iconset"
/usr/bin/swift "$PROJECT_ROOT/scripts/make_icon.swift" "$ICON_PNG"
/bin/rm -rf "$ICONSET"
/bin/mkdir -p "$ICONSET"
for pair in "16 icon_16x16.png" "32 icon_16x16@2x.png" "32 icon_32x32.png" "64 icon_32x32@2x.png" "128 icon_128x128.png" "256 icon_128x128@2x.png" "256 icon_256x256.png" "512 icon_256x256@2x.png" "512 icon_512x512.png" "1024 icon_512x512@2x.png"; do
    pixels="${pair%% *}"
    filename="${pair#* }"
    /usr/bin/sips -z "$pixels" "$pixels" "$ICON_PNG" --out "$ICONSET/$filename" >/dev/null
done
/usr/bin/iconutil -c icns "$ICONSET" -o "$APP_BUNDLE/Contents/Resources/AppIcon.icns"

/usr/bin/codesign --force --deep --sign - "$APP_BUNDLE"
/usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
/usr/bin/plutil -lint "$APP_BUNDLE/Contents/Info.plist"

print "$APP_BUNDLE"
