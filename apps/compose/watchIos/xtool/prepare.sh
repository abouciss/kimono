#!/usr/bin/env bash
# Lays out what xtool needs beside xtool.yml, from files that already live elsewhere in the repo:
#   Sources/KimonoWatch/     links to ../KimonoWatch/*.swift
#   Resources/AppIcon.png    the asset catalog's 1024px icon (a copy: xtool copies links as links)
#   ../MPVKit/Frameworks/    libmpv and FFmpeg's LGPL xcframeworks (MPVKit/fetch.sh, about 1 GB, once)
#   Frameworks/WatchShared.xcframework    the Compose screens, built on a Mac
#   compose-resources/composeResources    their resources, at the bundle root where Compose looks
#   subtitle-fonts/font      the fonts mpv draws plain subtitles with
#
#   ./prepare.sh                           uses Frameworks/WatchShared.xcframework as it is
#   ./prepare.sh path/to/WatchShared.xcframework[.zip]   takes it from there first
#   ./prepare.sh --gradle                  builds it here with Gradle (macOS only)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ios="$(cd "$here/.." && pwd)"
compose="$(cd "$ios/.." && pwd)"
cd "$here"

# The Swift sources, as links, so there's one copy of each and Xcode and xtool build the same code.
rm -rf Sources && mkdir -p Sources/KimonoWatch
for f in "$ios"/KimonoWatch/*.swift; do
  if [ "${KIMONO_COPY_SOURCES:-}" = 1 ]; then cp "$f" Sources/KimonoWatch/
  else ln -s "../../../${f#"$ios"/}" "Sources/KimonoWatch/$(basename "$f")"; fi
done

mkdir -p Resources
cp "$ios/KimonoWatch/Assets.xcassets/AppIcon.appiconset/icon-1024.png" Resources/AppIcon.png

rm -rf subtitle-fonts && mkdir -p subtitle-fonts
cp -R "$compose/watchShared/src/commonMain/composeResources/font" subtitle-fonts/font

# The player's libraries: fetched once, checksummed, and kept (they're out of git).
"$ios/MPVKit/fetch.sh"

xcf="Frameworks/WatchShared.xcframework"
case "${1:-}" in
  --gradle)
    [ "$(uname)" = Darwin ] || { echo "Kotlin/Native links iOS frameworks only on macOS; build on a Mac or in CI (README.md)." >&2; exit 1; }
    (cd "$compose" && ./gradlew :watchShared:assembleWatchSharedReleaseXCFramework)
    rm -rf "$xcf" && mkdir -p Frameworks
    cp -R "$compose/watchShared/build/XCFrameworks/release/WatchShared.xcframework" "$xcf"
    ;;
  "") ;;
  *)
    src="$1"; rm -rf "$xcf"; mkdir -p Frameworks
    if [[ "$src" == *.zip ]]; then
      tmp="$(mktemp -d)"; unzip -q "$src" -d "$tmp"
      found="$(find "$tmp" -maxdepth 3 -type d -name WatchShared.xcframework | head -1)"
      [ -n "$found" ] || { echo "No WatchShared.xcframework inside $src" >&2; exit 1; }
      mv "$found" "$xcf"; rm -rf "$tmp"
    else
      cp -R "$src" "$xcf"
    fi
    ;;
esac
[ -d "$xcf" ] || { echo "Missing $here/$xcf. Pass its path, or see README.md for building it." >&2; exit 1; }

# The device slice's resources (the simulator's are the same files) to the bundle root.
framework="$(find "$xcf" -maxdepth 2 -type d -path '*ios-arm64/WatchShared.framework' | grep -v simulator | head -1)"
[ -n "$framework" ] || { echo "No ios-arm64 slice in $xcf" >&2; exit 1; }
rm -rf compose-resources && mkdir -p compose-resources
if [ -d "$framework/composeResources" ]; then
  cp -R "$framework/composeResources" compose-resources/composeResources
else
  echo "warning: $framework has no composeResources; fonts and icons will be missing (Compose Multiplatform 1.8+ packs them)." >&2
fi

echo "Ready: xtool dev   (or: xtool dev build)"
