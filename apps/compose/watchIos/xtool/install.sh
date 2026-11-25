#!/usr/bin/env bash
# Builds Kimono Watch with xtool and installs it, in place of `xtool dev`.
#
# MPVKit's xcframeworks are static libraries wrapped as frameworks. SwiftPM links their code into
# the app, as Xcode does, but xtool also copies the wrappers into KimonoWatch.app/Frameworks as if
# they were dynamic, and its signer can't sign a static archive ("Invalid arch file in fat mach-o
# file!"). Xcode never embeds them; neither does this: they're removed before signing.
#
#   ./install.sh                 builds, then installs to the device plugged in
#   ./install.sh --udid <udid>   to a particular one (anything after is passed to `xtool install`)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
xtool dev build
app="xtool/KimonoWatch.app"
for x in ../MPVKit/Frameworks/*.xcframework; do
  rm -rf "$app/Frameworks/$(basename "$x" .xcframework).framework"
done
rmdir "$app/Frameworks" 2>/dev/null || true
xtool install "$@" "$app"
