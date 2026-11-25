# Kimono Watch with xtool (Linux, no Xcode)

The same Swift files as the Xcode project (`../project.yml`), packaged for
[xtool](https://xtool.sh) so Kimono Watch builds and installs on an iPhone or
iPad from Linux. The Xcode project stays the release build.

Kotlin/Native links Apple frameworks only on macOS, so `WatchShared.xcframework`
comes from CI:

```sh
gh workflow run ios-xcframework.yml --ref <branch> -f app=watch
gh run download <run> -n WatchShared.xcframework -D /tmp/kimono-watch-fw
./prepare.sh /tmp/kimono-watch-fw/WatchShared.xcframework.zip
xtool dev            # or: xtool dev build
```

`prepare.sh` also runs `../MPVKit/fetch.sh` once (libmpv and FFmpeg's LGPL
xcframeworks, about 1 GB, checksummed) and copies the subtitle fonts and the
app icon. Swift-only changes rebuild without CI; Kotlin changes need a new
framework.

Differences from the Xcode build: no shared keychain group (it needs a paid
team), so Kimono can't read this build's version; the launch screen is plain,
since xtool can't compile the asset catalog.
