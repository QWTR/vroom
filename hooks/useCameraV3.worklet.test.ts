import { transformFileSync } from '@babel/core';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('useCameraV3 Reanimated transform', () => {
  it('serializes duration validation inside the animated-props worklet', () => {
    const result = transformFileSync(resolve('hooks/useCameraV3.ts'), {
      presets: [resolve('node_modules/babel-preset-expo')],
      babelrc: false,
      configFile: false,
      caller: { name: 'metro', platform: 'android' },
    });
    const code = result?.code ?? '';

    expect(code).toContain('const segmentDurationMs=Number.isFinite(durationValue)');
    expect(code).not.toContain('tripCameraSegmentDurationMs');
    expect(code).not.toContain('nativeFollowerFrameFromMarker');
  }, 15_000);
});
