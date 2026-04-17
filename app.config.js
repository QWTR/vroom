const base = require('./app.json');

module.exports = ({ config }) => {
  const downloadToken = process.env.RNMAPBOX_MAPS_DOWNLOAD_TOKEN || base.expo.plugins.find(p => Array.isArray(p) && p[0] === '@rnmapbox/maps')?.[1]?.RNMAPBOX_MAPS_DOWNLOAD_TOKEN;

  return {
    ...base.expo,
    ...config,
    newArchEnabled: true, // Wymuszenie tutaj
    plugins: (base.expo.plugins ?? []).map((plugin) => {
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