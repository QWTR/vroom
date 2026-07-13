import { describe, expect, it } from 'vitest';

const plugin = require('./withWiroomBackgroundDrive');
const { SWIFT_MODULE, OBJC_BRIDGE } = plugin.__internal;

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
});
