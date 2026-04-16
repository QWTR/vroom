// Dynamic Expo config that reads Mapbox token from environment variable.
// Set EXPO_PUBLIC_MAPBOX_TOKEN in your .env file or EAS secrets.
const { withAndroid } = require('@expo/config-plugins');

const base = require('./app.json');

/** @type {import('@expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

  const merged = {
    ...base.expo,
    ...config,
    plugins: (base.expo.plugins ?? []).map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === '@rnmapbox/maps') {
        return [
          '@rnmapbox/maps',
          {
            RNMapboxMapsImpl: 'mapbox',
            RNMapboxMapsDownloadToken: mapboxToken,
          },
        ];
      }
      return plugin;
    }),
  };

  return merged;
};
