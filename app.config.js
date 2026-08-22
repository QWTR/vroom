const appJson = require('./app.json');

module.exports = ({ config }) => {
  const base = config?.plugins ? config : appJson.expo;
  return {
    ...base,
    runtimeVersion: process.env.VROOM_OTA_RUNTIME_VERSION || base.runtimeVersion,
  };
};
