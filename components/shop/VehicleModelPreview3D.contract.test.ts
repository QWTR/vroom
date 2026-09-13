import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const preview = readFileSync(resolve('components/shop/VehicleModelPreview3D.tsx'), 'utf8');

describe('vehicle model shop preview safety contract', () => {
  it('does not mount Expo GL on Android', () => {
    expect(preview).toContain("const interactivePreviewEnabled = Platform.OS !== 'android'");
    expect(preview).toContain('if (!interactivePreviewEnabled)');
    expect(preview.indexOf('if (!interactivePreviewEnabled)')).toBeLessThan(
      preview.indexOf('<Canvas'),
    );
  });

  it('never sends a GLB file to the image fallback', () => {
    expect(preview).toContain("normalizeMediaUri(item.previewUrl)");
    expect(preview).toContain("/\\.(?:glb|gltf)(?:\\?|$)/i.test(preview)");
  });
});
