const { createRunOncePlugin, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function installNative(projectRoot, packageName) {
  const sourceDir = path.join(projectRoot, 'native', 'android-cb');
  const targetDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'cb');
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of ['RadioForegroundModule.kt', 'RadioForegroundPackage.kt', 'VroomCbForegroundService.kt']) {
    const source = path.join(sourceDir, file);
    if (!fs.existsSync(source)) continue;
    const contents = fs.readFileSync(source, 'utf8').replace(/package com\.lexuuw\.vroom\.app\.cb/g, `package ${packageName}.cb`);
    fs.writeFileSync(path.join(targetDir, file), contents);
  }

  const mainApplicationPath = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'MainApplication.kt');
  if (!fs.existsSync(mainApplicationPath)) return;
  let contents = fs.readFileSync(mainApplicationPath, 'utf8');
  const importLine = `import ${packageName}.cb.RadioForegroundPackage`;
  if (!contents.includes(importLine)) contents = contents.replace('import expo.modules.ReactNativeHostWrapper', `import expo.modules.ReactNativeHostWrapper\n\n${importLine}`);
  if (!contents.includes('add(RadioForegroundPackage())')) contents = contents.replace('// add(MyReactNativePackage())', '// add(MyReactNativePackage())\n              add(RadioForegroundPackage())');
  fs.writeFileSync(mainApplicationPath, contents);
}

const withVroomCbRadio = (config) => {
  config = withDangerousMod(config, ['android', async (cfg) => {
    installNative(cfg.modRequest.projectRoot, cfg.android?.package || 'com.lexuuw.vroom.app');
    return cfg;
  }]);
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    app.service = app.service || [];
    if (!app.service.some((service) => service.$?.['android:name'] === '.cb.VroomCbForegroundService')) {
      app.service.push({ $: { 'android:name': '.cb.VroomCbForegroundService', 'android:exported': 'false', 'android:foregroundServiceType': 'microphone', 'android:stopWithTask': 'true' } });
    }
    return cfg;
  });
};

module.exports = createRunOncePlugin(withVroomCbRadio, 'withVroomCbRadio', '1.0.0');
