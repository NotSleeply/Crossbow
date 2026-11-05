// Exercise the same AppKit ICNS -> NSApplication icon path, without a visible app.
import AppKit
let path = CommandLine.arguments[1]
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let data = try Data(contentsOf: URL(fileURLWithPath: path))
guard let image = NSImage(data: data) else { fatalError("Invalid ICNS") }
app.applicationIconImage = image
for n in [64, 96, 128] {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let bitmap = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8,
            bytesPerRow: n * 4, space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let raw = bitmap.data else { fatalError("Bitmap allocation failed") }
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(cgContext: bitmap, flipped: false)
    NSGraphicsContext.current = context
    app.applicationIconImage.draw(in: NSRect(x: 0, y: 0, width: n, height: n),
        from: .zero, operation: .copy, fraction: 1)
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    let pixels = raw.assumingMemoryBound(to: UInt8.self)
    var left = n, right = -1, top = n, bottom = -1, ink = 0
    for y in 0..<n { for x in 0..<n {
        let offset = (y * n + x) * 4
        if pixels[offset + 3] >= 128 {
            left = min(left, x); right = max(right, x)
            top = min(top, y); bottom = max(bottom, y)
        }
        if pixels[offset] == 41 && pixels[offset + 1] == 51 && pixels[offset + 2] == 69 && pixels[offset + 3] == 255 { ink += 1 }
    }}
    precondition(ink > 0, "Native path changed #293345")
    precondition(abs(Double(right - left + 1) / Double(n) - 0.812) < 2.0 / Double(n), "Dock safe area changed")
    precondition(abs(left - (n - 1 - right)) <= 1 && abs(top - (n - 1 - bottom)) <= 1, "Dock icon not centred")
    print("PASS native AppKit \(n)px: #293345 pixels=\(ink), tile=\(right-left+1)px, centred")
}
