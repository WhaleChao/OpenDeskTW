import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    fputs("usage: make_icon.swift <output.png>\n", stderr)
    exit(2)
}

let canvas = NSSize(width: 1024, height: 1024)
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: 1024,
    pixelsHigh: 1024,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
), let drawingContext = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fputs("failed to create icon canvas\n", stderr)
    exit(1)
}
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = drawingContext
defer { NSGraphicsContext.restoreGraphicsState() }

let bounds = NSRect(origin: .zero, size: canvas)
let background = NSBezierPath(roundedRect: bounds.insetBy(dx: 44, dy: 44), xRadius: 210, yRadius: 210)
NSGradient(colors: [
    NSColor(calibratedRed: 0.02, green: 0.64, blue: 0.60, alpha: 1),
    NSColor(calibratedRed: 0.08, green: 0.34, blue: 0.86, alpha: 1)
])!.draw(in: background, angle: -45)

NSGraphicsContext.current?.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.22)
shadow.shadowBlurRadius = 32
shadow.shadowOffset = NSSize(width: 0, height: -18)
shadow.set()

let backPage = NSBezierPath(roundedRect: NSRect(x: 265, y: 230, width: 510, height: 590), xRadius: 62, yRadius: 62)
NSColor.white.withAlphaComponent(0.48).setFill()
backPage.fill()
NSGraphicsContext.current?.restoreGraphicsState()

let page = NSBezierPath(roundedRect: NSRect(x: 205, y: 170, width: 520, height: 620), xRadius: 66, yRadius: 66)
NSColor.white.setFill()
page.fill()

let teal = NSColor(calibratedRed: 0.02, green: 0.55, blue: 0.56, alpha: 1)
teal.setFill()
NSBezierPath(roundedRect: NSRect(x: 282, y: 614, width: 320, height: 55), xRadius: 27, yRadius: 27).fill()

NSColor(calibratedWhite: 0.77, alpha: 1).setFill()
for y in [538.0, 478.0, 418.0] {
    NSBezierPath(roundedRect: NSRect(x: 282, y: y, width: 360, height: 24), xRadius: 12, yRadius: 12).fill()
}

let gridOrigin = NSPoint(x: 282, y: 250)
let cellWidth: CGFloat = 90
let cellHeight: CGFloat = 54
for row in 0..<2 {
    for column in 0..<4 {
        let cell = NSRect(
            x: gridOrigin.x + CGFloat(column) * cellWidth,
            y: gridOrigin.y + CGFloat(row) * cellHeight,
            width: cellWidth - 6,
            height: cellHeight - 6
        )
        (row == 1 ? teal.withAlphaComponent(0.82) : NSColor(calibratedWhite: 0.89, alpha: 1)).setFill()
        NSBezierPath(roundedRect: cell, xRadius: 8, yRadius: 8).fill()
    }
}

let badge = NSBezierPath(roundedRect: NSRect(x: 606, y: 115, width: 280, height: 220), xRadius: 74, yRadius: 74)
NSColor(calibratedRed: 0.04, green: 0.16, blue: 0.34, alpha: 0.96).setFill()
badge.fill()

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 104, weight: .heavy),
    .foregroundColor: NSColor.white,
    .paragraphStyle: paragraph
]
NSAttributedString(string: "TW", attributes: attributes).draw(in: NSRect(x: 606, y: 157, width: 280, height: 130))

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("failed to render icon\n", stderr)
    exit(1)
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
