const { withAndroidManifest, withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withAndroidAutoManifest = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

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

const withAndroidAuto = (config) => {
  config = withAndroidAutoManifest(config);
  config = withAndroidAutoXml(config);
  return config;
};

module.exports = createRunOncePlugin(withAndroidAuto, 'with-android-auto', '1.0.0');
