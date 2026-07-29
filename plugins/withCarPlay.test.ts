import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('native VROOM CarPlay plugin', () => {
  const plugin = readFileSync(resolve('plugins/withCarPlay.js'), 'utf8');
  const podspec = readFileSync(
    resolve('modules/vroom-carplay/ios/VroomCarPlay.podspec'),
    'utf8',
  );
  const coordinator = readFileSync(
    resolve('modules/vroom-carplay/ios/VroomCarPlayCoordinator.swift'),
    'utf8',
  );

  it('registers the navigation scene and current Apple maps entitlement', () => {
    expect(plugin).toContain('CPTemplateApplicationSceneSessionRoleApplication');
    expect(plugin).toContain('VroomCarPlayAppSceneDelegate');
    expect(plugin).toContain('com.apple.developer.carplay-maps');
    expect(plugin).not.toContain(
      "cfg.modResults['com.apple.developer.carplay-navigation'] = true",
    );
    expect(plugin).toContain("'location'");
  });

  it('pins the native map and Live dependencies required by CarPlay', () => {
    expect(podspec).toContain("'MapboxMaps', '~> 11.18.2'");
    expect(podspec).toContain("'Socket.IO-Client-Swift', '~> 16.1.1'");
    expect(podspec).toContain("'ExpoModulesCore'");
  });

  it('uses Apple templates for map, navigation, search and menu', () => {
    expect(coordinator).toContain('CPMapTemplate()');
    expect(coordinator).toContain('startNavigationSession');
    expect(coordinator).toContain('CPSearchTemplate()');
    expect(coordinator).toContain('CPListTemplate(');
    expect(coordinator).toContain('CPTravelEstimates(');
  });

  it('keeps auth in Keychain and filters production diagnostics', () => {
    const tokenStore = readFileSync(
      resolve('modules/vroom-carplay/ios/VroomCarPlayTokenStore.swift'),
      'utf8',
    );
    const stateStore = readFileSync(
      resolve('modules/vroom-carplay/ios/VroomCarPlayStateStore.swift'),
      'utf8',
    );
    expect(tokenStore).toContain('SecItemAdd');
    expect(tokenStore).not.toContain('UserDefaults');
    expect(stateStore).toContain('rejectedStaleSnapshots');
    expect(stateStore).not.toContain('latitude');
    expect(stateStore).not.toContain('longitude');
  });
});
