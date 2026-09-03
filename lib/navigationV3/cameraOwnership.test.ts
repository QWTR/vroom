import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('active trip camera ownership', () => {
  it('does not arm the legacy camera recenter when V3 handles a trip gesture', () => {
    const source = readFileSync('app/(tabs)/map.tsx', 'utf8');
    const start = source.indexOf('if (tripActive && gestureActive)');
    const end = source.indexOf('} else if (', start);
    const branch = source.slice(start, end);

    expect(branch).toContain('cameraV3.notifyUserMapInteraction');
    expect(branch).not.toMatch(/\n\s+notifyUserMapInteraction\(/);
  });

  it('keeps legacy frame writes disabled while a trip is active', () => {
    const source = readFileSync('hooks/useCameraAnimation.ts', 'utf8');
    const callback = source.slice(
      source.indexOf('const updateCameraFrame = useCallback'),
      source.indexOf('resumeAfterUserGestureRef.current', source.indexOf('const updateCameraFrame = useCallback')),
    );
    expect(callback).toContain('if (tripActiveRef.current) return;');
  });
});
