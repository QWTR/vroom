const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blockDirectory = (directory) => new RegExp(
  `^${escapeRegExp(path.resolve(__dirname, directory))}(?:[\\\\/].*)?$`,
);

// Gradle creates and removes these directories while Metro's Windows fallback
// watcher is walking the repository. They never contain JavaScript sources and
// watching them can crash Metro with ENOENT when a directory disappears.
config.resolver.blockList = [
  ...(config.resolver.blockList ?? []),
  blockDirectory('android/.gradle'),
  blockDirectory('android/build'),
  blockDirectory('android/app/build'),
  blockDirectory('android/.cxx'),
];

module.exports = config;
