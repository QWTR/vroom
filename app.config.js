const appJson = require('./app.json');

module.exports = ({ config }) => {
  const base = config?.plugins ? config : appJson.expo;
  return {
    ...base,
    runtimeVersion: process.env.VROOM_NAVIGATION_TEST === '1'
      ? `${base.runtimeVersion}-navfix-test`
      : process.env.VROOM_OTA_RUNTIME_VERSION || base.runtimeVersion,
    updates: process.env.VROOM_NAVIGATION_TEST === '1' ? { ...base.updates, enabled: false } : base.updates,
  };
};
