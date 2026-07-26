import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Android Auto canonical renderer', () => {
  it('recreates every checked-in generated Kotlin source deterministically', () => {
    const generatedDirectory = resolve('android/app/src/main/java/com/lexuuw/vroom/app/auto');
    const plugin = readFileSync(resolve('plugins/withAndroidAuto.js'), 'utf8');
    const files = readdirSync(generatedDirectory).filter((file) => file.endsWith('.kt'));

    for (const file of files) {
      const canonical = readFileSync(resolve('native/android-auto', file), 'utf8')
        .replace(/__PACKAGE__/g, 'com.lexuuw.vroom.app')
        .replace(/\r\n/g, '\n');
      const generated = readFileSync(resolve(generatedDirectory, file), 'utf8')
        .replace(/\r\n/g, '\n');
      expect(canonical, file).toBe(generated);
      expect(plugin, `${file} missing from prebuild plugin`).toContain(`'${file}'`);
    }
  });

  it('uses the overlay context, fixed Course Up rotation and time segments', () => {
    const source = readFileSync(resolve('native/android-auto/VroomMapSurfaceRenderer.kt'), 'utf8');

    expect(source).toContain('private val overlayContext = context.applicationContext');
    expect(source).not.toContain('?: carContext.resources.displayMetrics.density');
    expect(source).toContain('if (followMode) return 0.0');
    expect(source).toContain('private fun segmentProgress');
    expect(source).toContain('segmentDurationMs = 300L');
  });

  it('ships every Android Auto action icon from the canonical drawable source', () => {
    const plugin = readFileSync(resolve('plugins/withAndroidAuto.js'), 'utf8');
    const icons = [
      'ic_auto_stop.xml',
      'ic_auto_voice.xml',
      'ic_auto_voice_muted.xml',
      'ic_auto_report.xml',
      'ic_auto_recenter.xml',
      'ic_auto_theme.xml',
    ];

    for (const icon of icons) {
      const canonical = readFileSync(resolve('native/android-auto/drawable', icon), 'utf8')
        .replace(/\r\n/g, '\n');
      const generated = readFileSync(resolve('android/app/src/main/res/drawable', icon), 'utf8')
        .replace(/\r\n/g, '\n');
      expect(canonical, icon).toBe(generated);
    }
    expect(plugin).toContain("file.endsWith('.xml')");
    expect(plugin).toContain("path.join(srcDir, 'drawable')");
  });
});
