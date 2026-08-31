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
    expect(source).toContain('updateFollowCamera(lat, lng, heading)');
    expect(source).toContain('.center(Point.fromLngLat(lng, lat))');
    expect(source).toContain('cameraNow - lastCameraPolicyAt >= 100L');
  });

  it('starts precise location independently for a cold Android Auto session', () => {
    const session = readFileSync(resolve('native/android-auto/VroomCarSession.kt'), 'utf8');
    const service = readFileSync(resolve('native/android-auto/AutoLocationForegroundService.kt'), 'utf8');
    const tracker = readFileSync(resolve('native/android-auto/AutoLocationTracker.kt'), 'utf8');

    expect(session).toContain('carContext.requestPermissions');
    expect(session).toContain('AutoLocationForegroundService.acquire');
    expect(service).toContain('startForeground(NOTIFICATION_ID, buildNotification())');
    expect(tracker).toContain('AutoLocationPolicy.acceptsJump');
    expect(tracker).toContain('AutoLocationPolicy.maxRoadSnapDistance');
  });

  it('keeps release builds safe from lifecycle obfuscation and forbidden service restarts', () => {
    const renderer = readFileSync(resolve('native/android-auto/VroomMapSurfaceRenderer.kt'), 'utf8');
    const service = readFileSync(resolve('native/android-auto/AutoLocationForegroundService.kt'), 'utf8');

    expect(renderer).toContain('import androidx.lifecycle.setViewTreeLifecycleOwner');
    expect(renderer).toContain('root.setViewTreeLifecycleOwner(owner)');
    expect(renderer).not.toContain('Class.forName("androidx.lifecycle.ViewTreeLifecycleOwner")');
    expect(service).toContain('if (intent == null)');
    expect(service).toContain('ForegroundServiceStartNotAllowedException');
    expect(service).not.toContain('return START_STICKY');
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

  it('keeps Live motion buffered, ordered and bounded after packet loss', () => {
    const source = readFileSync(resolve('native/android-auto/AutoLiveFleetStore.kt'), 'utf8');

    expect(source).toContain('INTERPOLATION_BUFFER_MS = 350L');
    expect(source).toContain('EXTRAPOLATION_DECAY_START_MS = 1_000L');
    expect(source).toContain('EXTRAPOLATION_MAX_MS = 2_500L');
    expect(source).toContain('seq <= previous.seq');
    expect(source).toContain('rejectedOldSeq += 1');
    expect(source).toContain('nowMs - INTERPOLATION_BUFFER_MS');
  });

  it('uses Socket.IO for Live and publishes snapped display pose with private raw validation data', () => {
    const source = readFileSync(resolve('native/android-auto/AutoLiveFleetSocketClient.kt'), 'utf8');

    expect(source).toContain('next.emit("live:join", bootstrap');
    expect(source).toContain('next.on("user:location")');
    expect(source).toContain('next.on("live:users:snapshot")');
    expect(source).toContain('.put("rawLat", rawLat)');
    expect(source).toContain('.put("snapSource", snapSource)');
    expect(source).toContain('.put("snapAgeMs", snapAgeMs.coerceAtLeast(0L))');
    expect(source).toContain('.put("snapDistanceM"');
    expect(source).toContain('fun restFallbackPayload(): String?');
  });

  it('updates Live annotations in place without clearing the fleet layer', () => {
    const source = readFileSync(resolve('native/android-auto/VroomMapSurfaceRenderer.kt'), 'utf8');
    const method = source.match(
      /private fun syncLiveUserAnnotations[\s\S]*?\n    private fun createMapAnnotation/,
    )?.[0];

    expect(method).toBeTruthy();
    expect(method).toContain('manager.update(changed)');
    expect(method).toContain('liveUserAnnotations.remove(id)?.let(manager::delete)');
    expect(method).not.toContain('deleteAll()');
  });
});
