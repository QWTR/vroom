const { withAndroidManifest, withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withAndroidAutoManifest = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const manifest = androidManifest.manifest;
    const mainApplication = androidManifest.manifest.application[0];
    const permissions = manifest['uses-permission'] || [];
    manifest['uses-permission'] = permissions;

    [
      'androidx.car.app.ACCESS_SURFACE',
      'androidx.car.app.NAVIGATION_TEMPLATES',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.INTERNET',
    ].forEach((name) => {
      const exists = permissions.some((p) => p.$?.['android:name'] === name);
      if (!exists) permissions.push({ $: { 'android:name': name } });
    });

    const hasMetaData = mainApplication['meta-data']?.some(
      (m) => m.$['android:name'] === 'com.google.android.gms.car.application'
    );

    if (!hasMetaData) {
      mainApplication['meta-data'] = mainApplication['meta-data'] || [];
      mainApplication['meta-data'].push({
        $: {
          'android:name': 'com.google.android.gms.car.application',
          'android:resource': '@xml/automotive_app_desc',
        },
      });
    }

    const hasMinApi = mainApplication['meta-data']?.some(
      (m) => m.$['android:name'] === 'androidx.car.app.minCarApiLevel'
    );
    if (!hasMinApi) {
      mainApplication['meta-data'] = mainApplication['meta-data'] || [];
      mainApplication['meta-data'].push({
        $: {
          'android:name': 'androidx.car.app.minCarApiLevel',
          'android:value': '1',
        },
      });
    }

    const serviceName = '.auto.VroomCarAppService';
    mainApplication.service = mainApplication.service || [];
    const hasService = mainApplication.service.some(
      (service) => service.$?.['android:name'] === serviceName
    );
    if (!hasService) {
      mainApplication.service.push({
        $: {
          'android:name': serviceName,
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'androidx.car.app.CarAppService' } }],
            category: [{ $: { 'android:name': 'androidx.car.app.category.NAVIGATION' } }],
          },
        ],
      });
    }

    return config;
  });
};

const withAndroidAutoXml = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const resPath = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'xml');
      
      fs.mkdirSync(resPath, { recursive: true });
      
      const xmlPath = path.join(resPath, 'automotive_app_desc.xml');
      const xmlContent = `<?xml version="1.0" encoding="utf-8"?>\n<automotiveApp>\n  <uses name="template" />\n</automotiveApp>\n`;
      
      fs.writeFileSync(xmlPath, xmlContent);
      return config;
    },
  ]);
};

const withAndroidAutoNative = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const packageName = config.android?.package || 'com.lexuuw.vroom.app';
      const srcDir = path.join(projectRoot, 'native', 'android-auto');
      const outDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'auto');
      const mainApplicationPath = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'MainApplication.kt');
      const gradlePath = path.join(projectRoot, 'android', 'app', 'build.gradle');

      fs.mkdirSync(outDir, { recursive: true });

      [
        'VroomBridgeModule.kt',
        'VroomCarManager.kt',
        'VroomCarScreen.kt',
        'VroomPayloadParser.kt',
      ].forEach((file) => {
        const stalePath = path.join(outDir, file);
        if (fs.existsSync(stalePath)) fs.rmSync(stalePath);
      });

      [
        'AutoBridgePackage.kt',
        'AutoLocationTracker.kt',
        'AutoNavStore.kt',
        'UsersModule.kt',
        'VroomCarAppService.kt',
        'VroomCarSession.kt',
        'VroomMapSurfaceRenderer.kt',
        'VroomMenuScreen.kt',
        'VroomNavigationScreen.kt',
      ].forEach((file) => {
        const src = path.join(srcDir, file);
        const dest = path.join(outDir, file);
        const text = fs.readFileSync(src, 'utf8').replace(/__PACKAGE__/g, packageName);
        fs.writeFileSync(dest, text);
      });

      if (fs.existsSync(mainApplicationPath)) {
        let mainApplication = fs.readFileSync(mainApplicationPath, 'utf8');
        const importLine = `import ${packageName}.auto.AutoBridgePackage`;
        if (!mainApplication.includes(importLine)) {
          mainApplication = mainApplication.replace(
            'import expo.modules.ReactNativeHostWrapper',
            `import expo.modules.ReactNativeHostWrapper\n\n${importLine}`
          );
        }
        if (!mainApplication.includes('add(AutoBridgePackage())')) {
          mainApplication = mainApplication.replace(
            '// add(MyReactNativePackage())',
            '// add(MyReactNativePackage())\n              add(AutoBridgePackage())'
          );
        }
        fs.writeFileSync(mainApplicationPath, mainApplication);
      }

      if (fs.existsSync(gradlePath)) {
        let gradle = fs.readFileSync(gradlePath, 'utf8');
        const deps = [
          'implementation "androidx.car.app:app:1.4.0"',
          'implementation "androidx.car.app:app-projected:1.4.0"',
          'implementation "com.mapbox.maps:android-ndk27:11.18.2"',
          'implementation "com.mapbox.common:common-ndk27:24.11.1"',
        ];
        deps.forEach((dep) => {
          if (!gradle.includes(dep)) {
            gradle = gradle.replace('dependencies {\n', `dependencies {\n    ${dep}\n`);
          }
        });
        fs.writeFileSync(gradlePath, gradle);
      }

      return config;
    },
  ]);
};

const withAndroidAuto = (config) => {
  config = withAndroidAutoManifest(config);
  config = withAndroidAutoXml(config);
  config = withAndroidAutoNative(config);
  return config;
};

module.exports = createRunOncePlugin(withAndroidAuto, 'with-android-auto', '1.1.0');
