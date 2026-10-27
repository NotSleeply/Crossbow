import SwiftUI
import UIKit

/// B / Frame Studio. Semantic roles adapt to the system appearance on iPhone and iPad.
enum Studio {
    static let chrome = color(0xEEF0F5, 0x121317)
    static let background = color(0xFFFFFF, 0x121317)
    static let surface = color(0xF7F8FB, 0x23262D)
    static let raised = color(0xF0F2F7, 0x30343D)
    static let floating = color(0xFFFFFF, 0x2A2E36)
    static let ink = color(0x242B37, 0xE9EBF1)
    static let secondary = color(0x596777, 0xADB2BE)
    static let line = color(0xE4E7EE, 0x343840)
    static let accent = color(0x455AB5, 0xB7B4ED)
    static let success = color(0x267659, 0x8ACDAF)
    static let error = color(0xA94850, 0xF4A5AD)
    static let primary = color(0x293345, 0xE7EAF2)
    static let onPrimary = color(0xFFFFFF, 0x20232B)

    private static func color(_ light: UInt, _ dark: UInt) -> Color {
        Color(uiColor: UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255, alpha: 1)
        })
    }
}

struct StudioPage<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) { content }
                .frame(maxWidth: 600, alignment: .leading)
                .padding(.horizontal, 24).padding(.vertical, 16)
                .frame(maxWidth: .infinity)
        }
        .background(Studio.background.ignoresSafeArea())
        .foregroundStyle(Studio.ink)
    }
}

struct StudioCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(.horizontal, 16)
            .background(Studio.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Studio.line, lineWidth: 1))
    }
}

struct StudioRow: View {
    let title: String
    var value: String = ""
    var symbol: String? = nil
    var subtitle: String? = nil
    var chevron = false
    var body: some View {
        HStack(spacing: 12) {
            if let symbol { Image(systemName: symbol).font(.system(size: 21)).foregroundStyle(Studio.secondary).frame(width: 24) }
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(Studio.ink)
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(Studio.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if !value.isEmpty { Text(value).font(.subheadline).foregroundStyle(Studio.secondary).multilineTextAlignment(.trailing) }
            if chevron { Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Studio.secondary) }
        }.padding(.vertical, 16).frame(minHeight: 56)
    }
}

struct StudioSectionTitle: View {
    let text: String
    var body: some View { Text(text).font(.caption).foregroundStyle(Studio.secondary) }
}
