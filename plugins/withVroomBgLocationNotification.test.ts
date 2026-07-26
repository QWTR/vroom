import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const normalize = (value: string) => value.replace(/\r\n/g, '\n');

describe('Android native background drive contract', () => {
  it('keeps generated sources identical to the canonical prebuild inputs', () => {
    for (const file of [
      'BgTrackingModule.kt',
      'BgTrackingPackage.kt',
      'BgTrackingStopReceiver.kt',
      'VroomBgTrackingService.kt',
    ]) {
      expect(normalize(readFileSync(
        resolve('android/app/src/main/java/com/lexuuw/vroom/app/bg', file),
        'utf8',
      )), file).toBe(normalize(readFileSync(resolve('native/android-bg', file), 'utf8')));
    }
  });

  it('uses a lightweight progress bridge and never auto-stops an active drive', () => {
    const service = readFileSync(resolve('native/android-bg/VroomBgTrackingService.kt'), 'utf8');
    const module = readFileSync(resolve('native/android-bg/BgTrackingModule.kt'), 'utf8');

    expect(service).toContain('fun readNativeProgress');
    expect(module).toContain('fun getNativeProgress');
    expect(service).toContain('ROUTE_POINT_SPACING_KM');
    expect(service).not.toContain('stopTracking("idle"');
    expect(service).not.toContain('fun observeIdle');
  });
});
