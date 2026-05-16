/**
 * Android Auto / Car App integration — DISABLED.
 * Previously injected CarAppService, permissions, and native AA code via prebuild.
 * Keep this plugin as a no-op so adding `./plugins/withAutomotive` to app.config
 * does not re-enable AA until you restore the full implementation.
 */
const { createRunOncePlugin } = require('@expo/config-plugins');

const withAutomotive = (config) => config;

module.exports = createRunOncePlugin(withAutomotive, 'with-automotive', '2.0.0-disabled');
