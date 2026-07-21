const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const pluginPath = path.join(root, 'plugins', 'withVroomMapCameraFollower.js');
const canonicalDir = path.join(root, 'native', 'map-camera-follower', 'ios');
const mirrorDir = path.join(root, 'plugins', 'map-camera-follower', 'ios');
const files = [
  'VroomMapCameraFollower.swift',
  'VroomNativeMotionPredictor.swift',
  'VroomMapCameraFollowerBridge.m',
];

let plugin = fs.readFileSync(pluginPath, 'utf8');
for (const file of files) {
  const source = fs.readFileSync(path.join(canonicalDir, file), 'utf8');
  const encoded = zlib.gzipSync(Buffer.from(source)).toString('base64');
  const entry = `  '${file}': decodeEmbeddedSource('${encoded}'),`;
  const pattern = new RegExp(`  '${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': decodeEmbeddedSource\\('[^']*'\\),`);
  if (pattern.test(plugin)) {
    plugin = plugin.replace(pattern, entry);
  } else {
    const anchor = "const IOS_SOURCE_FILES = {";
    plugin = plugin.replace(anchor, `${anchor}\n${entry}`);
  }
  fs.mkdirSync(mirrorDir, { recursive: true });
  fs.copyFileSync(path.join(canonicalDir, file), path.join(mirrorDir, file));
}
fs.writeFileSync(pluginPath, plugin);
