import SwiftUI

@MainActor
final class Notifications: ObservableObject {
    enum Kind { case progress, success, error, info }
    struct Notice: Identifiable {
        let id: UUID
        var kind: Kind
        var title: String
        var description: String
    }
    @Published private(set) var active: [Notice] = []
    @Published private(set) var history: [Notice] = []
    func publish(_ id: UUID, kind: Kind, title: String, description: String = "") {
        let notice = Notice(id: id, kind: kind, title: title, description: description)
        active.removeAll { $0.id == id }; active.append(notice)
        history.removeAll { $0.id == id }; history.insert(notice, at: 0)
        active = Array(active.suffix(2)); history = Array(history.prefix(30))
    }
    func dismiss(_ id: UUID) { active.removeAll { $0.id == id } }
}

struct NotificationOverlay: View {
    @ObservedObject var notices: Notifications
    var body: some View {
        VStack(spacing: 8) {
            ForEach(notices.active) { notice in
                HStack(alignment: .top, spacing: 10) {
                    if notice.kind == .progress { ProgressView().padding(.top, 3) }
                    else { Image(systemName: notice.kind == .error ? "exclamationmark.circle.fill" : "checkmark.circle.fill").foregroundStyle(notice.kind == .error ? Color.orange : Color.accentColor) }
                    VStack(alignment: .leading, spacing: 5) {
                        Text(notice.title).font(.subheadline.weight(.semibold))
                        if !notice.description.isEmpty { Text(notice.description).font(.caption).foregroundStyle(.secondary) }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    Button { notices.dismiss(notice.id) } label: { Image(systemName: "xmark").frame(width: 32, height: 32) }.buttonStyle(.plain).accessibilityLabel("关闭通知")
                }.padding(14).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(.quaternary)).accessibilityElement(children: .contain)
            }
        }.padding(.horizontal).padding(.top, 4)
    }
}
