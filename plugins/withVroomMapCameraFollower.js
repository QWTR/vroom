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
  'VroomMapCameraFollowerBridge.m': decodeEmbeddedSource('H4sIAAAAAAAACpWSzWrDMBAG7wa/g6GXFEL7AqWEOA4U/Iequu3JrK2NvVTSGlkm0KcvIadcUvk+M/sd9oHMxM4nLwKh988ilQ3huQALA7qn8TWO4mhH1qM7QY+JSGWbfclMlG1RHT7ybNM4ZlPAlIJBB0fWms/otslt6TGOrmpdCdk2b9lnW4uqzoT83qCFTqPaJvuqyu+BE8/kiW0DmtQ2Kd/LxXT32wbcD7qGZuo0/n9Bgye/KAyLa7bDCnxEUGSHMPiX2YSRE/l+DERBXRZInlbxe/Y+eM1VyfHkVwmChjHQmHEwaP1hcXD5hmK+0XZoVRz9Aa1riYXXAgAA'),
};

const ANDROID_SOURCE_FILES = {
  'VroomMapCameraFollower.kt': decodeEmbeddedSource('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'),
  'VroomMapCameraFollowerManager.kt': decodeEmbeddedSource('H4sIAAAAAAAACqWRwW7aQBCG736KEScsRVbPKFRNaNqghgqlEYdc0GAPZsXujrUeQ9Wq714ZA16BY5A5ejT//307zjBeY0own08fRj8evj/N55HBLEZDDoNAmYydQMwmWmJMC+Z15AhjiQpl0GJKLvqlTKZppmg7qSZXpd5WZCh5LacjtkK/5aoYWsuCotjm0S48dZwFQawxz2HmmM0Es9HO/htrzVtyeysYwJnpfXPicz+EvwEAb8g5lRAsCwspyU801A9hCL3mXO80EztC2QHHNhe0MfXj6rEDOD9A2dxcfEiFQQDw5fjuvkVDpQ5ZXGhKeneQ0BILLY/MmtDCEJaocwoD2PnkJE/Van+jaDv4AHcHG9QFDWBfU4qV+1FOctg59pSbH3llnKvyX81QK89ubAWG8MmzmvqL17mNrfheJw1tVgbdmtxM5Wqhqelm4gr/ZBN/v/PhTlraBDWKkiKhXnhQeNlPrqN/5WKhyYfX+YrbjGWbnnIPo87guqCFvCJMlE1r7nM16Eo9xluYf5hNDXxnNl1pVbYFlSmJVzVrWn52he3DbTRMyse/ceYhj7POXK/hMvyRRfzzTv3xjQqHkssWL7SUM4dyeKNBVXGZ/6rS1bnAbnqjwb6jUvgX/AfqoiloxgcAAA='),
  'VroomMapCameraFollowerPackage.kt': decodeEmbeddedSource('H4sIAAAAAAAACpWQwWrDMAyG734KHZNS/AClK4Sw9bClLTv0GlRHCaZ2ZGyn3Rh795E0B8O2sl2EQPr0/78cqjN2BHV9KMrnYvtY19KiU2jJoxDaOvYRFFvZoqIT81l6QhXl61gPN/rO2snrpiO5w6gvVHEzmD9sT7cL54xWGDX3JfeR3uIdcNAWe+zIy6Oma3XrhVAGQ4CjZ7YVunIK9cTG8JX87B1WkEaBDwHAF/JeNwTt0IPyhJHSACGbRGdXM//dbr6CFx3iOkU38ABkXXwfJ1kufhZLMvxTKyHXiyUsNqOg0SHu20wAwC+/mJEsXwqAXHyKL+9MJcoXAgAA='),
};

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
const plugin = createRunOncePlugin(withVroomMapCameraFollower, 'with-vroom-map-camera-follower', '1.2.6');

plugin.__internal = { resolveIosProjectName, IOS_SOURCE_FILES, ANDROID_SOURCE_FILES };

module.exports = plugin;
