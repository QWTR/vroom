const base = require('./app.json');

module.exports = ({ config }) => {
  const downloadToken = process.env.RNMAPBOX_MAPS_DOWNLOAD_TOKEN || base.expo.plugins.find(p => Array.isArray(p) && p[0] === '@rnmapbox/maps')?.[1]?.RNMAPBOX_MAPS_DOWNLOAD_TOKEN;

  return {
    ...base.expo,
    ...config,
    newArchEnabled: true, // Wymuszenie tutaj
    extra: {
      ...(typeof base.expo.extra === 'object' && base.expo.extra ? base.expo.extra : {}),
      ...(typeof config?.extra === 'object' && config.extra ? config.extra : {}),
      // Ustaw w .env (lokalnie) albo w EAS Environment / eas.json → EXPO_PUBLIC_*
      revenueCatIosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '',
      revenueCatAndroidApiKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '',
    },
    plugins: [...(base.expo.plugins ?? []), 'expo-sqlite'].map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === '@rnmapbox/maps') {
        return [
          '@rnmapbox/maps',
          {
            ...plugin[1],
            RNMapboxMapsImpl: 'mapbox',
            RNMAPBOX_MAPS_DOWNLOAD_TOKEN: downloadToken,
          },
        ];
      }
      return plugin;
    }),
  };
};