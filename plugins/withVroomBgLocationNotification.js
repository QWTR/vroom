const { withAndroidManifest, withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function patchLocationTaskService(projectRoot) {
  const source = path.join(projectRoot, 'native', 'android-patches', 'LocationTaskService.kt');
  const target = path.join(
    projectRoot,
    'node_modules',
    'expo-location',
    'android',
    'src',
    'main',
    'java',
    'expo',
    'modules',
    'location',
    'services',
    'LocationTaskService.kt',
  );
  if (!fs.existsSync(source) || !fs.existsSync(path.dirname(target))) return;
  fs.copyFileSync(source, target);
}

function copyBgTrackingNative(projectRoot, packageName) {
  const sourceDir = path.join(projectRoot, 'native', 'android-bg');
  const outDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...packageName.split('.'),
    'bg',
  );
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(outDir, { recursive: true });
  [
    'BgTrackingModule.kt',
    'BgTrackingPackage.kt',
    'BgTrackingStopReceiver.kt',
    'VroomBgTrackingService.kt',
  ].forEach((file) => {
    const src = path.join(sourceDir, file);
    if (!fs.existsSync(src)) return;
    const text = fs.readFileSync(src, 'utf8')
      .replace(/package com\.lexuuw\.vroom\.app\.bg/g, `package ${packageName}.bg`)
      .replace(/com\.lexuuw\.vroom\.app/g, packageName);
    fs.writeFileSync(path.join(outDir, file), text);
  });

  const mainApplicationPath = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...packageName.split('.'),
    'MainApplication.kt',
  );
  if (fs.existsSync(mainApplicationPath)) {
    let mainApplication = fs.readFileSync(mainApplicationPath, 'utf8');
    const importLine = `import ${packageName}.bg.BgTrackingPackage`;
    if (!mainApplication.includes(importLine)) {
      mainApplication = mainApplication.replace(
        'import expo.modules.ReactNativeHostWrapper',
        `import expo.modules.ReactNativeHostWrapper\n\n${importLine}`,
      );
    }
    if (!mainApplication.includes('add(BgTrackingPackage())')) {
      mainApplication = mainApplication.replace(
        '// add(MyReactNativePackage())',
        '// add(MyReactNativePackage())\n              add(BgTrackingPackage())',
      );
    }
    fs.writeFileSync(mainApplicationPath, mainApplication);
  }

  const drawableDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'drawable');
  fs.mkdirSync(drawableDir, { recursive: true });
  const trackingIcon = 'ic_bg_tracking_stat.xml';
  const iconSource = path.join(sourceDir, trackingIcon);
  if (fs.existsSync(iconSource)) {
    fs.copyFileSync(iconSource, path.join(drawableDir, trackingIcon));
  }

  const gradlePath = path.join(projectRoot, 'android', 'app', 'build.gradle');
  if (fs.existsSync(gradlePath)) {
    let gradle = fs.readFileSync(gradlePath, 'utf8');
    const dep = 'implementation "com.google.android.gms:play-services-location:21.0.1"';
    if (!gradle.includes(dep)) {
      gradle = gradle.replace('dependencies {\n', `dependencies {\n    ${dep}\n`);
      fs.writeFileSync(gradlePath, gradle);
    }
  }
}

const withVroomBgLocationNotification = (config) => {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      patchLocationTaskService(cfg.modRequest.projectRoot);
      copyBgTrackingNative(
        cfg.modRequest.projectRoot,
        cfg.android?.package || 'com.lexuuw.vroom.app',
      );
      return cfg;
    },
  ]);

  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;

    app.receiver = app.receiver || [];
    const receiverExists = app.receiver.some(
      (r) => r.$?.['android:name'] === '.bg.BgTrackingStopReceiver',
    );
    if (!receiverExists) {
      app.receiver.push({
        $: {
          'android:name': '.bg.BgTrackingStopReceiver',
          'android:exported': 'false',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'com.lexuuw.vroom.app.action.BG_TRACKING_END' } }],
          },
        ],
      });
    }

    app.service = app.service || [];
    const serviceExists = app.service.some(
      (s) => s.$?.['android:name'] === '.bg.VroomBgTrackingService',
    );
    if (!serviceExists) {
      app.service.push({
        $: {
          'android:name': '.bg.VroomBgTrackingService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'location',
          'android:stopWithTask': 'false',
        },
      });
    }
    return cfg;
  });

  return config;
};

module.exports = createRunOncePlugin(
  withVroomBgLocationNotification,
  'withVroomBgLocationNotification',
  '1.2.0',
);
