const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pluginPath = path.join(root, 'plugins', 'withWiroomBackgroundDrive.js');
const nativeDir = path.join(root, 'native', 'background-drive', 'ios');
const swiftPath = path.join(nativeDir, 'WiroomLocationService.swift');
const bridgePath = path.join(nativeDir, 'WiroomLocationServiceBridge.m');
let plugin = fs.readFileSync(pluginPath, 'utf8');

const swiftMatch = plugin.match(/const SWIFT_MODULE = `([\s\S]*?)`;\r?\n\r?\nconst OBJC_BRIDGE/);
const bridgeMatch = plugin.match(/const OBJC_BRIDGE = `([\s\S]*?)`;\r?\n\r?\nconst resolveIosProjectName/);
if (!swiftMatch || !bridgeMatch) throw new Error('Background-drive embedded sources were not found');

fs.mkdirSync(nativeDir, { recursive: true });
if (!fs.existsSync(swiftPath)) fs.writeFileSync(swiftPath, swiftMatch[1]);
if (!fs.existsSync(bridgePath)) fs.writeFileSync(bridgePath, bridgeMatch[1]);

const escapeTemplate = (value) => value.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const swift = escapeTemplate(fs.readFileSync(swiftPath, 'utf8'));
const bridge = escapeTemplate(fs.readFileSync(bridgePath, 'utf8'));
plugin = plugin.replace(/const SWIFT_MODULE = `[\s\S]*?`;\r?\n\r?\nconst OBJC_BRIDGE/, `const SWIFT_MODULE = \`${swift}\`;\n\nconst OBJC_BRIDGE`);
plugin = plugin.replace(/const OBJC_BRIDGE = `[\s\S]*?`;\r?\n\r?\nconst resolveIosProjectName/, `const OBJC_BRIDGE = \`${bridge}\`;\n\nconst resolveIosProjectName`);
fs.writeFileSync(pluginPath, plugin);
