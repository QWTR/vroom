import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const carPlayPlugin = require('./withCarPlay.js');

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
    expect(plugin).toContain('UISceneSession.Role.carTemplateApplication');
    expect(plugin).toContain('VroomCarPlayAppSceneDelegate');
    expect(plugin).toContain('VroomPhoneSceneDelegate');
    expect(plugin).toContain('configuration.delegateClass = VroomPhoneSceneDelegate.self');
    expect(plugin).toContain('configurationForConnecting connectingSceneSession');
    expect(plugin).toContain('withAppDelegate');
    expect(plugin).toContain(
      'configurations.CPTemplateApplicationSceneSessionRoleApplication = [',
    );
    expect(plugin).toContain(
      'configurations.UIWindowSceneSessionRoleApplication = [',
    );
    expect(plugin).toContain('manifest.UIApplicationSupportsMultipleScenes = true');
    expect(plugin).toContain('com.apple.developer.carplay-maps');
    expect(plugin).not.toContain(
      "cfg.modResults['com.apple.developer.carplay-navigation'] = true",
    );
    expect(plugin).toContain("'location'");
  });

  it('keeps UIKit resources lazy until CarPlay actually connects', () => {
    expect(coordinator).toContain(
      'private lazy var locationEngine: VroomCarPlayLocationEngine',
    );
    expect(coordinator).toContain(
      'private lazy var synthesizer: AVSpeechSynthesizer',
    );
    expect(coordinator).not.toContain(
      'private let locationEngine = VroomCarPlayLocationEngine()',
    );
  });

  it('injects CarPlay scene selection inside the Expo AppDelegate class', () => {
    const source = [
      'import Expo',
      '@UIApplicationMain',
      'public class AppDelegate: ExpoAppDelegate {',
      '  var window: UIWindow?',
      '}',
      'class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {}',
    ].join('\n');
    const result = carPlayPlugin.__internal.insertSwiftClassMember(
      source,
      'AppDelegate',
      carPlayPlugin.__internal.CARPLAY_APP_DELEGATE_METHOD,
      'configurationForConnecting connectingSceneSession',
    );
    const methodIndex = result.indexOf(
      'configurationForConnecting connectingSceneSession',
    );
    const appDelegateEnd = result.indexOf(
      '\n}\nclass ReactNativeDelegate',
    );
    expect(methodIndex).toBeGreaterThan(0);
    expect(methodIndex).toBeLessThan(appDelegateEnd);
  });

  it('reattaches the Expo window when the regular iPhone scene connects', () => {
    expect(plugin).toContain('let appDelegate = UIApplication.shared.delegate as? AppDelegate');
    expect(plugin).toContain('appWindow.windowScene = windowScene');
    expect(plugin).toContain('appWindow.makeKeyAndVisible()');
    expect(plugin).toContain('guard attempt < 20 else { return }');
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
