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

const withVroomBgLocationNotification = (config) => {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      patchLocationTaskService(cfg.modRequest.projectRoot);
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
  '1.0.0',
);
