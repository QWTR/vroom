import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const plugin = require('./withVroomMapCameraFollower');
const { ANDROID_SOURCE_FILES, IOS_SOURCE_FILES, resolveIosProjectName } = plugin.__internal;

describe('Vroom iOS map camera follower plugin', () => {
  it('resolves a fresh prebuild from Expo config before AppDelegate exists', () => {
    expect(resolveIosProjectName({
      name: 'Vroom App',
      modRequest: { platformProjectRoot: 'C:/missing/ios' },
    })).toBe('VroomApp');
  });

  it('embeds its iOS sources so EAS needs no auxiliary folder', () => {
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('VroomMapCameraFollowerView');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('UIView, RNMBXMapAndMapViewComponent');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('tripDriveMarkerNativeFallback');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('bottomOcclusion');
    expect(IOS_SOURCE_FILES['VroomNativeMotionPredictor.swift']).toContain('sourceTimestampMs');
    expect(IOS_SOURCE_FILES['VroomNativeMotionPredictor.swift']).toContain('coastHorizon');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).not.toContain('override func addToMap');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).not.toContain('override func removeFromMap');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollowerBridge.m']).toContain('RCT_EXTERN_MODULE');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollowerBridge.m']).toContain('navigationSample');
  });

  it('keeps embedded iOS sources identical to the canonical Swift files', () => {
    for (const file of ['VroomMapCameraFollower.swift', 'VroomNativeMotionPredictor.swift', 'VroomMapCameraFollowerBridge.m']) {
      expect(IOS_SOURCE_FILES[file]).toBe(readFileSync(resolve('native/map-camera-follower/ios', file), 'utf8'));
    }
  });

  it('embeds Android sources and retains the package placeholder for prebuild', () => {
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollower.kt']).toContain('__PACKAGE__');
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollowerManager.kt']).toContain('VroomMapCameraFollowerManager');
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollowerPackage.kt']).toContain('ReactPackage');
  });
});
