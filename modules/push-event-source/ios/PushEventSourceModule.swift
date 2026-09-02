import ExpoModulesCore

public final class PushEventSourceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PushEventSourceModule")
    Events("onProfileChanged", "onTokenChanged")

    Function("isFirebaseConfigured") {
      false
    }

    AsyncFunction("getToken") { () -> String? in
      nil
    }

    Function("consumePendingProfileChangeHint") { () -> [String: String]? in
      nil
    }
  }
}
