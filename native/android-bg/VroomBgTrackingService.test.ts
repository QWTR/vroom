import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'native/android-bg/VroomBgTrackingService.kt'),
  'utf8',
);

describe('Android native trip checkpoint contract', () => {
  it('resets native totals when a new trip session starts', () => {
    expect(source).toContain('val isNewSession = !sessionId.isNullOrBlank() && sessionId != previousSessionId');
    expect(source).toContain('if (isNewSession) {\n      resetNativeSessionStats(applicationContext)\n    }');
    expect(source).toContain('.remove(KEY_NATIVE_LAST_SERVER_CHECKPOINT_KM)');
  });

  it('marks Free Drive checkpoints as driving progress', () => {
    expect(source).toContain('val source = if (mode == "navigation") "navigation" else "driving"');
  });
});
