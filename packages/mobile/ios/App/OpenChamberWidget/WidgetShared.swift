import SwiftUI
import WidgetKit

// MARK: - Shared model + App Group reader

/// One row of the session overview the app writes to the shared App Group.
/// Mirrors MobileWidgetSession in packages/ui/src/apps/mobileWidgetSnapshot.ts.
struct WidgetSession: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let unread: Bool
    /// Project label for the session's directory. Optional so snapshots written before this
    /// field existed still decode.
    var project: String?
}

/// The session overview snapshot. Mirrors MobileWidgetSnapshot (same field names) so the
/// JSON the app stores decodes directly.
struct WidgetSnapshot: Codable {
    var runtimeKey: String?
    let attentionCount: Int
    let recentSessions: [WidgetSession]

    static let empty = WidgetSnapshot(runtimeKey: nil, attentionCount: 0, recentSessions: [])
}

enum WidgetStore {
    static let appGroup = "group.com.openchamber.app"
    static let snapshotKey = "widgetSnapshot"

    /// Reads the latest snapshot the app persisted. Returns `.empty` when nothing has been
    /// written yet (fresh install / app never foregrounded) so widgets render a clean state.
    static func load() -> WidgetSnapshot {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let json = defaults.string(forKey: snapshotKey),
              let data = json.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else {
            return .empty
        }
        return snapshot
    }
}

// MARK: - Deep links (mirror packages/ui/src/apps/deepLinks.ts)

enum WidgetDeepLink {
    static func newSession() -> URL { URL(string: "openchamber://new")! }
    static func attention() -> URL { URL(string: "openchamber://sessions?filter=attention")! }
    static func status() -> URL { URL(string: "openchamber://status")! }
    static func settings() -> URL { URL(string: "openchamber://settings")! }
    static func changes() -> URL { URL(string: "openchamber://changes")! }
    static func files() -> URL { URL(string: "openchamber://view/files")! }
    static func instances() -> URL { URL(string: "openchamber://view/instances")! }
    static func session(_ id: String) -> URL {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return URL(string: "openchamber://session/\(encoded)") ?? newSession()
    }
}

// MARK: - Timeline provider

struct OverviewEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct OverviewProvider: TimelineProvider {
    func placeholder(in context: Context) -> OverviewEntry {
        OverviewEntry(date: Date(), snapshot: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (OverviewEntry) -> Void) {
        completion(OverviewEntry(date: Date(), snapshot: WidgetStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OverviewEntry>) -> Void) {
        // The app/NSE reload timelines (WidgetCenter) when the snapshot changes, but with several
        // widgets sharing the app's WidgetKit reload budget iOS can refresh them unevenly and
        // leave one stale. Ask for a periodic refresh too so every widget independently re-reads
        // the shared snapshot and converges to the latest state (budget permitting).
        let entry = OverviewEntry(date: Date(), snapshot: WidgetStore.load())
        let nextRefresh = Date().addingTimeInterval(10 * 60)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

// MARK: - OpenLoop logo

private struct OpenLoopShape: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 32
        let offsetX = rect.midX - 16 * scale
        let offsetY = rect.midY - 16 * scale
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: offsetX + x * scale, y: offsetY + y * scale)
        }

        var path = Path()
        path.move(to: p(18.8, 3.5))
        path.addCurve(to: p(3.2, 16.2), control1: p(10.4, 1.5), control2: p(3.2, 7.2))
        path.addCurve(to: p(18, 29.4), control1: p(3.2, 24.7), control2: p(9.9, 30.4))
        path.addCurve(to: p(29.2, 14.7), control1: p(25.5, 28.5), control2: p(30.1, 22.4))
        path.addCurve(to: p(27, 7), control1: p(28.8, 11.6), control2: p(27.4, 8.5))
        path.addCurve(to: p(25.3, 10.3), control1: p(25.9, 7.4), control2: p(24.8, 8.5))
        path.addCurve(to: p(18, 24.6), control1: p(27.4, 17.4), control2: p(24.3, 23.5))
        path.addCurve(to: p(7.7, 15.9), control1: p(11.6, 25.7), control2: p(7.5, 21.4))
        path.addCurve(to: p(17.8, 7.4), control1: p(8, 10.5), control2: p(12.4, 6.8))
        path.addCurve(to: p(21.7, 5.8), control1: p(20.1, 7.7), control2: p(21.4, 7))
        path.addCurve(to: p(18.8, 3.5), control1: p(21.9, 4.7), control2: p(20.8, 3.8))
        path.closeSubpath()
        return path
    }
}

/// The historical type name is retained because it is shared by existing widget layouts.
struct CubeLogoView: View {
    var body: some View {
        OpenLoopShape()
            .fill(.primary.opacity(0.2))
            .overlay(OpenLoopShape().stroke(.primary, lineWidth: 1.5))
    }
}
