import Foundation
import Security

final class VroomCarPlayTokenStore {
  static let shared = VroomCarPlayTokenStore()

  private let service = "com.lexuuw.vroom.app.carplay"
  private let account = "automotive-auth-token"

  private init() {}

  func save(_ token: String) {
    guard !token.isEmpty, let data = token.data(using: .utf8) else {
      return
    }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
    var insert = query
    insert[kSecValueData as String] = data
    insert[kSecAttrAccessible as String] =
      kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(insert as CFDictionary, nil)
  }

  func read() -> String {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data,
      let token = String(data: data, encoding: .utf8)
    else {
      return ""
    }
    return token
  }
}
