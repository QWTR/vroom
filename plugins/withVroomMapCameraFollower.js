const { createRunOncePlugin, withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const { createBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');
const { getHackyProjectName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const decodeEmbeddedSource = (compressedBase64) =>
  zlib.gunzipSync(Buffer.from(compressedBase64, 'base64')).toString('utf8');

// These stay in the plugin file deliberately. EAS does not reliably upload
// auxiliary native source folders, but it must upload the config plugin it
// executes. This makes the iOS prebuild self-contained.
const IOS_SOURCE_FILES = {
  'VroomMapCameraFollower.swift': decodeEmbeddedSource('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'),
  'VroomMapCameraFollowerBridge.m': decodeEmbeddedSource('H4sIAAAAAAAACpXOTWrDMBCG4b1PYegmAdNeoIQQ14GC/1BVtV2ZsTWxh0oaoSgEevpSssomVfbP9848kPUcYv4sEKb4JEqpCM8NOJgxPC6bLNuSixgOMGEuSjlUn7IS7dB0L+91tVKB2TbgS7AYYM/G8BlDkV931tll2XdCDuq1+hh60fWVkF8rdDAa1EW+67r6hvN8pEjsFBjSRd6+tSc73ixbCN8YFB1pNPhv30CkeNKYlDbs5nS9IGhyc5L9YbZJ0FOcljQJ+u+8ZH8P33GMqa9cFjUe4j1e0LxcDbbodPYLngU4IZACAAA='),
};

const ANDROID_SOURCE_FILES = {
  'VroomMapCameraFollower.kt': decodeEmbeddedSource('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'),
  'VroomMapCameraFollowerManager.kt': decodeEmbeddedSource('H4sIAAAAAAAACqWRwW7aQBCG736KEScsRVbPKFRNaNqghgqlEYdc0GAPZsXujrUeQ9Wq714ZA16BY5A5ejT//307zjBeY0own08fRj8evj/N55HBLEZDDoNAmYydQMwmWmJMC+Z15AhjiQpl0GJKLvqlTKZppmg7qSZXpd5WZCh5LacjtkK/5aoYWsuCotjm0S48dZwFQawxz2HmmM0Es9HO/htrzVtyeysYwJnpfXPicz+EvwEAb8g5lRAsCwspyU801A9hCL3mXO80EztC2QHHNhe0MfXj6rEDOD9A2dxcfEiFQQDw5fjuvkVDpQ5ZXGhKeneQ0BILLY/MmtDCEJaocwoD2PnkJE/Van+jaDv4AHcHG9QFDWBfU4qV+1FOctg59pSbH3llnKvyX81QK89ubAWG8MmzmvqL17mNrfheJw1tVgbdmtxM5Wqhqelm4gr/ZBN/v/PhTlraBDWKkiKhXnhQeNlPrqN/5WKhyYfX+YrbjGWbnnIPo87guqCFvCJMlE1r7nM16Eo9xluYf5hNDXxnNl1pVbYFlSmJVzVrWn52he3DbTRMyse/ceYhj7POXK/hMvyRRfzzTv3xjQqHkssWL7SUM4dyeKNBVXGZ/6rS1bnAbnqjwb6jUvgX/AfqoiloxgcAAA='),
  'VroomMapCameraFollowerPackage.kt': decodeEmbeddedSource('H4sIAAAAAAAACpWQwWrDMAyG734KHZNS/AClK4Sw9bClLTv0GlRHCaZ2ZGyn3Rh795E0B8O2sl2EQPr0/78cqjN2BHV9KMrnYvtY19KiU2jJoxDaOvYRFFvZoqIT81l6QhXl61gPN/rO2snrpiO5w6gvVHEzmD9sT7cL54xWGDX3JfeR3uIdcNAWe+zIy6Oma3XrhVAGQ4CjZ7YVunIK9cTG8JX87B1WkEaBDwHAF/JeNwTt0IPyhJHSACGbRGdXM//dbr6CFx3iOkU38ABkXXwfJ1kufhZLMvxTKyHXiyUsNqOg0SHu20wAwC+/mJEsXwqAXHyKL+9MJcoXAgAA='),
};

IOS_SOURCE_FILES['VroomMapCameraFollower.swift'] = IOS_SOURCE_FILES['VroomMapCameraFollower.swift']
  .replace(
    'final class VroomMapCameraFollowerView: RNMBXMapAndMapViewComponentBase {',
    'final class VroomMapCameraFollowerView: UIView, RNMBXMapAndMapViewComponent {'
  )
  .replace(
    `  override func addToMap(_ map: RNMBXMapView, mapView: MapView, style: Style) -> Bool {
    let added = super.addToMap(map, mapView: mapView, style: style)
    nativeMapView = mapView
    dirty = true
    updateDisplayLink()
    return added
  }`,
    `  public func addToMap(_ map: RNMBXMapView, mapView: MapView, style: Style) {
    nativeMapView = mapView
    dirty = true
    updateDisplayLink()
  }`
  )
  .replace(
    `  override func removeFromMap(_ map: RNMBXMapView, mapView: MapView, reason: RemovalReason) -> Bool {
    displayLink?.invalidate()
    displayLink = nil
    nativeMapView = nil
    return super.removeFromMap(map, mapView: mapView, reason: reason)
  }`,
    `  public func removeFromMap(_ map: RNMBXMapView, mapView: MapView, reason: RemovalReason) -> Bool {
    displayLink?.invalidate()
    displayLink = nil
    nativeMapView = nil
    return true
  }`
  );

const withAndroidFollower = (config) => withDangerousMod(config, ['android', async (cfg) => {
  const root = cfg.modRequest.projectRoot;
  const packageName = cfg.android?.package || 'com.lexuuw.vroom.app';
  const outputDir = path.join(root, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'mapcamera');
  const applicationPath = path.join(root, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'MainApplication.kt');
  fs.mkdirSync(outputDir, { recursive: true });
  Object.entries(ANDROID_SOURCE_FILES).forEach(([file, fileContents]) => {
    fs.writeFileSync(path.join(outputDir, file), fileContents.replace(/__PACKAGE__/g, packageName));
  });
  if (fs.existsSync(applicationPath)) {
    let application = fs.readFileSync(applicationPath, 'utf8');
    const importLine = `import ${packageName}.mapcamera.VroomMapCameraFollowerPackage`;
    if (!application.includes(importLine)) {
      application = application.replace('import expo.modules.ReactNativeHostWrapper', `import expo.modules.ReactNativeHostWrapper\n\n${importLine}`);
    }
    if (!application.includes('add(VroomMapCameraFollowerPackage())')) {
      application = application.replace('// add(MyReactNativePackage())', '// add(MyReactNativePackage())\n              add(VroomMapCameraFollowerPackage())');
    }
    fs.writeFileSync(applicationPath, application);
  }
  return cfg;
}]);

const resolveIosProjectName = (cfg) =>
  getHackyProjectName(cfg.modRequest.platformProjectRoot, cfg);

const withIosFollower = (config) => withXcodeProject(config, (cfg) => {
  // `withXcodeProject` also runs during a fresh prebuild, before AppDelegate
  // exists. Expo's fallback resolves the sanitized app name in that case.
  const projectName = resolveIosProjectName(cfg);
  Object.entries(IOS_SOURCE_FILES).forEach(([file, fileContents]) => {
    cfg.modResults = createBuildSourceFile({
      project: cfg.modResults,
      nativeProjectRoot: cfg.modRequest.platformProjectRoot,
      filePath: `${projectName}/${file}`,
      fileContents,
      overwrite: true,
    });
  });
  cfg.modResults.addBuildProperty('SWIFT_VERSION', '5.0');
  return cfg;
});

const withVroomMapCameraFollower = (config) => withIosFollower(withAndroidFollower(config));
const plugin = createRunOncePlugin(withVroomMapCameraFollower, 'with-vroom-map-camera-follower', '1.2.5');

plugin.__internal = { resolveIosProjectName, IOS_SOURCE_FILES, ANDROID_SOURCE_FILES };

module.exports = plugin;
