# Kimono with xtool (Linux → iPhone or iPad)

[xtool](https://xtool.sh) builds, signs and installs an iOS app from Linux using SwiftPM and
an iOS SDK it extracts from Xcode's `.xip`. This folder builds the same Swift sources as the
Xcode project (`../project.yml`), so either can be used; TestFlight releases still go through
Xcode in CI.

## What can't be done on Linux

The Swift shell compiles fine with xtool. **The Compose app can't**: Kotlin/Native lists every
Apple target as macOS-host only, so `Shared.framework` has to be linked on a Mac. It doesn't
change often, so build it once on macOS and reuse it until the Kotlin changes:

| Where | Command |
| --- | --- |
| GitHub Actions | Run **Shared.xcframework for xtool** (`.github/workflows/ios-xcframework.yml`), then `gh run download --repo kimonoapps/kimono -n Shared.xcframework -D /tmp/kimono-fw` |
| Any Mac (JDK 21, Xcode's command line tools) | `cd apps/compose && ./gradlew :shared:assembleSharedReleaseXCFramework` → `shared/build/XCFrameworks/release/Shared.xcframework` |

Gradle configures the Android target too, so the Mac needs an Android SDK: `sdk.dir` in
`apps/compose/local.properties` (gitignored, as the root README says) or `ANDROID_HOME`.
GitHub's macOS runners have one.

## Build and install

One-time: install xtool and its SDK (`xtool setup`), sign in with your Apple ID, and plug the
iPad in (or pair it over Wi-Fi) and trust the computer. See xtool's Linux installation guide.

```sh
cd apps/compose/iosApp/xtool
./prepare.sh /tmp/kimono-fw/Shared.xcframework.zip   # or a path to Shared.xcframework
xtool dev                                            # build, sign and install on the connected device
```

`prepare.sh` links the Swift files into `Sources/`, copies the 1024px icon (xtool has no
asset catalog compiler) and lifts the Compose resources out of the static framework into
`compose-resources/`, where Compose Multiplatform looks when no framework is embedded. Run it
again after adding a Swift file or getting a new framework. `xtool dev build` builds without
installing; the app lands in `xtool/Kimono.app` to inspect its `Info.plist`.

## Why it's a real iPad app

`Kimono-Info.plist` sets `UIDeviceFamily` to `[1, 2]` and all four
`UISupportedInterfaceOrientations~ipad`. Without family `2`, iPadOS shows the iPhone app in a
small fixed window (compatibility mode). The four orientations, a launch screen and no
`UIRequiresFullScreen` are what Split View, Slide Over and Stage Manager need. The Xcode build
gets the same from `TARGETED_DEVICE_FAMILY: "1,2"` in `../project.yml`.

## Entitlements

This first build has none, so it installs with a free Apple ID. That costs three things,
each of which degrades without crashing:

- **Keychain sharing.** `KimonoKeychainGroup` is left unexpanded, so `Host.swift` keeps the
  sign-in in the app's own keychain, and can't read the versions Kimono Photos and Watch leave.
- **Universal Links** (`applinks:www.kimonolabs.dev`). xtool signs a prefixed bundle ID that
  the site's `apple-app-site-association` doesn't list.
- **Kimono in the Files app.** The File Provider extension (KimonoFiles) needs the app group.

With a paid team (its ID is `TEAMID` below), add `Kimono-xtool.entitlements`:

```xml
<plist version="1.0"><dict>
  <key>keychain-access-groups</key><array><string>TEAMID.app.kimono.shared</string></array>
  <key>com.apple.security.application-groups</key><array><string>group.app.kimono</string></array>
</dict></plist>
```

then add `entitlementsPath: Kimono-xtool.entitlements` to `xtool.yml` and set
`KimonoKeychainGroup` in `Kimono-Info.plist` to `TEAMID.app.kimono.shared`.

**The Files extension** comes after that. Add a `KimonoFiles` library product and target
(`path: "Sources/KimonoFiles"`, linking `FileProvider` and `UniformTypeIdentifiers`) to
`Package.swift`, and have `prepare.sh` link `../KimonoFiles/*.swift` there. In `xtool.yml`:

```yaml
extensions:
  - product: KimonoFiles
    infoPath: KimonoFiles-Info.plist
    entitlementsPath: KimonoFiles-xtool.entitlements
```

`KimonoFiles-Info.plist` takes the `info.properties` of the KimonoFiles target in
`../project.yml`, with `NSExtensionPrincipalClass` written as
`KimonoFiles.FileProviderExtension` and no `CFBundleIcons`, since the `kimono.blossom` symbol
lives in the asset catalog.

## When something's off

- **Undefined symbols at link time** (`_OBJC_CLASS_$_…`, `std::…`): add the framework or
  library to `linkerSettings` in `Package.swift`. A static Kotlin framework doesn't bring
  its own links.
- **`MissingResourceException` at launch**: `compose-resources/` is empty. The framework
  must come from Compose Multiplatform 1.8 or later, which packs `composeResources` inside it.
- **SwiftPM won't take the linked sources**: `KIMONO_COPY_SOURCES=1 ./prepare.sh …` copies them.
- **It opens in a small iPhone window on the iPad**: check `UIDeviceFamily` in
  `xtool/Kimono.app/Info.plist`. If it reads `1, 2` and the window is still small, delete the
  old install from the iPad and install again.
