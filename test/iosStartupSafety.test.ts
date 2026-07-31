import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('iOS startup safety', () => {
  it('does not initialize Android channels or the Mapbox offline cache on boot', () => {
    const layout = readFileSync(resolve('app/_layout.tsx'), 'utf8');
    expect(layout).toContain("if (Platform.OS === 'android')");
    expect(layout).not.toContain('initMapbox().catch');
    expect(layout).toContain('initNavDriveTraceStore().catch');
  });

  it('runs the Mapbox cache initialization only from map screens', () => {
    const mainMap = readFileSync(resolve('app/(tabs)/map.tsx'), 'utf8');
    const spotMap = readFileSync(resolve('app/(tabs)/spotmap.tsx'), 'utf8');
    expect(mainMap).toContain('void initMapbox().catch');
    expect(spotMap).toContain('void initMapbox().catch');
  });

  it('does not apply the same native config plugin more than once', () => {
    const resolveAppConfig = require('../app.config.js');
    const config = resolveAppConfig({ config: {} });
    const keys = config.plugins.map((plugin: string | [string, unknown]) =>
      Array.isArray(plugin) ? plugin[0] : plugin,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps optional CarPlay data free from force unwraps', () => {
    const coordinator = readFileSync(
      resolve('modules/vroom-carplay/ios/VroomCarPlayCoordinator.swift'),
      'utf8',
    );
    const location = readFileSync(
      resolve('modules/vroom-carplay/ios/VroomCarPlayLocationEngine.swift'),
      'utf8',
    );
    expect(coordinator).not.toContain('snapshot.destination!');
    expect(coordinator).not.toContain('previewRoutes[0]');
    expect(location).not.toContain('projection!');
    expect(location).not.toContain('best!.distanceMeters');
  });
});
