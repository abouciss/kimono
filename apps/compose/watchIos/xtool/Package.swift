// swift-tools-version: 6.0
//
// Kimono Watch for iPhone and iPad, built with xtool (https://xtool.sh) instead of Xcode, so it can
// be built and installed from Linux. The Xcode project (../project.yml) stays the release build; this
// package compiles the very same Swift files. `./prepare.sh` links them into Sources/ and lays out
// WatchShared.xcframework, MPVKit's xcframeworks, the app icon and the resources; see README.md.

import PackageDescription

let package = Package(
    name: "KimonoWatch",
    platforms: [.iOS(.v17)],
    products: [
        // xtool turns the library named in xtool.yml into the app.
        .library(name: "KimonoWatch", targets: ["KimonoWatch"]),
    ],
    dependencies: [
        // libmpv and FFmpeg (LGPL build), the same local package the Xcode project uses.
        .package(path: "../MPVKit"),
    ],
    targets: [
        // The Compose Multiplatform screens, built on a Mac (Kotlin/Native only links Apple targets
        // on macOS) by `./gradlew :watchShared:assembleWatchSharedReleaseXCFramework`. It's static,
        // so it's linked into the app rather than copied into Frameworks/.
        .binaryTarget(name: "WatchShared", path: "Frameworks/WatchShared.xcframework"),
        .target(
            name: "KimonoWatch",
            dependencies: ["WatchShared", .product(name: "MPVKit", package: "MPVKit")],
            path: "Sources/KimonoWatch",
            linkerSettings: [
                // A static Kotlin framework brings its code but not its links: the system
                // frameworks Compose (Skia on Metal) and the iOS side of Watch use.
                .linkedFramework("UIKit"),
                .linkedFramework("Foundation"),
                .linkedFramework("QuartzCore"),
                .linkedFramework("Metal"),
                .linkedFramework("CoreText"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("AVKit"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("MediaPlayer"),
                .linkedFramework("VideoToolbox"),
                .linkedFramework("Network"),
                .linkedFramework("Security"),
                .linkedLibrary("c++"),
            ]
        ),
    ],
    // The Xcode project builds these files as Swift 5 (SWIFT_VERSION 5.0); so does this.
    swiftLanguageModes: [.v5]
)
