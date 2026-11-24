import AppKit
let output = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        let transform = NSAffineTransform(); transform.scale(by: CGFloat(pixels) / 1024); transform.concat()
        NSColor(calibratedRed: 0.13, green: 0.28, blue: 0.23, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 66, y: 66, width: 892, height: 892), xRadius: 202, yRadius: 202).fill()
        NSColor(calibratedRed: 0.91, green: 0.97, blue: 0.93, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 246, y: 270, width: 532, height: 440), xRadius: 100, yRadius: 100).fill()
        NSColor(calibratedRed: 0.13, green: 0.28, blue: 0.23, alpha: 1).setFill()
        for x in [376, 580] { NSBezierPath(roundedRect: NSRect(x: x, y: 455, width: 68, height: 106), xRadius: 30, yRadius: 30).fill() }
        NSColor(calibratedRed: 0.91, green: 0.97, blue: 0.93, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 488, y: 690, width: 48, height: 98), xRadius: 24, yRadius: 24).fill()
        NSBezierPath(ovalIn: NSRect(x: 466, y: 760, width: 92, height: 92)).fill()
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output + "/icon_\(size)x\(size)\(suffix).png"))
    }
}
