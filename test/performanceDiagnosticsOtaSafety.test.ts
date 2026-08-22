import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bootstrap = readFileSync(resolve('components/performance/PerformanceTelemetryBootstrap.tsx'), 'utf8');
const settings = readFileSync(resolve('app/profile/settings.tsx'), 'utf8');

describe('performance diagnostics OTA compatibility', () => {
  it('does not require expo-battery while the old native binary starts', () => {
    expect(bootstrap).not.toContain("import * as Battery from 'expo-battery'");
    expect(bootstrap).toContain("await import('expo-battery')");
    expect(bootstrap).toContain('catch {');
  });

  it('keeps the manually enabled settings switch visible without battery support', () => {
    expect(settings).toContain("label='Pomiary zuzycia'");
    expect(settings).toContain('value={diagnosticsEnabled}');
  });
});
