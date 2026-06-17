const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const config = getDefaultConfig(__dirname);

const escapeRegex = (value) => value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

const blockPath = (...parts) => {
  const normalized = path.join(__dirname, ...parts).replace(/[/\\]+/g, '/');
  const pattern = normalized.split('/').map(escapeRegex).join('[/\\\\]');
  return new RegExp(`${pattern}([/\\\\].*)?$`);
};

config.resolver.blockList = exclusionList([
  blockPath('android', '.gradle'),
  blockPath('android', '.cxx'),
  blockPath('android', 'build'),
  blockPath('android', 'app', 'build'),
  blockPath('node_modules', 'react-native-iap', 'android', '.cxx'),
  blockPath('node_modules', 'react-native-iap', 'android', 'build'),
]);

module.exports = config;
