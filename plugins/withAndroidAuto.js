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
            category: [
              { $: { 'android:name': 'androidx.car.app.category.NAVIGATION' } },
              { $: { 'android:name': 'androidx.car.app.category.FEATURE_CLUSTER' } },
            ],
          },
        ],
      });
    } else {
      const service = mainApplication.service.find((entry) => entry.$?.['android:name'] === serviceName);
      if (service) {
        const filter = service['intent-filter']?.[0];
        if (filter) {
          filter.category = filter.category || [];
          const hasCluster = filter.category.some(
            (c) => c.$?.['android:name'] === 'androidx.car.app.category.FEATURE_CLUSTER',
          );
          if (!hasCluster) {
            filter.category.push({ $: { 'android:name': 'androidx.car.app.category.FEATURE_CLUSTER' } });
          }
        }
      }
    }

    const locationServiceName = '.auto.AutoLocationForegroundService';
    const hasLocationService = mainApplication.service.some(
      (service) => service.$?.['android:name'] === locationServiceName
    );
    if (!hasLocationService) {
      mainApplication.service.push({
        $: {
          'android:name': locationServiceName,
          'android:exported': 'false',
          'android:foregroundServiceType': 'location',
          'android:stopWithTask': 'false',
        },
      });
    }

    mainApplication.activity = mainApplication.activity || [];
    const mainActivity = mainApplication.activity.find((entry) => entry.$?.['android:name'] === '.MainActivity');
    if (mainActivity) {
      mainActivity['intent-filter'] = mainActivity['intent-filter'] || [];
      const navigateFilters = [
        {
          action: [{ $: { 'android:name': 'androidx.car.app.action.NAVIGATE' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          data: [{ $: { 'android:scheme': 'geo' } }],
        },
        {
          action: [{ $: { 'android:name': 'android.intent.action.NAVIGATE' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          data: [{ $: { 'android:scheme': 'geo' } }],
        },
        {
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          data: [{ $: { 'android:scheme': 'geo' } }],
        },
      ];
      navigateFilters.forEach((filter) => {
        const actionName = filter.action[0].$['android:name'];
        const exists = mainActivity['intent-filter'].some((existing) =>
          existing.action?.some((action) => action.$?.['android:name'] === actionName) &&
          existing.data?.some((data) => data.$?.['android:scheme'] === 'geo'),
        );
        if (!exists) mainActivity['intent-filter'].push(filter);
      });
    }

    const receiverName = '.auto.AutoDriveReceiver';
    mainApplication.receiver = mainApplication.receiver || [];
    const hasAutoDriveReceiver = mainApplication.receiver.some(
      (entry) => entry.$?.['android:name'] === receiverName,
    );
    if (!hasAutoDriveReceiver) {
      mainApplication.receiver.push({
        $: {
          'android:name': receiverName,
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'com.lexuuw.vroom.app.action.ENABLE_AUTO_DRIVE' } },
              { $: { 'android:name': 'com.lexuuw.vroom.app.action.TEST_NAVIGATION' } },
            ],
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
      const drawableDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'drawable');
      const mainApplicationPath = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'MainApplication.kt');
      const gradlePath = path.join(projectRoot, 'android', 'app', 'build.gradle');

      fs.mkdirSync(outDir, { recursive: true });
      fs.mkdirSync(drawableDir, { recursive: true });

      [
        'AutoDriveReceiver.kt',
        'AutoDriveSimulator.kt',
        'AutoDriverAlertController.kt',
        'AutoDriverAlertPolicy.kt',
        'AutoManeuverResolver.kt',
        'AutoInstructionFormatter.kt',
        'AutoMapStylePolicy.kt',
        'AutoMapMotionPolicy.kt',
        'AutoNavigationCoordinator.kt',
        'AutoNavigationIntentHandler.kt',
        'AutoNavigationRoutePolicy.kt',
        'AutoPendingNavigation.kt',
        'AutoHudMetrics.kt',
        'AutoRoadPosePolicy.kt',
        'AutoThemeMode.kt',
        'AutoTurnNotificationManager.kt',
        'AutoViewportPolicy.kt',
        'AutoBridgePackage.kt',
        'AutoLocationForegroundService.kt',
        'AutoLocationPolicy.kt',
        'AutoLocationTracker.kt',
        'AutoLiveFleetSocketClient.kt',
        'AutoLiveFleetStore.kt',
        'AutoNavStore.kt',
        'AutoRouteGeometry.kt',
        'NativeRoadMatcher.kt',
        'NativeSpeedLimitFetcher.kt',
        'UsersModule.kt',
        'VroomBridgeModule.kt',
        'VroomCarAppService.kt',
        'VroomCarManager.kt',
        'VroomCarScreen.kt',
        'VroomCarSession.kt',
        'VroomMapSurfaceRenderer.kt',
        'VroomMenuScreen.kt',
        'VroomNavigationScreen.kt',
        'VroomPayload.kt',
        'VroomPayloadParser.kt',
      ].forEach((file) => {
        const src = path.join(srcDir, file);
        const dest = path.join(outDir, file);
        const text = fs.readFileSync(src, 'utf8').replace(/__PACKAGE__/g, packageName);
        fs.writeFileSync(dest, text);
      });

      fs.copyFileSync(
        path.join(srcDir, 'vroom_location_arrow.xml'),
        path.join(drawableDir, 'vroom_location_arrow.xml')
      );

      const drawableSrcDir = path.join(srcDir, 'drawable');
      if (fs.existsSync(drawableSrcDir)) {
        fs.readdirSync(drawableSrcDir).forEach((file) => {
          if (file.endsWith('.xml')) {
            fs.copyFileSync(
              path.join(drawableSrcDir, file),
              path.join(drawableDir, file),
            );
          }
        });
      }

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

      const mainActivityPath = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.'),
        'MainActivity.kt',
      );
      if (fs.existsSync(mainActivityPath)) {
        let mainActivity = fs.readFileSync(mainActivityPath, 'utf8');
        const pendingImport = `import ${packageName}.auto.AutoPendingNavigation`;
        if (!mainActivity.includes(pendingImport)) {
          mainActivity = mainActivity.replace(
            'import expo.modules.ReactActivityDelegateWrapper',
            `import expo.modules.ReactActivityDelegateWrapper\nimport ${packageName}.auto.AutoPendingNavigation`,
          );
        }
        if (!mainActivity.includes('AutoPendingNavigation.store(this, intent)')) {
          mainActivity = mainActivity.replace(
            'super.onCreate(null)',
            'super.onCreate(null)\n    AutoPendingNavigation.store(this, intent)',
          );
        }
        if (!mainActivity.includes('override fun onNewIntent')) {
          mainActivity = mainActivity.replace(
            '  /**\n   * Returns the name of the main component',
            `  override fun onNewIntent(intent: android.content.Intent) {\n    super.onNewIntent(intent)\n    setIntent(intent)\n    AutoPendingNavigation.store(this, intent)\n  }\n\n  /**\n   * Returns the name of the main component`,
          );
        }
        fs.writeFileSync(mainActivityPath, mainActivity);
      }

      if (fs.existsSync(gradlePath)) {
        let gradle = fs.readFileSync(gradlePath, 'utf8');
        const deps = [
          'implementation "androidx.car.app:app:1.7.0"',
          'implementation "androidx.car.app:app-projected:1.7.0"',
          'implementation "com.mapbox.maps:android-ndk27:11.18.2"',
          'implementation "com.mapbox.common:common-ndk27:24.11.1"',
          'implementation "com.google.android.gms:play-services-location:21.0.1"',
          'implementation("io.socket:socket.io-client:2.1.2") { exclude group: "org.json", module: "json" }',
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

module.exports = createRunOncePlugin(withAndroidAuto, 'with-android-auto', '1.1.1');
