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
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('paddingTop');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('paddingBottom');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).not.toContain('tripDriveMarkerNativeFallback');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).not.toContain('anchor =');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('@objc var latitude');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('@objc var longitude');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('@objc var heading');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('@objc var markerHeading');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('@objc var cameraMode');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('"worldHeading"');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain('"screenHeading"');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain(
      'mapboxMap.updateGeoJSONSource',
    );
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).toContain(
      'guard let mapboxMap = mapView.mapboxMap',
    );
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).not.toContain(
      'mapboxMap.style',
    );
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).not.toContain('predictor.ingest');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).not.toContain('override func addToMap');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollower.swift']).not.toContain('override func removeFromMap');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollowerBridge.m']).toContain('RCT_EXTERN_MODULE');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollowerBridge.m']).not.toContain('navigationSample');
    expect(IOS_SOURCE_FILES['VroomMapCameraFollowerBridge.m']).toContain('latitude');
  });

  it('keeps embedded iOS sources identical to the canonical Swift files', () => {
    for (const file of ['VroomMapCameraFollower.swift', 'VroomMapCameraFollowerBridge.m']) {
      const normalize = (value: string) => value.replace(/\r\n/g, '\n');
      expect(normalize(IOS_SOURCE_FILES[file])).toBe(normalize(readFileSync(resolve('native/map-camera-follower/ios', file), 'utf8')));
    }
  });

  it('does not install the retired parallel Swift predictor', () => {
    expect(IOS_SOURCE_FILES['VroomNativeMotionPredictor.swift']).toBeUndefined();
  });

  it('embeds Android sources and retains the package placeholder for prebuild', () => {
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollower.kt']).toContain('__PACKAGE__');
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollower.kt']).toContain('displayMetrics.density');
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollower.kt']).toContain('mapCameraArrowPixelSize');
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollower.kt']).toContain('worldHeading');
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollower.kt']).toContain('screenHeading');
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollowerManager.kt']).toContain('VroomMapCameraFollowerManager');
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollowerManager.kt']).toContain('@ReactProp(name = "cameraMode")');
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollowerManager.kt']).toContain('@ReactProp(name = "markerHeading")');
    expect(ANDROID_SOURCE_FILES['VroomMapCameraFollowerPackage.kt']).toContain('ReactPackage');
  });

  it('keeps canonical and generated Android follower sources identical', () => {
    const base = resolve('android/app/src/main/java/com/lexuuw/vroom/app/mapcamera');
    for (const file of [
      'VroomMapCameraFollower.kt',
      'VroomMapCameraFollowerManager.kt',
      'VroomMapCameraFollowerPackage.kt',
    ]) {
      const canonical = ANDROID_SOURCE_FILES[file]
        .replace(/__PACKAGE__/g, 'com.lexuuw.vroom.app')
        .replace(/\r\n/g, '\n');
      const generated = readFileSync(resolve(base, file), 'utf8').replace(/\r\n/g, '\n');
      expect(canonical).toBe(generated);
    }
  });
});
