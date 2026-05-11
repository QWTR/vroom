const fs = require('fs');
const path = require('path');
const {
  withInfoPlist,
  withEntitlementsPlist,
  withAppBuildGradle,
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
  createRunOncePlugin,
} = require('@expo/config-plugins');

function ensureAndroidManifestEntries(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    manifest['uses-feature'] = manifest['uses-feature'] || [];
    const app = manifest.application?.[0];
    if (!app) return mod;

    const permissions = manifest['uses-permission'];
    const requiredPermissions = [
      'androidx.car.app.NAVIGATION_TEMPLATES',
      'androidx.car.app.ACCESS_SURFACE',
    ];
    for (const permission of requiredPermissions) {
      if (!permissions.some((p) => p.$['android:name'] === permission)) {
        permissions.push({ $: { 'android:name': permission } });
      }
    }
    const features = manifest['uses-feature'];
    if (!features.some((f) => f.$['android:name'] === 'android.software.car.templates_host')) {
      features.push({ $: { 'android:name': 'android.software.car.templates_host' } });
    }

    app['meta-data'] = app['meta-data'] || [];
    if (!app['meta-data'].some((m) => m.$['android:name'] === 'com.google.android.gms.car.application')) {
      app['meta-data'].push({
        $: {
          'android:name': 'com.google.android.gms.car.application',
          'android:resource': '@xml/automotive_app_desc',
        },
      });
    }

    app.service = app.service || [];
    const existingService = app.service.find((s) => s.$['android:name'] === '.auto.VroomCarAppService');
    if (!existingService) {
      app.service.push({
        $: { 'android:name': '.auto.VroomCarAppService', 'android:exported': 'true' },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'androidx.car.app.CarAppService' } }],
          category: [{ $: { 'android:name': 'androidx.car.app.category.NAVIGATION' } }],
        }],
        'meta-data': [{ $: { 'android:name': 'androidx.car.app.minCarApiLevel', 'android:value': '1' } }],
      });
    } else {
      existingService['intent-filter'] = existingService['intent-filter'] || [];
      const filter = existingService['intent-filter'][0] || { action: [], category: [] };
      filter.action = filter.action || [];
      filter.category = filter.category || [];
      if (!filter.action.some((a) => a.$['android:name'] === 'androidx.car.app.CarAppService')) {
        filter.action.push({ $: { 'android:name': 'androidx.car.app.CarAppService' } });
      }
      if (!filter.category.some((c) => c.$['android:name'] === 'androidx.car.app.category.NAVIGATION')) {
        filter.category.push({ $: { 'android:name': 'androidx.car.app.category.NAVIGATION' } });
      }
      existingService['intent-filter'][0] = filter;
    }

    return mod;
  });
}

function ensureAndroidDependencies(config) {
  return withAppBuildGradle(config, (mod) => {
    const targets = [
      'implementation("androidx.car.app:app:1.4.0")',
      'implementation("androidx.car.app:app-projected:1.4.0")',
    ];
    const missingTargets = targets.filter((target) => !mod.modResults.contents.includes(target));
    if (missingTargets.length > 0) {
      mod.modResults.contents = mod.modResults.contents.replace(
        'implementation("com.facebook.react:react-android")',
        `implementation("com.facebook.react:react-android")\n    ${missingTargets.map((target) => target).join('\n    ')}`,
      );
    }
    return mod;
  });
}

function ensureMainApplicationPackage(config) {
  return withMainApplication(config, (mod) => {
    const src = mod.modResults.contents;
    if (!src.includes('AutoBridgePackage')) {
      mod.modResults.contents = src
        .replace(
          'import com.facebook.react.defaults.DefaultReactNativeHost',
          'import com.facebook.react.defaults.DefaultReactNativeHost\nimport com.lexuuw.vroom.app.auto.AutoBridgePackage',
        )
        .replace(
          '// add(MyReactNativePackage())',
          '// add(MyReactNativePackage())\n              add(AutoBridgePackage())',
        );
    }
    return mod;
  });
}

function ensureIosPlist(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults.UISupportsCarPlay = true;
    mod.modResults.UIBackgroundModes = Array.from(
      new Set([...(mod.modResults.UIBackgroundModes || []), 'location', 'fetch']),
    );
    return mod;
  });
}

function ensureIosEntitlements(config) {
  return withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.developer.carplay-navigation'] = true;
    return mod;
  });
}

function copyIosTemplates(config) {
  return withDangerousMod(config, ['ios', async (mod) => {
    const srcDir = path.join(config.modRequest.projectRoot, 'native', 'ios-carplay');
    const iosDir = mod.modRequest.platformProjectRoot;
    if (!fs.existsSync(srcDir) || !fs.existsSync(iosDir)) return mod;

    const targetDir = path.join(iosDir, 'VroomCarPlay');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    for (const file of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(targetDir, file));
    }
    return mod;
  }]);
}

function copyAndroidTemplates(config) {
  return withDangerousMod(config, ['android', async (mod) => {
    const androidDir = mod.modRequest.platformProjectRoot;
    if (!fs.existsSync(androidDir)) return mod;

    const packageName = config.android?.package || 'com.lexuuw.vroom.app';
    const packagePath = packageName.split('.').join(path.sep);
    const srcDir = path.join(mod.modRequest.projectRoot, 'native', 'android-auto');
    const targetJavaDir = path.join(
      androidDir,
      'app',
      'src',
      'main',
      'java',
      packagePath,
      'auto',
    );
    const targetXmlDir = path.join(androidDir, 'app', 'src', 'main', 'res', 'xml');

    if (!fs.existsSync(targetJavaDir)) fs.mkdirSync(targetJavaDir, { recursive: true });
    if (!fs.existsSync(targetXmlDir)) fs.mkdirSync(targetXmlDir, { recursive: true });

    const xmlTarget = path.join(targetXmlDir, 'automotive_app_desc.xml');
    if (fs.existsSync(path.join(srcDir, 'automotive_app_desc.xml'))) {
      fs.copyFileSync(path.join(srcDir, 'automotive_app_desc.xml'), xmlTarget);
    } else if (!fs.existsSync(xmlTarget)) {
      fs.writeFileSync(
        xmlTarget,
        `<?xml version="1.0" encoding="utf-8"?>\n<automotiveApp>\n  <uses name="template"/>\n</automotiveApp>\n`,
      );
    }

    if (fs.existsSync(srcDir)) {
      const kotlinTemplates = fs
        .readdirSync(srcDir)
        .filter((f) => f.endsWith('.kt'));

      for (const file of kotlinTemplates) {
        const src = path.join(srcDir, file);
        const dest = path.join(targetJavaDir, file);
        const content = fs.readFileSync(src, 'utf8')
          .replaceAll('__PACKAGE__', packageName);
        fs.writeFileSync(dest, content);
      }
    }

    return mod;
  }]);
}

const withAutomotive = (config) => {
  config = ensureAndroidManifestEntries(config);
  config = ensureAndroidDependencies(config);
  config = ensureMainApplicationPackage(config);
  config = copyAndroidTemplates(config);
  config = ensureIosPlist(config);
  config = ensureIosEntitlements(config);
  config = copyIosTemplates(config);
  return config;
};

module.exports = createRunOncePlugin(withAutomotive, 'with-automotive', '1.0.0');
