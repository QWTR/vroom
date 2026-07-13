import { describe, expect, it } from 'vitest';

const plugin = require('./withWiroomBackgroundDrive');
const { SWIFT_MODULE, OBJC_BRIDGE, resolveIosProjectName } = plugin.__internal;

describe('Wiroom native iOS drive contract', () => {
  it('keeps the native checkpoint ledger and secure token storage', () => {
    expect(SWIFT_MODULE).toContain('private let checkpointKm = 0.2');
    expect(SWIFT_MODULE).toContain('private let checkpointForceMinKm = 0.05');
    expect(SWIFT_MODULE).toContain('private let checkpointForceMs = 30_000.0');
    expect(SWIFT_MODULE).toContain('postNativeCheckpoint');
    expect(SWIFT_MODULE).toContain('SecItemUpdate');
    expect(SWIFT_MODULE).toContain('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly');
    expect(SWIFT_MODULE).toContain('/api/activity/session/checkpoint');
    expect(SWIFT_MODULE).toContain('mode == "navigation" ? "navigation" : "driving"');
  });

  it('exposes the stats and authenticated-start bridge to React Native', () => {
    expect(OBJC_BRIDGE).toContain('tripSessionId:(NSString *)tripSessionId');
    expect(OBJC_BRIDGE).toContain('apiUrl:(NSString *)apiUrl');
    expect(OBJC_BRIDGE).toContain('authToken:(NSString *)authToken');
    expect(OBJC_BRIDGE).toContain('getNativeStats');
    expect(OBJC_BRIDGE).toContain('consumeNativeStats');
  });

  it('keeps an offline checkpoint retryable until the final activity is saved', () => {
    expect(SWIFT_MODULE).toContain('maybeFlushNativeCheckpoint(stats: stats, force: false)');
    expect(SWIFT_MODULE).toContain('defaults.removeObject(forKey: apiUrlKey)');
    expect(SWIFT_MODULE).toContain('clearAuthToken()');
    expect(SWIFT_MODULE).not.toContain('persistState(active: false, endedBy: reason, lastFix: currentState()["lastFix"] as? [String: Any])\n    clearAuthToken()');
  });

  it('resolves a fresh prebuild from Expo config before AppDelegate exists', () => {
    expect(resolveIosProjectName({
      name: 'Vroom App',
      modRequest: { platformProjectRoot: 'C:/missing/ios' },
    })).toBe('VroomApp');
  });
});
