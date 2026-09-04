import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'hooks/useBackgroundTracking.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('background tracking lifecycle contract', () => {
  it('never opens permission UI while the app is being backgrounded', () => {
    expect(source).not.toContain('Location.requestBackgroundPermissionsAsync()');
    expect(source).not.toContain('Location.requestForegroundPermissionsAsync()');
    expect(source).toContain('Location.getBackgroundPermissionsAsync()');
    expect(source).toContain("s === 'background' && forceEnabledRef.current");
  });
});
