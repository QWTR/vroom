import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('automotive location provider contract', () => {
  it('uses one Android broker for background drive and Android Auto', () => {
    const broker = read('native/android-bg/VroomLocationBroker.kt');
    const service = read('native/android-bg/VroomBgTrackingService.kt');
    const auto = read('native/android-auto/AutoLocationTracker.kt');
    const plugin = read('plugins/withVroomBgLocationNotification.js');

    expect(broker).toContain('object VroomLocationBroker');
    expect(broker).toContain('MOVING_INTERVAL_MS = 1_000L');
    expect(broker).toContain('IDLE_INTERVAL_MS = 3_000L');
    expect(service).toContain('VroomLocationBroker.subscribe');
    expect(auto).toContain('VroomLocationBroker.subscribe');
    expect(auto).not.toContain('requestLocationUpdates');
    expect(service).not.toContain('acquireWakeLock');
    expect(plugin).toContain("'VroomLocationBroker.kt'");
  });

  it('lets CarPlay reuse the iOS background-drive CLLocationManager', () => {
    const backgroundPlugin = read('native/background-drive/ios/WiroomLocationService.swift');
    const carPlay = read('modules/vroom-carplay/ios/VroomCarPlayLocationEngine.swift');

    expect(backgroundPlugin).toContain('Notification.Name("VroomSharedLocationFix")');
    expect(backgroundPlugin).toContain('manager.pausesLocationUpdatesAutomatically = true');
    expect(carPlay).toContain('receiveSharedLocation');
    expect(carPlay).toContain('startFallbackLocation');
    expect(carPlay).toContain('minimum: moving ? 55 : 20');
  });
});
