const base = require('./app.json');

/** @type {import('@expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  // Używamy Tajnego Tokenu do pobierania (zmienna bez EXPO_PUBLIC)
  const downloadToken = process.env.RNMAPBOX_MAPS_DOWNLOAD_TOKEN || '';

  return {
    ...base.expo,
    ...config,
    plugins: (base.expo.plugins ?? []).map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === '@rnmapbox/maps') {
        return [
          '@rnmapbox/maps',
          {
            RNMapboxMapsImpl: 'mapbox',
            // POPRAWIONA NAZWA KLUCZA I ZMIENNA
            RNMAPBOX_MAPS_DOWNLOAD_TOKEN: downloadToken,
          },
        ];
      }
      return plugin;
    }),
  };
};