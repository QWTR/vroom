const appJson = require('./app.json');

module.exports = () => ({
  ...appJson.expo,
  runtimeVersion: process.env.VROOM_OTA_RUNTIME_VERSION || appJson.expo.runtimeVersion,
});
