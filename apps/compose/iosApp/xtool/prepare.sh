#!/usr/bin/env bash
# Lays out what xtool needs beside xtool.yml, from files that already live elsewhere in the repo:
#   Sources/Kimono/        links to ../Kimono/*.swift and the two files the app shares with KimonoFiles
#   Resources/AppIcon.png  the asset catalog's 1024px icon (a copy: xtool copies links as links)
#   Frameworks/Shared.xcframework   the Compose app, built on a Mac
#   compose-resources/composeResources   its resources, at the bundle root where Compose looks
#
#   ./prepare.sh                         uses Frameworks/Shared.xcframework as it is (unzipped or copied in)
#   ./prepare.sh path/to/Shared.xcframework[.zip]   takes it from there first
#   ./prepare.sh --gradle                builds it here with Gradle (macOS only)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ios="$(cd "$here/.." && pwd)"
compose="$(cd "$ios/.." && pwd)"
cd "$here"

# The Swift sources, as links, so there's one copy of each and Xcode and xtool build the same code.
rm -rf Sources && mkdir -p Sources/Kimono
# KIMONO_COPY_SOURCES=1 copies instead, should a SwiftPM version refuse sources linked from outside the package.
for f in "$ios"/Kimono/*.swift "$ios/KimonoFiles/Drive.swift" "$ios/KimonoFiles/Thumbnails.swift"; do
  if [ "${KIMONO_COPY_SOURCES:-}" = 1 ]; then cp "$f" Sources/Kimono/
  else ln -s "../../../${f#"$ios"/}" "Sources/Kimono/$(basename "$f")"; fi
done

mkdir -p Resources
cp "$ios/Kimono/Assets.xcassets/AppIcon.appiconset/icon-1024.png" Resources/AppIcon.png

xcf="Frameworks/Shared.xcframework"
case "${1:-}" in
  --gradle)
    [ "$(uname)" = Darwin ] || { echo "Kotlin/Native links iOS frameworks only on macOS; build on a Mac or in CI (README.md)." >&2; exit 1; }
    (cd "$compose" && ./gradlew :shared:assembleSharedReleaseXCFramework)
    rm -rf "$xcf" && mkdir -p Frameworks
    cp -R "$compose/shared/build/XCFrameworks/release/Shared.xcframework" "$xcf"
    ;;
  "") ;;
  *)
    src="$1"; rm -rf "$xcf"; mkdir -p Frameworks
    if [[ "$src" == *.zip ]]; then
      tmp="$(mktemp -d)"; unzip -q "$src" -d "$tmp"
      found="$(find "$tmp" -maxdepth 3 -type d -name Shared.xcframework | head -1)"
      [ -n "$found" ] || { echo "No Shared.xcframework inside $src" >&2; exit 1; }
      mv "$found" "$xcf"; rm -rf "$tmp"
    else
      cp -R "$src" "$xcf"
    fi
    ;;
esac
[ -d "$xcf" ] || { echo "Missing $here/$xcf. Pass its path, or see README.md for building it." >&2; exit 1; }

# The device slice's resources (the simulator's are the same files) to the bundle root.
framework="$(find "$xcf" -maxdepth 2 -type d -path '*ios-arm64/Shared.framework' | grep -v simulator | head -1)"
[ -n "$framework" ] || { echo "No ios-arm64 slice in $xcf" >&2; exit 1; }
rm -rf compose-resources && mkdir -p compose-resources
if [ -d "$framework/composeResources" ]; then
  cp -R "$framework/composeResources" compose-resources/composeResources
else
  echo "warning: $framework has no composeResources; fonts and icons will be missing (Compose Multiplatform 1.8+ packs them)." >&2
fi

echo "Ready: xtool dev   (or: xtool dev build)"
