import Foundation

public final class VroomCarPlayStateStore {
  public static let shared = VroomCarPlayStateStore()

  private let queue = DispatchQueue(label: "app.vroom.carplay.state")
  private let defaults = UserDefaults.standard
  private let snapshotKey = "vroom_carplay_snapshot_v2"
  private var currentSnapshot: VroomCarPlaySnapshot?
  private var currentRawSnapshot = ""
  private var latestRevision: Int64 = 0
  private var explicitCarPlayActionAt: Int64 = 0
  private var rejectedStaleSnapshots: Int64 = 0

  private init() {
    let raw = defaults.string(forKey: snapshotKey) ?? ""
    if let snapshot = VroomCarPlaySnapshot(jsonString: raw) {
      currentSnapshot = snapshot
      currentRawSnapshot = raw
      latestRevision = snapshot.revision
    }
  }

  @discardableResult
  public func ingest(json: String) -> VroomCarPlaySnapshot? {
    guard let snapshot = VroomCarPlaySnapshot(jsonString: json) else {
      return nil
    }
    return queue.sync {
      if snapshot.revision < latestRevision {
        rejectedStaleSnapshots += 1
        return currentSnapshot
      }
      if snapshot.source == "phone",
        snapshot.sentAtMilliseconds < explicitCarPlayActionAt
      {
        rejectedStaleSnapshots += 1
        return currentSnapshot
      }
      currentSnapshot = snapshot
      currentRawSnapshot = json
      latestRevision = snapshot.revision
      defaults.set(json, forKey: snapshotKey)
      return snapshot
    }
  }

  public func markExplicitCarPlayAction() {
    queue.sync {
      self.explicitCarPlayActionAt = Int64(
        Date().timeIntervalSince1970 * 1000
      )
    }
  }

  public func discardPersistedSnapshot() {
    queue.sync {
      currentSnapshot = nil
      currentRawSnapshot = ""
      defaults.removeObject(forKey: snapshotKey)
    }
  }

  public func snapshot() -> VroomCarPlaySnapshot? {
    queue.sync { currentSnapshot }
  }

  public func rawSnapshot() -> String {
    queue.sync { currentRawSnapshot }
  }

  public func diagnostics() -> [String: Any] {
    queue.sync {
      [
        "latestRevision": latestRevision,
        "rejectedStaleSnapshots": rejectedStaleSnapshots,
        "hasSnapshot": currentSnapshot != nil,
        "schemaVersion": currentSnapshot?.schemaVersion ?? 0,
      ]
    }
  }
}
