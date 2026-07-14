const { createRunOncePlugin, withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const { createBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');
const { getHackyProjectName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const decodeIosSource = (compressedBase64) =>
  zlib.gunzipSync(Buffer.from(compressedBase64, 'base64')).toString('utf8');

// These stay in the plugin file deliberately. EAS does not reliably upload
// auxiliary native source folders, but it must upload the config plugin it
// executes. This makes the iOS prebuild self-contained.
const IOS_SOURCE_FILES = {
  'VroomMapCameraFollower.swift': decodeIosSource('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'),
  'VroomMapCameraFollowerBridge.m': decodeIosSource('H4sIAAAAAAAACpXOTWrDMBCG4b1PYegmAdNeoIQQ14GC/1BVtV2ZsTWxh0oaoSgEevpSssomVfbP9848kPUcYv4sEKb4JEqpCM8NOJgxPC6bLNuSixgOMGEuSjlUn7IS7dB0L+91tVKB2TbgS7AYYM/G8BlDkV931tll2XdCDuq1+hh60fWVkF8rdDAa1EW+67r6hvN8pEjsFBjSRd6+tSc73ixbCN8YFB1pNPhv30CkeNKYlDbs5nS9IGhyc5L9YbZJ0FOcljQJ+u+8ZH8P33GMqa9cFjUe4j1e0LxcDbbodPYLngU4IZACAAA='),
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
  const sourceDir = path.join(root, 'native', 'map-camera-follower', 'android');
  const outputDir = path.join(root, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'mapcamera');
  const applicationPath = path.join(root, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'MainApplication.kt');
  fs.mkdirSync(outputDir, { recursive: true });
  ['VroomMapCameraFollower.kt', 'VroomMapCameraFollowerManager.kt', 'VroomMapCameraFollowerPackage.kt'].forEach((file) => {
    fs.writeFileSync(path.join(outputDir, file), fs.readFileSync(path.join(sourceDir, file), 'utf8').replace(/__PACKAGE__/g, packageName));
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
const plugin = createRunOncePlugin(withVroomMapCameraFollower, 'with-vroom-map-camera-follower', '1.2.4');

plugin.__internal = { resolveIosProjectName, IOS_SOURCE_FILES };

module.exports = plugin;
