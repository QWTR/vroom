import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const marker = readFileSync(resolve('components/map/VehicleModelMarker.tsx'), 'utf8');
const equippedHook = readFileSync(resolve('hooks/useEquippedMapVehicle.ts'), 'utf8');

describe('vehicle model runtime contract', () => {
  it('uses one literal yaw pipeline in browse and active trip modes', () => {
    expect(marker).toContain('modelRotation: [pitch, roll, yaw]');
    expect(marker).not.toContain("['get', 'worldHeading']");
    expect(marker).not.toContain('dataDrivenHeading');
    expect(marker).toContain('frameCallback.setActive(enabled && modelReady)');
  });

  it('always revalidates external admin configuration and reacts to socket updates', () => {
    expect(equippedHook).toContain('vehicleConfigAt=${Date.now()}');
    expect(equippedHook).toContain("'Cache-Control': 'no-cache'");
    expect(equippedHook).toContain("subscribeSharedSocket('shop:vehicle-model-changed'");
    expect(equippedHook).toContain('activeReloadRef.current?.abort()');
  });
});
