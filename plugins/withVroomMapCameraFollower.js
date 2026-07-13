const { createRunOncePlugin, withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const { createBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');
const { getHackyProjectName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj');
const fs = require('fs');
const path = require('path');

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
  const root = cfg.modRequest.projectRoot;
  // `withXcodeProject` also runs during a fresh prebuild, before AppDelegate
  // exists. Expo's fallback resolves the sanitized app name in that case.
  const projectName = resolveIosProjectName(cfg);
  // Keep iOS sources beside this plugin. EAS can omit arbitrary `native/`
  // folders from an uploaded workspace, while the loaded config plugin is
  // always part of the build context.
  const sourceDir = path.join(__dirname, 'map-camera-follower', 'ios');
  ['VroomMapCameraFollower.swift', 'VroomMapCameraFollowerBridge.m'].forEach((file) => {
    cfg.modResults = createBuildSourceFile({
      project: cfg.modResults,
      nativeProjectRoot: cfg.modRequest.platformProjectRoot,
      filePath: `${projectName}/${file}`,
      fileContents: fs.readFileSync(path.join(sourceDir, file), 'utf8'),
      overwrite: true,
    });
  });
  cfg.modResults.addBuildProperty('SWIFT_VERSION', '5.0');
  return cfg;
});

const withVroomMapCameraFollower = (config) => withIosFollower(withAndroidFollower(config));
const plugin = createRunOncePlugin(withVroomMapCameraFollower, 'with-vroom-map-camera-follower', '1.2.2');

plugin.__internal = { resolveIosProjectName };

module.exports = plugin;
