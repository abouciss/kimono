// swift-tools-version: 6.0
//
// Kimono for iPhone and iPad, built with xtool (https://xtool.sh) instead of Xcode, so it can be
// built and installed from Linux. The Xcode project (../project.yml) stays the release build; this
// package compiles the very same Swift files. `./prepare.sh` links them into Sources/ and lays out
// Shared.xcframework, the app icon and the Compose resources; see README.md.

import PackageDescription

let package = Package(
    name: "Kimono",
    platforms: [.iOS(.v17)],
    products: [
        // xtool turns the library named in xtool.yml into the app.
        .library(name: "Kimono", targets: ["Kimono"]),
    ],
    targets: [
        // The Compose Multiplatform app, built on a Mac (Kotlin/Native only links Apple targets
        // on macOS) by `./gradlew :shared:assembleSharedReleaseXCFramework`. It's a static
        // framework, so it's linked into the app rather than copied into Frameworks/.
        .binaryTarget(name: "Shared", path: "Frameworks/Shared.xcframework"),
        .target(
            name: "Kimono",
            dependencies: ["Shared"],
            path: "Sources/Kimono",
            linkerSettings: [
                // A static Kotlin framework brings its code but not its links: the system
                // frameworks Compose (Skia on Metal) and the iOS side of the shared app use.
                .linkedFramework("UIKit"),
                .linkedFramework("Foundation"),
                .linkedFramework("QuartzCore"),
                .linkedFramework("Metal"),
                .linkedFramework("CoreText"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("AVFAudio"),
                .linkedFramework("AVKit"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("MediaPlayer"),
                .linkedFramework("WebKit"),
                .linkedLibrary("c++"),
            ]
        ),
    ],
    // The Xcode project builds these files as Swift 5 (SWIFT_VERSION 5.0); so does this.
    swiftLanguageModes: [.v5]
)
