import ExpoModulesCore
import Foundation

public final class VroomCarPlayModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VroomCarPlay")

    Events("stopRequested", "reportRequested", "navigationStarted")

    OnCreate { [weak self] in
      VroomCarPlayCoordinator.shared.emitEvent = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    OnDestroy {
      VroomCarPlayCoordinator.shared.emitEvent = nil
    }

    Function("updateSnapshot") { (json: String) in
      VroomCarPlayCoordinator.shared.updateSnapshot(json)
    }

    Function("setAuthToken") { (token: String) in
      VroomCarPlayCoordinator.shared.setAuthToken(token)
    }

    Function("setPerformanceProfile") { (profile: String) in
      VroomCarPlayCoordinator.shared.setPerformanceProfile(profile)
    }

    AsyncFunction("isConnected") {
      VroomCarPlayCoordinator.shared.isConnected
    }

    AsyncFunction("diagnostics") {
      VroomCarPlayCoordinator.shared.diagnostics()
    }
  }
}
