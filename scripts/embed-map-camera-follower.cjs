const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const pluginPath = path.join(root, 'plugins', 'withVroomMapCameraFollower.js');
let plugin = fs.readFileSync(pluginPath, 'utf8');
for (const [platform, files] of Object.entries({
  ios: ['VroomMapCameraFollower.swift', 'VroomMapCameraFollowerBridge.m'],
  android: ['VroomMapCameraFollower.kt', 'VroomMapCameraFollowerManager.kt', 'VroomMapCameraFollowerPackage.kt'],
})) {
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, 'native', 'map-camera-follower', platform, file), 'utf8');
    const encoded = zlib.gzipSync(Buffer.from(source)).toString('base64');
    const prefix = `  '${file}': decodeEmbeddedSource('`;
    const start = plugin.indexOf(prefix);
    if (start < 0) throw new Error(`Missing embedded source: ${file}`);
    const end = plugin.indexOf("'),", start) + 3;
    plugin = plugin.slice(0, start) + `${prefix}${encoded}'),` + plugin.slice(end);
    if (platform === 'ios') {
      const mirror = path.join(root, 'plugins', 'map-camera-follower', 'ios');
      fs.mkdirSync(mirror, { recursive: true });
      fs.writeFileSync(path.join(mirror, file), source);
    } else {
      const generated = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'lexuuw', 'vroom', 'app', 'mapcamera');
      if (fs.existsSync(generated)) fs.writeFileSync(path.join(generated, file), source.replaceAll('__PACKAGE__', 'com.lexuuw.vroom.app'));
    }
  }
}
fs.writeFileSync(pluginPath, plugin);
