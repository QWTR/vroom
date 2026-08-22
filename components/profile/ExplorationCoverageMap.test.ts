import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('components/profile/ExplorationCoverageMap.tsx'), 'utf8');

describe('ExplorationCoverageMap camera ownership', () => {
  it('does not feed camera changes back into React state during gestures', () => {
    expect(source).not.toContain('onCameraChanged=');
    expect(source).not.toContain('setManualCamera');
    expect(source).toContain('onMapIdle={handleMapIdle}');
  });

  it('uses imperative Mapbox camera controls on the full-screen map', () => {
    expect(source).toContain('fullscreenCameraRef.current?.zoomTo');
    expect(source).toContain('fullscreenCameraRef.current?.setCamera');
    expect(source).toContain('rotateEnabled={false}');
    expect(source).toContain('pitchEnabled={false}');
  });

  it('does not mount a native Mapbox surface inside the scrolling profile card', () => {
    expect(source.match(/<Mapbox\.MapView/g)).toHaveLength(1);
    expect(source).toContain('{fullscreen ? (');
    expect(source).toContain('<Modal\n          visible');
    expect(source).toContain('OTWORZ MAPE');
  });
});
