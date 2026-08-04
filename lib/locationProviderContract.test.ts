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
    expect(broker).toContain('MOVING_MIN_INTERVAL_MS = 500L');
    expect(broker).toContain('IDLE_INTERVAL_MS = 3_000L');
    expect(broker).toContain('PRIORITY_BALANCED_POWER_ACCURACY');
    expect(broker).toContain('.setMinUpdateDistanceMeters(2f)');
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
    expect(backgroundPlugin).toContain('manager.distanceFilter = 2');
    expect(backgroundPlugin).toContain('kCLLocationAccuracyBestForNavigation');
    expect(carPlay).toContain('receiveSharedLocation');
    expect(carPlay).toContain('startFallbackLocation');
    expect(carPlay).toContain('minimum: moving ? 55 : 20');
  });

  it('keeps one stable high-accuracy JS GPS profile during motion', () => {
    const watch = read('hooks/useDriveLocationWatch.ts');
    expect(watch).not.toContain('activeDriveCruise');
    expect(watch).not.toContain('activeNavCruise');
    expect(watch).toContain('Location.Accuracy.BestForNavigation');
    expect(watch).toContain('GPS_NATIVE_PROVIDER_REUSED');
  });

  it('keeps map trip camera and navigation UI at smooth cadence', () => {
    const canvas = read('components/map/MapCanvas.tsx');
    const cameraFrame = read('hooks/useDriveMarkerCameraFrame.ts');
    const perf = read('constants/mapPerformance.ts');
    expect(canvas).toContain('preferredFramesPerSecond');
    expect(cameraFrame).toContain('FRAME_CAMERA_MIN_INTERVAL_MS = 16');
    expect(perf).toContain('navProgressUi: 250');
    expect(perf).toContain('liveSendIntervalTrip: 800');
    expect(perf).toContain('liveSendTick: 1_000');
  });

  it('does not pin trip distance ownership to native zero km', () => {
    const tripStats = read('hooks/useTripStats.ts');
    const ownership = read('lib/backgroundDriveController.ts');
    const androidService = read('native/android-bg/VroomBgTrackingService.kt');
    const iosService = read('native/background-drive/ios/WiroomLocationService.swift');
    const merge = read('lib/tripDistanceMerge.ts');
    expect(tripStats).toContain('nativeCaughtUp');
    expect(tripStats).toContain('nativeKm + 1e-6 >= distanceRef.current');
    expect(ownership).toContain('nativeKm > 0');
    expect(read('hooks/useDriveLocationWatch.ts')).toContain('onLocRef.current({');
    expect(androidService).toContain('location.hasSpeed() && location.speed > 0f');
    expect(iosService).toContain('location.speed > 0 ? location.speed * 3.6 : nil');
    expect(merge).toContain('return Math.max(');
    expect(merge).toContain('safeKm(inputs.nativeDistanceKm)');
    expect(merge).toContain('safeKm(inputs.foregroundTripKm)');
  });
});
