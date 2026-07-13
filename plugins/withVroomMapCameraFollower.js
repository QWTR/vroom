const { createRunOncePlugin, withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const { createBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');
const { getProjectName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj');
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

const withIosFollower = (config) => withXcodeProject(config, (cfg) => {
  const root = cfg.modRequest.projectRoot;
  const projectName = getProjectName(cfg.modRequest.platformProjectRoot);
  const sourceDir = path.join(root, 'native', 'map-camera-follower', 'ios');
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
module.exports = createRunOncePlugin(withVroomMapCameraFollower, 'with-vroom-map-camera-follower', '1.0.0');
