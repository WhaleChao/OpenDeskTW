// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "OpenDeskTW",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "OpenDeskTW", targets: ["OpenDeskTW"])
    ],
    targets: [
        .executableTarget(
            name: "OpenDeskTW",
            path: "Sources/OpenDeskTW",
            swiftSettings: [
                .define("OPENDESK_STANDALONE")
            ]
        )
    ],
    swiftLanguageVersions: [.v5]
)
