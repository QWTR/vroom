// Dynamic Expo config that reads the Mapbox token from an environment variable.
// Set EXPO_PUBLIC_MAPBOX_TOKEN in your .env file or in EAS secrets.

const base = require('./app.json');

/** @type {import('@expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

  return {
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
};
