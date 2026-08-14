import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(path), 'utf8');

describe('trip inactivity contract', () => {
  it('never ends free drive or navigation because the vehicle is stationary', () => {
    const mapSource = readSource('app/(tabs)/map.tsx');

    expect(mapSource).not.toContain('auto_stop_guard');
    expect(mapSource).not.toContain('idle_timeout');
    expect(mapSource).not.toContain('navigationIdleSinceRef');
    expect(mapSource).toContain("nativeState?.endedBy === 'idle'");
    expect(mapSource).toContain('BackgroundDriveController.start(ledger.mode, ledger.tripSessionId)');
  });

  it('keeps iOS Core Location active during long stops', () => {
    const swiftSource = readSource('native/background-drive/ios/WiroomLocationService.swift');
    const pluginSource = readSource('plugins/withWiroomBackgroundDrive.js');

    expect(swiftSource).not.toContain('idleStopMs');
    expect(swiftSource).not.toContain('private func observeIdle');
    expect(pluginSource).not.toContain('idleStopMs');
    expect(pluginSource).not.toContain('private func observeIdle');
  });
});
